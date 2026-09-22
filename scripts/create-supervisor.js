/*
  สคริปต์ช่วยสร้างบัญชี supervisor/admin สำหรับล็อกอิน (ตาราง supervisors ไม่มีหน้าสมัครสมาชิก)

  วิธีใช้:
    node scripts/create-supervisor.js <supervisor_id> <password> <role> <first_name> <last_name> [company] [department] [prefix]

  ตัวอย่าง:
    node scripts/create-supervisor.js SUP001 mypassword123 admin สมชาย ใจดี
    node scripts/create-supervisor.js SUP002 mypassword123 supervisor สมหญิง รักงาน "บริษัท เอบีซี" "บัญชี"
*/
require('dotenv').config();
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const [supervisor_id, password, role, first_name, last_name, company, department, prefix] = process.argv.slice(2);

  if (!supervisor_id || !password || !role || !first_name || !last_name) {
    console.log('การใช้งาน: node scripts/create-supervisor.js <supervisor_id> <password> <admin|supervisor> <first_name> <last_name> [company] [department] [prefix]');
    process.exit(1);
  }
  if (!['admin', 'supervisor'].includes(role)) {
    console.error('role ต้องเป็น "admin" หรือ "supervisor" เท่านั้น');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('supervisors')
    .insert({
      supervisor_id,
      password_hash,
      role,
      first_name,
      last_name,
      company: company || null,
      department: department || null,
      prefix: prefix || null
    })
    .select()
    .single();

  if (error) {
    console.error('สร้างบัญชีไม่สำเร็จ:', error.message);
    process.exit(1);
  }

  console.log('สร้างบัญชีสำเร็จ:', data);
}

main();
