const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('./auth');
const svc = require('../services/supabaseService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// GET /api/attendance/my-team
router.get('/my-team', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const employees = await svc.getEmployeesByScope({
      isAdmin: user.role === 'admin',
      company: user.company,
      department: user.department
    });
    res.json({ employees });
  } catch (err) {
    console.error('GET /api/attendance/my-team', err);
    res.status(500).json({ error: 'ดึงข้อมูลพนักงานไม่สำเร็จ' });
  }
});

// GET /api/attendance/time-correction/reasons
router.get('/time-correction/reasons', requireAuth, (req, res) => {
  res.json({ reasons: svc.getTimeCorrectionReasons() });
});

// POST /api/attendance/time-correction
router.post('/time-correction', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { employee_id, correction_date, correction_time, reason_type, detail } = req.body;

    if (!employee_id || !correction_date || !correction_time || !reason_type) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    const employee = await svc.getEmployeeById(employee_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงานที่เลือก' });
    if (!svc.employeeInScope(employee, user)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ทำรายการให้พนักงานนอกสังกัดของคุณ' });
    }

    const record = await svc.createTimeCorrectionRequest({
      employee_id: employee.employee_id,
      name: `${employee.prefix || ''}${employee.first_name} ${employee.last_name}`.trim(),
      company: employee.company,
      department: employee.department,
      correction_date,
      correction_time,
      reason_type,
      detail: detail || null,
      submitted_by: user.supervisor_id
    });

    res.status(201).json({ request: record });
  } catch (err) {
    console.error('POST /api/attendance/time-correction', err);
    res.status(500).json({ error: 'บันทึกคำขอไม่สำเร็จ' });
  }
});

// GET /api/attendance/time-correction/history
router.get('/time-correction/history', requireAdmin, async (req, res) => {
  try {
    const { company, department, employee_id, name, date_from, date_to } = req.query;
    const history = await svc.getTimeCorrectionHistory({
      company, department, employee_id, name, date_from, date_to
    });
    res.json({ history });
  } catch (err) {
    console.error('GET /api/attendance/time-correction/history', err);
    res.status(500).json({ error: 'ดึงประวัติไม่สำเร็จ' });
  }
});

// POST /api/attendance/ot
router.post('/ot', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { employee_id, ot_date, ot_start_time, ot_end_time, detail } = req.body;

    if (!employee_id || !ot_date || !ot_start_time || !ot_end_time) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    const employee = await svc.getEmployeeById(employee_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงานที่เลือก' });
    if (!svc.employeeInScope(employee, user)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ทำรายการให้พนักงานนอกสังกัดของคุณ' });
    }

    const otHours = svc.calculateOtHours(ot_date, ot_start_time, ot_end_time);
    if (otHours === null || otHours <= 0) {
      return res.status(400).json({ error: 'ช่วงเวลา OT ไม่ถูกต้อง' });
    }

    const record = await svc.createOtRequest({
      employee_id: employee.employee_id,
      name: `${employee.prefix || ''}${employee.first_name} ${employee.last_name}`.trim(),
      company: employee.company,
      department: employee.department,
      ot_date,
      ot_start_time,
      ot_end_time,
      ot_hours: otHours,
      detail: detail || null,
      submitted_by: user.supervisor_id
    });

    res.status(201).json({ request: record });
  } catch (err) {
    console.error('POST /api/attendance/ot', err);
    res.status(500).json({ error: 'บันทึกคำขอไม่สำเร็จ' });
  }
});

// GET /api/attendance/ot/history
router.get('/ot/history', requireAdmin, async (req, res) => {
  try {
    const { company, department, employee_id, name, date_from, date_to } = req.query;
    const history = await svc.getOtHistory({
      company, department, employee_id, name, date_from, date_to
    });
    res.json({ history });
  } catch (err) {
    console.error('GET /api/attendance/ot/history', err);
    res.status(500).json({ error: 'ดึงประวัติไม่สำเร็จ' });
  }
});

// POST /api/attendance/leave  (multipart/form-data, field "image" ถ้ามีรูปแนบ)
router.post('/leave', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const user = req.session.user;
    const { employee_id, leave_type, start_datetime, end_datetime, detail } = req.body;

    if (!employee_id || !leave_type || !start_datetime || !end_datetime) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
    }

    const leaveInfo = svc.getLeaveTypeInfo(leave_type);
    if (!leaveInfo) {
      return res.status(400).json({ error: 'ประเภทการลาไม่ถูกต้อง' });
    }

    const employee = await svc.getEmployeeById(employee_id);
    if (!employee) return res.status(404).json({ error: 'ไม่พบพนักงานที่เลือก' });
    if (!svc.employeeInScope(employee, user)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ทำรายการให้พนักงานนอกสังกัดของคุณ' });
    }

    // กติกา: ลาพักร้อนต้องขอล่วงหน้าอย่างน้อย 3 วัน
    if (!svc.isAdvanceRequirementMet(leave_type, start_datetime)) {
      return res.status(400).json({
        error: `${leaveInfo.label} ต้องขอล่วงหน้าอย่างน้อย ${leaveInfo.requireAdvanceDays} วัน`
      });
    }

    const daysUsed = svc.calculateLeaveDays(start_datetime, end_datetime);
    if (daysUsed === null || daysUsed <= 0) {
      return res.status(400).json({ error: 'ช่วงเวลาลาไม่ถูกต้อง' });
    }

    // กติกา: ตรวจโควตาคงเหลือ
    const remaining = svc.getRemainingQuota(employee, leave_type);
    if (remaining === null || remaining < daysUsed) {
      return res.status(400).json({
        error: `โควตา${leaveInfo.label}เหลือไม่พอ (คงเหลือ ${remaining} วัน, ขอ ${daysUsed} วัน)`
      });
    }

    // อัปโหลดรูปแนบ (ถ้ามี) — อนุญาตเฉพาะฟอร์มลางาน
    let imagePath = null;
    if (req.file) {
      imagePath = await svc.uploadLeaveImage(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    const record = await svc.createLeaveRequest({
      employee_id: employee.employee_id,
      name: `${employee.prefix || ''}${employee.first_name} ${employee.last_name}`.trim(),
      company: employee.company,
      department: employee.department,
      leave_type,
      start_datetime,
      end_datetime,
      detail: detail || null,
      days_used: daysUsed,
      image_path: imagePath,
      submitted_by: user.supervisor_id
    });

    const newBalance = await svc.deductLeaveQuota(employee.employee_id, leave_type, daysUsed);

    res.status(201).json({ request: record, remaining_quota: newBalance });
  } catch (err) {
    console.error('POST /api/attendance/leave', err);
    res.status(500).json({ error: 'บันทึกคำขอไม่สำเร็จ' });
  }
});

// GET /api/attendance/leave/history
router.get('/leave/history', requireAdmin, async (req, res) => {
  try {
    const { company, department, employee_id, name, leave_type, date_from, date_to } = req.query;
    const history = await svc.getLeaveHistory({
      company, department, employee_id, name, leave_type, date_from, date_to
    });
    res.json({ history });
  } catch (err) {
    console.error('GET /api/attendance/leave/history', err);
    res.status(500).json({ error: 'ดึงประวัติไม่สำเร็จ' });
  }
});

module.exports = router;
