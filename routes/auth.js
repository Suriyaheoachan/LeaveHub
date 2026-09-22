const express = require('express');
const bcrypt = require('bcrypt');
const { getSupervisorById } = require('../services/supabaseService');

const router = express.Router();

// ===== Middleware =====

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่เข้าถึงได้' });
  }
  next();
}

// ===== Routes =====

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { supervisor_id, password } = req.body;
    if (!supervisor_id || !password) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสผู้ใช้และรหัสผ่าน' });
    }

    const supervisor = await getSupervisorById(supervisor_id);
    if (!supervisor) {
      return res.status(401).json({ error: 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const passwordOk = await bcrypt.compare(password, supervisor.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    req.session.user = {
      supervisor_id: supervisor.supervisor_id,
      name: `${supervisor.prefix || ''}${supervisor.first_name} ${supervisor.last_name}`.trim(),
      role: supervisor.role,
      company: supervisor.company,
      department: supervisor.department
    };

    res.json({ user: req.session.user });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('POST /api/auth/logout', err);
      return res.status(500).json({ error: 'ออกจากระบบไม่สำเร็จ' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  }
  res.json({ user: req.session.user });
});

module.exports = { router, requireAuth, requireAdmin };
