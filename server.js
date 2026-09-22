require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const { router: authRouter } = require('./routes/auth');
const attendanceRouter = require('./routes/attendance');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[LeaveHub] คำเตือน: ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'leavehub-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000 // 8 ชั่วโมง
  }
}));

app.use('/api/auth', authRouter);
app.use('/api/attendance', attendanceRouter);

app.use(express.static(path.join(__dirname, 'public')));

// ทุก path ที่ไม่รู้จักและไม่ใช่ /api ให้ redirect ไปหน้า login
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'ไม่พบ endpoint นี้' });
  }
  res.redirect('/login.html');
});

app.listen(PORT, () => {
  console.log(`LeaveHub server กำลังทำงานที่ http://localhost:${PORT}`);
});
