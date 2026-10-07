/*
  นำเข้าข้อมูลจากไฟล์ Excel (เทมเพลต templates/LeaveHub_Import_Template.xlsx) ขึ้น Supabase

  วิธีใช้:
    npm run import:excel -- <ไฟล์.xlsx> [--dry-run] [--update]

  ตัวเลือก:
    --dry-run   ตรวจไฟล์และแสดงสรุป แต่ "ไม่เขียน" อะไรลงฐานข้อมูล (ไม่ต้องมี .env ก็ได้)
    --update    ทับข้อมูลของรหัสที่มีอยู่แล้ว (รวมโควตาวันลา/รหัสผ่านตามไฟล์)
                ถ้าไม่ใส่ = เพิ่มเฉพาะรายการใหม่ รหัสที่มีอยู่แล้วจะถูกข้าม (ปลอดภัยกว่า)

  ชีตที่อ่าน (ถ้าไม่มีชีตไหนก็ข้ามชีตนั้น): employees, supervisors
  แถวที่รหัสขึ้นต้นด้วย EXAMPLE (แถวตัวอย่างในเทมเพลต) จะถูกข้ามอัตโนมัติ
*/
require('dotenv').config();
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');
const UPDATE = args.includes('--update');
const CHUNK = 200;

const EMPLOYEE_COLS = {
  required: ['employee_id', 'company', 'department', 'first_name', 'last_name'],
  optional: ['prefix'],
  numeric: ['leave_business', 'leave_sick', 'leave_vacation','leave_paid_business','leave_paid_sick','leave_matemity']
};
const SUPERVISOR_COLS = {
  required: ['supervisor_id', 'password', 'role', 'first_name', 'last_name'],
  optional: ['prefix', 'company', 'department']
};

// ---------- helpers ----------

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('').trim();
    if (v.result !== undefined && v.result !== null) return String(v.result).trim();
    if (v.text !== undefined) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}

// อ่านชีตเป็นรายการ { rowNumber, data } โดยจับคู่จากชื่อหัวคอลัมน์ (สลับลำดับคอลัมน์ได้)
function readSheet(ws, allKeys) {
  const headerRow = ws.getRow(1);
  const colIndex = {};
  headerRow.eachCell((cell, colNumber) => {
    const name = cellText(cell).toLowerCase();
    if (allKeys.includes(name)) colIndex[name] = colNumber;
  });

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const data = {};
    let hasAny = false;
    for (const key of allKeys) {
      const text = colIndex[key] ? cellText(row.getCell(colIndex[key])) : '';
      data[key] = text;
      if (text !== '') hasAny = true;
    }
    if (hasAny) rows.push({ rowNumber: r, data });
  }
  return { colIndex, rows };
}

function isExample(id) {
  return /^example/i.test(id || '');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- validation ----------

function validateEmployees(rows, colIndex, errors) {
  const seen = new Set();
  const valid = [];
  for (const col of EMPLOYEE_COLS.required) {
    if (!colIndex[col]) errors.push(`[employees] ไม่พบหัวคอลัมน์ "${col}" ในแถวที่ 1`);
  }
  if (errors.length) return valid;

  for (const { rowNumber, data } of rows) {
    if (isExample(data.employee_id)) continue;
    const rowErrors = [];
    for (const col of EMPLOYEE_COLS.required) {
      if (!data[col]) rowErrors.push(`ไม่มีค่า ${col}`);
    }
    if (data.employee_id && seen.has(data.employee_id)) rowErrors.push(`employee_id "${data.employee_id}" ซ้ำในไฟล์`);
    seen.add(data.employee_id);

    const record = {
      employee_id: data.employee_id,
      company: data.company,
      department: data.department,
      prefix: data.prefix || null,
      first_name: data.first_name,
      last_name: data.last_name
    };
    for (const col of EMPLOYEE_COLS.numeric) {
      const raw = data[col];
      if (raw === '') { record[col] = 0; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        rowErrors.push(`${col} ต้องเป็นตัวเลข ≥ 0 (พบ "${raw}")`);
      } else {
        record[col] = n;
      }
    }
    if (rowErrors.length) errors.push(`[employees] แถว ${rowNumber}: ${rowErrors.join(', ')}`);
    else valid.push(record);
  }
  return valid;
}

async function validateSupervisors(rows, colIndex, errors) {
  const seen = new Set();
  const valid = [];
  for (const col of SUPERVISOR_COLS.required) {
    if (!colIndex[col]) errors.push(`[supervisors] ไม่พบหัวคอลัมน์ "${col}" ในแถวที่ 1`);
  }
  if (errors.some((e) => e.startsWith('[supervisors]'))) return valid;

  for (const { rowNumber, data } of rows) {
    if (isExample(data.supervisor_id)) continue;
    const rowErrors = [];
    for (const col of SUPERVISOR_COLS.required) {
      if (!data[col]) rowErrors.push(`ไม่มีค่า ${col}`);
    }
    if (data.role && !['admin', 'supervisor'].includes(data.role)) {
      rowErrors.push(`role ต้องเป็น admin หรือ supervisor (พบ "${data.role}")`);
    }
    const departments = (data.department || '').split(',').map((d) => d.trim()).filter(Boolean);
    if (data.role === 'supervisor' && (!data.company || departments.length === 0)) {
      rowErrors.push('role = supervisor ต้องกรอก company และ department อย่างน้อย 1 แผนก (คั่นหลายแผนกด้วย ,)');
    }
    if (data.supervisor_id && seen.has(data.supervisor_id)) rowErrors.push(`supervisor_id "${data.supervisor_id}" ซ้ำในไฟล์`);
    seen.add(data.supervisor_id);

    if (rowErrors.length) {
      errors.push(`[supervisors] แถว ${rowNumber}: ${rowErrors.join(', ')}`);
      continue;
    }
    valid.push({
      supervisor_id: data.supervisor_id,
      password_hash: await bcrypt.hash(data.password, 10),
      role: data.role,
      prefix: data.prefix || null,
      first_name: data.first_name,
      last_name: data.last_name,
      company: data.company || null,
      department: departments.length ? departments.join(', ') : (data.department || null),
    });
  }
  return valid;
}

// ---------- write to Supabase ----------

async function existingIds(supabase, table, idCol, ids) {
  const found = new Set();
  for (const part of chunk(ids, CHUNK)) {
    const { data, error } = await supabase.from(table).select(idCol).in(idCol, part);
    if (error) throw new Error(`อ่าน ${table} ไม่สำเร็จ: ${error.message}`);
    data.forEach((r) => found.add(r[idCol]));
  }
  return found;
}

async function pushTable(supabase, table, idCol, records) {
  const existing = await existingIds(supabase, table, idCol, records.map((r) => r[idCol]));
  const newCount = records.filter((r) => !existing.has(r[idCol])).length;
  const existCount = records.length - newCount;

  for (const part of chunk(records, CHUNK)) {
    const { error } = await supabase
      .from(table)
      .upsert(part, { onConflict: idCol, ignoreDuplicates: !UPDATE });
    if (error) throw new Error(`เขียน ${table} ไม่สำเร็จ: ${error.message}`);
  }
  return { newCount, existCount };
}

// ---------- main ----------

async function main() {
  if (!file) {
    console.log('การใช้งาน: npm run import:excel -- <ไฟล์.xlsx> [--dry-run] [--update]');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(file);
  } catch (e) {
    console.error(`เปิดไฟล์ไม่ได้: ${e.message}`);
    process.exit(1);
  }

  const errors = [];
  let employees = [];
  let supervisors = [];

  const wsEmp = wb.getWorksheet('employees');
  if (wsEmp) {
    const { colIndex, rows } = readSheet(wsEmp, [...EMPLOYEE_COLS.required, ...EMPLOYEE_COLS.optional, ...EMPLOYEE_COLS.numeric]);
    employees = validateEmployees(rows, colIndex, errors);
  } else {
    console.log('ℹ️  ไม่พบชีต "employees" — ข้าม');
  }

  const wsSup = wb.getWorksheet('supervisors');
  if (wsSup) {
    const { colIndex, rows } = readSheet(wsSup, [...SUPERVISOR_COLS.required, ...SUPERVISOR_COLS.optional]);
    supervisors = await validateSupervisors(rows, colIndex, errors);
  } else {
    console.log('ℹ️  ไม่พบชีต "supervisors" — ข้าม');
  }

  console.log(`\nตรวจไฟล์: ${file}`);
  console.log(`  employees   ที่ผ่านการตรวจ: ${employees.length} แถว`);
  console.log(`  supervisors ที่ผ่านการตรวจ: ${supervisors.length} แถว`);

  if (errors.length) {
    console.error(`\n❌ พบข้อผิดพลาด ${errors.length} จุด — ยังไม่นำเข้าอะไรเลย กรุณาแก้ไฟล์แล้วรันใหม่:\n`);
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n✅ [dry-run] ไม่พบข้อผิดพลาด (ยังไม่ได้เขียนข้อมูลลงฐานข้อมูล) — ตัด --dry-run ออกเพื่อนำเข้าจริง');
    return;
  }

  if (!employees.length && !supervisors.length) {
    console.log('\nไม่มีแถวข้อมูลให้นำเข้า (แถวตัวอย่างถูกข้ามอัตโนมัติ)');
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n❌ ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env');
    process.exit(1);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`\nโหมด: ${UPDATE ? 'ทับข้อมูลเดิม (--update)' : 'เพิ่มเฉพาะรายการใหม่ (ข้ามรหัสที่มีอยู่แล้ว)'}`);
  try {
    if (employees.length) {
      const r = await pushTable(supabase, 'employees', 'employee_id', employees);
      console.log(`✅ employees: รายการใหม่ ${r.newCount}, รหัสที่มีอยู่แล้ว ${r.existCount} ${UPDATE ? '(อัปเดตแล้ว)' : '(ข้าม)'}`);
    }
    if (supervisors.length) {
      const r = await pushTable(supabase, 'supervisors', 'supervisor_id', supervisors);
      console.log(`✅ supervisors: รายการใหม่ ${r.newCount}, รหัสที่มีอยู่แล้ว ${r.existCount} ${UPDATE ? '(อัปเดตแล้ว)' : '(ข้าม)'}`);
    }
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
  console.log('\nเสร็จสิ้น — ถ้าไฟล์มีรหัสผ่านตัวจริง อย่าลืมลบไฟล์หลังนำเข้า และห้าม commit ขึ้น git');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
