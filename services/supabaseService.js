const { createClient } = require('@supabase/supabase-js');

// สร้าง Supabase client แบบ lazy (สร้างจริงตอนถูกเรียกใช้งานครั้งแรกเท่านั้น)
// เหตุผล: ถ้า createClient() ทำงานตอน import โมดูล (top-level) แล้ว
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ยังไม่ถูกตั้งค่า (เช่น ลืมตั้ง
// Environment Variables บน Vercel) โมดูลทั้งไฟล์จะโยน error ทันทีตอน
// cold start ทำให้ serverless function พังทุก request แบบ
// FUNCTION_INVOCATION_FAILED โดยไม่มี error message ที่เป็นประโยชน์
// การ lazy-init แบบนี้ทำให้ error (ถ้ามี) เกิดขึ้นตอนเรียก endpoint จริง
// ซึ่งจะถูก try/catch ในแต่ละ route ดักไว้แล้วตอบกลับเป็น JSON 500
// ที่มีข้อความชัดเจน แทนที่จะพังทั้งฟังก์ชัน
let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — เช็ค Environment Variables (ในเครื่อง: ไฟล์ .env, บน Vercel: Project Settings > Environment Variables แล้ว Redeploy ใหม่)'
    );
  }
  _client = createClient(url, key);
  return _client;
}

// Proxy ทำให้โค้ดส่วนอื่นในไฟล์นี้ยังเรียก supabase.from(...) / supabase.storage
// ได้เหมือนเดิมทุกที่ โดยไม่ต้องแก้โค้ดที่เหลือทั้งหมด
const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

const LEAVE_BUCKET = 'leave-images';

// ===== ค่าคงที่ทางธุรกิจ =====

// เวลาทำงานมาตรฐาน: 08:00-17:00 หักพักเที่ยง 12:00-13:00 => 8 ชม./วัน
const WORK_START_MIN = 8 * 60;        // 08:00
const WORK_END_MIN = 17 * 60;         // 17:00
const LUNCH_START_MIN = 12 * 60;      // 12:00
const LUNCH_END_MIN = 13 * 60;        // 13:00
const WORK_HOURS_PER_DAY = 8;

const LEAVE_TYPES = {
  business: { column: 'leave_business', label: 'ลากิจ', requireAdvanceDays: 0 },
  sick: { column: 'leave_sick', label: 'ลาป่วย', requireAdvanceDays: 0 },
  vacation: { column: 'leave_vacation', label: 'ลาพักร้อน', requireAdvanceDays: 3 }
};

const TIME_CORRECTION_REASONS = [
  { value: 'forgot_scan_in', label: 'ลืมสแกนเข้างาน' },
  { value: 'forgot_scan_out', label: 'ลืมสแกนออกงาน' },
  { value: 'machine_error', label: 'เครื่องสแกนขัดข้อง' },
  { value: 'offsite_work', label: 'ออกไปปฏิบัติงานนอกสถานที่' },
  { value: 'other', label: 'อื่นๆ' }
];

function getTimeCorrectionReasons() {
  return TIME_CORRECTION_REASONS;
}

function getLeaveTypeInfo(leaveType) {
  return LEAVE_TYPES[leaveType] || null;
}

// ===== คำนวณจำนวนชั่วโมง/วันทำงาน =====

// คืนจำนวนนาทีทำงานจริงของ "หนึ่งวัน" ที่ทับซ้อนกับช่วง [dayStartMs, dayEndMs]
// โดยเทียบกับกรอบเวลาทำงาน 08:00-17:00 (หักพักเที่ยง 12:00-13:00) ของวันนั้น
function overlapMinutesForDay(dateObj, rangeStart, rangeEnd) {
  const dayBase = new Date(dateObj);
  dayBase.setHours(0, 0, 0, 0);

  const workStart = new Date(dayBase.getTime() + WORK_START_MIN * 60000);
  const workEnd = new Date(dayBase.getTime() + WORK_END_MIN * 60000);
  const lunchStart = new Date(dayBase.getTime() + LUNCH_START_MIN * 60000);
  const lunchEnd = new Date(dayBase.getTime() + LUNCH_END_MIN * 60000);

  function overlapMinutes(aStart, aEnd, bStart, bEnd) {
    const start = Math.max(aStart.getTime(), bStart.getTime());
    const end = Math.min(aEnd.getTime(), bEnd.getTime());
    return Math.max(0, end - start) / 60000;
  }

  // ทับซ้อนกับกรอบทำงานเต็ม แล้วหักส่วนที่ทับซ้อนกับพักเที่ยง
  const totalOverlap = overlapMinutes(workStart, workEnd, rangeStart, rangeEnd);
  const lunchOverlap = overlapMinutes(lunchStart, lunchEnd, rangeStart, rangeEnd);
  return Math.max(0, totalOverlap - lunchOverlap);
}

// ปัดจำนวนวันให้เป็นทวีคูณของ 0.5 (ปัดขึ้นเสมอ เพื่อไม่ให้พนักงานเสียสิทธิ์)
function roundToHalfDay(days) {
  return Math.ceil(days * 2) / 2;
}

// คำนวณจำนวน "วันลา" จากช่วงเวลา start - end
function calculateLeaveDays(startDatetime, endDatetime) {
  const start = new Date(startDatetime);
  const end = new Date(endDatetime);
  if (isNaN(start) || isNaN(end) || end <= start) return null;

  let totalMinutes = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const lastDay = new Date(end);
  lastDay.setHours(0, 0, 0, 0);

  while (cursor <= lastDay) {
    totalMinutes += overlapMinutesForDay(cursor, start, end);
    cursor.setDate(cursor.getDate() + 1);
  }

  const days = totalMinutes / 60 / WORK_HOURS_PER_DAY;
  return roundToHalfDay(days);
}

// คำนวณชั่วโมง OT ตรงไปตรงมาจากเวลาเริ่ม-สิ้นสุด (ชม., ทศนิยม 2 ตำแหน่ง)
function calculateOtHours(otDate, startTime, endTime) {
  const start = new Date(`${otDate}T${startTime}`);
  let end = new Date(`${otDate}T${endTime}`);
  if (isNaN(start) || isNaN(end)) return null;
  if (end <= start) {
    // กรณี OT ข้ามเที่ยงคืน
    end = new Date(end.getTime() + 24 * 60 * 60000);
  }
  const hours = (end.getTime() - start.getTime()) / 3600000;
  return Math.round(hours * 100) / 100;
}

// ต้องขอลาพักร้อนล่วงหน้าอย่างน้อย N วัน
function isAdvanceRequirementMet(leaveType, startDatetime, submittedAt = new Date()) {
  const info = getLeaveTypeInfo(leaveType);
  if (!info || info.requireAdvanceDays <= 0) return true;
  const start = new Date(startDatetime);
  const minAllowedStart = new Date(submittedAt);
  minAllowedStart.setDate(minAllowedStart.getDate() + info.requireAdvanceDays);
  minAllowedStart.setHours(0, 0, 0, 0);
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  return startDay.getTime() >= minAllowedStart.getTime();
}

// ===== Supervisors (auth) =====

async function getSupervisorById(supervisorId) {
  const { data, error } = await supabase
    .from('supervisors')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .single();
  if (error) return null;
  return data;
}

// ===== Employees (scope) =====

// ถ้า isAdmin=true จะเห็นทุกบริษัท/ทุกแผนก ไม่งั้นเห็นเฉพาะของตัวเอง
async function getEmployeesByScope({ isAdmin, company, department }) {
  let query = supabase.from('employees').select('*').order('first_name');
  if (!isAdmin) {
    query = query.eq('company', company).eq('department', department);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getEmployeeById(employeeId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('employee_id', employeeId)
    .single();
  if (error) return null;
  return data;
}

// ตรวจว่าพนักงานคนนี้อยู่ในสังกัดของผู้ใช้ที่ล็อกอิน (สำหรับ supervisor ธรรมดา)
function employeeInScope(employee, user) {
  if (user.role === 'admin') return true;
  return employee.company === user.company && employee.department === user.department;
}

// ===== Time correction requests =====

async function createTimeCorrectionRequest(payload) {
  const { data, error } = await supabase
    .from('time_correction_requests')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getTimeCorrectionHistory(filters = {}) {
  let query = supabase
    .from('time_correction_requests')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (filters.company) query = query.eq('company', filters.company);
  if (filters.department) query = query.eq('department', filters.department);
  if (filters.employee_id) query = query.eq('employee_id', filters.employee_id);
  if (filters.name) query = query.ilike('name', `%${filters.name}%`);
  if (filters.date_from) query = query.gte('correction_date', filters.date_from);
  if (filters.date_to) query = query.lte('correction_date', filters.date_to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ===== OT requests =====

async function createOtRequest(payload) {
  const { data, error } = await supabase
    .from('ot_requests')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getOtHistory(filters = {}) {
  let query = supabase
    .from('ot_requests')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (filters.company) query = query.eq('company', filters.company);
  if (filters.department) query = query.eq('department', filters.department);
  if (filters.employee_id) query = query.eq('employee_id', filters.employee_id);
  if (filters.name) query = query.ilike('name', `%${filters.name}%`);
  if (filters.date_from) query = query.gte('ot_date', filters.date_from);
  if (filters.date_to) query = query.lte('ot_date', filters.date_to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ===== Leave requests =====

async function uploadLeaveImage(fileBuffer, originalName, mimetype) {
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(LEAVE_BUCKET)
    .upload(fileName, fileBuffer, { contentType: mimetype, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(LEAVE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// ตรวจโควตาคงเหลือของพนักงานตามประเภทลา
function getRemainingQuota(employee, leaveType) {
  const info = getLeaveTypeInfo(leaveType);
  if (!info) return null;
  return Number(employee[info.column] || 0);
}

// หักโควตาหลังลาสำเร็จ
async function deductLeaveQuota(employeeId, leaveType, daysUsed) {
  const info = getLeaveTypeInfo(leaveType);
  const employee = await getEmployeeById(employeeId);
  if (!employee) throw new Error('ไม่พบพนักงาน');
  const newBalance = Number(employee[info.column] || 0) - daysUsed;
  const { error } = await supabase
    .from('employees')
    .update({ [info.column]: newBalance })
    .eq('employee_id', employeeId);
  if (error) throw error;
  return newBalance;
}

async function createLeaveRequest(payload) {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getLeaveHistory(filters = {}) {
  let query = supabase
    .from('leave_requests')
    .select('*')
    .order('submitted_at', { ascending: false });

  if (filters.company) query = query.eq('company', filters.company);
  if (filters.department) query = query.eq('department', filters.department);
  if (filters.employee_id) query = query.eq('employee_id', filters.employee_id);
  if (filters.name) query = query.ilike('name', `%${filters.name}%`);
  if (filters.leave_type) query = query.eq('leave_type', filters.leave_type);
  if (filters.date_from) query = query.gte('start_datetime', filters.date_from);
  if (filters.date_to) query = query.lte('end_datetime', filters.date_to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  LEAVE_TYPES,
  getTimeCorrectionReasons,
  getLeaveTypeInfo,
  calculateLeaveDays,
  calculateOtHours,
  isAdvanceRequirementMet,
  getSupervisorById,
  getEmployeesByScope,
  getEmployeeById,
  employeeInScope,
  createTimeCorrectionRequest,
  getTimeCorrectionHistory,
  createOtRequest,
  getOtHistory,
  uploadLeaveImage,
  getRemainingQuota,
  deductLeaveQuota,
  createLeaveRequest,
  getLeaveHistory
};
