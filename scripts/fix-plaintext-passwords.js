/*
  สคริปต์แก้ไขปัญหา password_hash ที่ import มาจาก Excel เป็นตัวเลข/ข้อความดิบ
  (ไม่ใช่ bcrypt hash) — จะไปหาแถวที่ password_hash "ยังไม่ใช่" bcrypt hash
  แล้วนำค่านั้นมา hash ใหม่ให้ถูกต้อง แล้วเขียนทับกลับที่แถวเดิม

  ⚠️ สมมติฐานสำคัญ: ค่าที่อยู่ใน password_hash ตอนนี้ (เช่น ตัวเลขดิบ) คือ
  "รหัสผ่านที่ต้องการใช้จริง" ของแต่ละคน ถ้าไม่ใช่ (เช่น เผลอเอาเลขพนักงาน
  ไปใส่ผิดคอลัมน์) ห้ามรันสคริปต์นี้ - ให้แก้ข้อมูลในตารางให้ถูกต้องก่อน

  วิธีใช้ (รันจากเครื่องที่มี .env ชี้ไปยัง Supabase project จริงแล้ว):
    node scripts/fix-plaintext-passwords.js

  จะมีโหมด --dry-run ให้ลองดูก่อนว่าจะแก้แถวไหนบ้าง โดยไม่เขียนจริง:
    node scripts/fix-plaintext-passwords.js --dry-run
*/
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/; // รูปแบบ bcrypt hash เช่น $2a$10$...

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: rows, error } = await supabase.from('supervisors').select('*');
  if (error) {
    console.error('ดึงข้อมูลตาราง supervisors ไม่สำเร็จ:', error.message);
    process.exit(1);
  }

  const toFix = rows.filter((row) => !BCRYPT_HASH_PATTERN.test(row.password_hash || ''));

  if (toFix.length === 0) {
    console.log('✅ ทุกแถวเป็น bcrypt hash ที่ถูกต้องอยู่แล้ว ไม่มีอะไรต้องแก้');
    return;
  }

  console.log(`พบ ${toFix.length} แถวที่ password_hash ยังไม่ใช่ bcrypt hash:`);
  toFix.forEach((row) => {
    console.log(`  - ${row.supervisor_id} (${row.first_name} ${row.last_name}) : ค่าปัจจุบัน = "${row.password_hash}"`);
  });

  if (isDryRun) {
    console.log('\n(--dry-run) ยังไม่ได้แก้ไขอะไรจริง ลบ --dry-run ออกแล้วรันใหม่เพื่อแก้ไขจริง');
    return;
  }

  console.log('\nกำลัง hash รหัสผ่านใหม่และอัปเดต...');
  let successCount = 0;
  for (const row of toFix) {
    const plainPassword = String(row.password_hash);
    const newHash = await bcrypt.hash(plainPassword, 10);
    const { error: updateError } = await supabase
      .from('supervisors')
      .update({ password_hash: newHash })
      .eq('supervisor_id', row.supervisor_id);

    if (updateError) {
      console.error(`  ❌ ${row.supervisor_id}: อัปเดตไม่สำเร็จ - ${updateError.message}`);
    } else {
      console.log(`  ✅ ${row.supervisor_id}: แก้ไขแล้ว (รหัสผ่านสำหรับ login คือ "${plainPassword}" เหมือนเดิม)`);
      successCount++;
    }
  }

  console.log(`\nเสร็จแล้ว: แก้ไขสำเร็จ ${successCount}/${toFix.length} แถว`);
}

main();
