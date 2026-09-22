require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { router: authRouter } = require('./routes/auth');
const attendanceRouter = require('./routes/attendance');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[LeaveHub] คำเตือน: ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env');
}
if (!process.env.JWT_SECRET && !process.env.SESSION_SECRET) {
  console.warn('[LeaveHub] คำเตือน: ยังไม่ได้ตั้งค่า JWT_SECRET ใน .env (กำลังใช้ค่า default ที่ไม่ปลอดภัยสำหรับ production)');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// auth ใช้ JWT เก็บใน httpOnly cookie แทน server-side session
// เพื่อให้ทำงานได้ถูกต้องบน serverless (เช่น Vercel) ที่แต่ละ request
// อาจไปลงที่ instance คนละตัวกัน ไม่มี memory ร่วมกันแบบ session แบบเดิม

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

// error handler กลาง — ดักทุก error ที่หลุดมาจาก middleware/route ก่อนหน้า
// (รวมถึง JSON body ที่ parse ไม่ได้) เพื่อตอบกลับเป็น JSON ที่อ่านได้เสมอ
// แทนที่จะปล่อยให้ function ทั้งตัวพังแบบไม่มีข้อความ (FUNCTION_INVOCATION_FAILED)
app.use((err, req, res, next) => {
  console.error('[LeaveHub] Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่ภายหลัง' });
});

// รัน app.listen() เฉพาะตอนรันตรงๆ ด้วย `node server.js` (localhost)
// บน Vercel (@vercel/node) จะ import โมดูลนี้แล้วเรียก app เป็น request handler เอง
// ไม่ต้อง (และไม่ควร) listen ที่ port ในสภาพแวดล้อม serverless
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LeaveHub server กำลังทำงานที่ http://localhost:${PORT}`);
  });
}

module.exports = app;
