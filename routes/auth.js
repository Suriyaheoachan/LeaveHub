const express = require('express');
const bcrypt = require('bcryptjs'); // pure-JS (ไม่มี native binary) เพื่อความเข้ากันได้กับ Vercel serverless
const jwt = require('jsonwebtoken');
const { getSupervisorById } = require('../services/supabaseService');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'leavehub-dev-secret-change-me';
const TOKEN_COOKIE = 'leavehub_token';
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 ชั่วโมง

function signToken(user) {
  // เก็บเฉพาะข้อมูลที่จำเป็นลงใน JWT (ไม่มีรหัสผ่านหรือข้อมูลลับ)
  return jwt.sign(user, JWT_SECRET, { expiresIn: '8h' });
}

function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_MAX_AGE_MS
  });
}

// ===== Middleware =====

function readUserFromRequest(req) {
  const token = req.cookies && req.cookies[TOKEN_COOKIE];
  if (!token) return null;
  try {
    const { iat, exp, ...user } = jwt.verify(token, JWT_SECRET);
    return user;
  } catch (err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  req.session = { user }; // คงชื่อ req.session.user ไว้ ไม่ต้องแก้ route อื่นที่เรียกใช้
  next();
}

function requireAdmin(req, res, next) {
  const user = readUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่เข้าถึงได้' });
  }
  req.session = { user };
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

    const user = {
      supervisor_id: supervisor.supervisor_id,
      name: `${supervisor.prefix || ''}${supervisor.first_name} ${supervisor.last_name}`.trim(),
      role: supervisor.role,
      company: supervisor.company,
      department: supervisor.department
    };

    const token = signToken(user);
    setAuthCookie(res, token);

    res.json({ user });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const user = readUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
  }
  res.json({ user });
});

module.exports = { router, requireAuth, requireAdmin };
