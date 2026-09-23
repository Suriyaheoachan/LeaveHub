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

// TEMP DEBUG ENDPOINT — เปิดดูตรงๆ ในเบราว์เซอร์ได้เลยที่ /api/debug-env
// โชว์แค่ true/false ว่ามีค่าตัวแปรไหน ไม่โชว์ค่าจริงเด็ดขาด (ปลอดภัย)
// ลบ route นี้ทิ้งหลังจากแก้ปัญหา environment variables เสร็จแล้ว
app.get('/api/debug-env', (req, res) => {
  res.json({
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    JWT_SECRET: !!process.env.JWT_SECRET,
    SESSION_SECRET: !!process.env.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV || null,
    VERCEL_ENV: process.env.VERCEL_ENV || null,
    VERCEL: process.env.VERCEL || null,
    // แสดงชื่อตัวแปร env ทั้งหมดที่ขึ้นต้นด้วย SUPABASE หรือ JWT (ไม่โชว์ค่า)
    // เผื่อชื่อตัวแปรจริงสะกดผิด/มีช่องว่างแฝง จะได้เห็นชื่อที่แท้จริง
    matching_env_keys: Object.keys(process.env).filter(
      (k) => k.includes('SUPABASE') || k.includes('JWT') || k.includes('SESSION')
    )
  });
});

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
