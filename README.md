# LeaveHub

ระบบขอลา / ขอเพิ่มเวลา / ขอ OT สำหรับพนักงาน (Node.js + Express + Supabase)

## 1) ติดตั้ง

```bash
npm install
```

## 2) ตั้งค่า .env

คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่าจริง:

```bash
cp .env.example .env
```

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — ดูได้ที่ Supabase Dashboard > Project Settings > API
  (ใช้ **Service Role Key** เพราะ backend ต้องอ่าน/เขียนข้ามสิทธิ์ผู้ใช้ — ห้ามส่งค่านี้ไปหน้าเว็บเด็ดขาด)
- `JWT_SECRET` — ตั้งเป็นสตริงยาวๆ สุ่มๆ สำหรับเซ็น JWT (auth token ที่เก็บใน httpOnly cookie)
  สร้างง่ายๆ ด้วยคำสั่ง: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `NODE_ENV` — ตั้งเป็น `production` ตอน deploy จริง (cookie จะถูกบังคับให้ส่งผ่าน HTTPS เท่านั้น)

## 3) สร้างบัญชีผู้ใช้แรก (login เข้าระบบได้เฉพาะ supervisor/admin เท่านั้น)

ตาราง `supervisors` ยังไม่มีหน้าสมัครสมาชิกในตัวระบบ ใช้สคริปต์ช่วยสร้าง:

```bash
node scripts/create-supervisor.js SUP001 mypassword123 admin สมชาย ใจดี
node scripts/create-supervisor.js SUP002 mypassword123 supervisor สมหญิง รักงาน "บริษัท เอบีซี" "บัญชี"
```

## 4) รันเซิร์ฟเวอร์

```bash
npm start
```

เปิดเบราว์เซอร์ที่ `http://localhost:3000` (จะ redirect ไปหน้า login อัตโนมัติ)

## โครงสร้างระบบสิทธิ์

- คนที่ **login เข้าระบบได้** มีแค่ `supervisors` และ `admin` (พนักงานในตาราง `employees` ไม่มีบัญชีของตัวเอง — หัวหน้างาน/แอดมินเป็นคนยื่นคำขอแทน)
- **supervisor**: เห็น/ยื่นคำขอได้เฉพาะพนักงานในบริษัท+แผนกตัวเอง เข้าหน้าประวัติ (history) ไม่ได้
- **admin**: เห็นทุกบริษัท/ทุกแผนก และเข้าหน้าประวัติทั้ง 3 หน้าได้เท่านั้น
- ทุก endpoint ที่จำกัดสิทธิ์ถูกเช็คซ้ำที่ฝั่ง backend (`routes/auth.js` → `requireAuth`, `requireAdmin`) ไม่ได้พึ่งแค่การซ่อนเมนูฝั่ง frontend

## กติกาธุรกิจที่ implement ไว้ (`services/supabaseService.js`)

1. ลาพักร้อนต้องขอล่วงหน้าอย่างน้อย 3 วัน (เช็คจากวันที่ยื่นเทียบกับวันเริ่มลา)
2. ลากิจ/ลาป่วย/ลาพักร้อน เช็คโควตาคงเหลือก่อนบันทึก แล้วหักยอดอัตโนมัติหลังลาสำเร็จ
3. คำนวณจำนวนวันลาจากเวลาทำงานจริง 08:00-17:00 หักพักเที่ยง 12:00-13:00 (8 ชม./วัน) แล้วปัด**ขึ้น**เป็นทวีคูณของ 0.5 วัน (ปัดขึ้นเพื่อไม่ให้พนักงานเสียสิทธิ์จากเศษเวลา — ปรับเป็นปัดลง/ปัดใกล้สุดได้ที่ฟังก์ชัน `roundToHalfDay`)
4. แนบรูปได้เฉพาะฟอร์มขอลา อัปโหลดขึ้น Supabase Storage bucket `leave-images` เก็บ URL ไว้ที่ `image_path` — หน้าประวัติโชว์ "-" ถ้าไม่มีรูป

## Auth และการ deploy ขึ้น Vercel

ระบบใช้ **JWT เก็บใน httpOnly cookie** (`jsonwebtoken` + `cookie-parser`) แทน `express-session` แบบเดิม เพื่อให้ทำงานได้ถูกต้องบน serverless (แต่ละ request ไม่ต้องพึ่ง memory ร่วมกันของ instance เดิม) — คำขอ login จะเซ็น JWT อายุ 8 ชั่วโมงแล้วฝังใน cookie ชื่อ `leavehub_token`, ทุก endpoint ที่ต้อง login จะอ่าน/ตรวจ JWT จาก cookie นี้ผ่าน `requireAuth` / `requireAdmin` middleware

สิ่งที่ควรเช็คก่อน deploy ขึ้น Vercel จริง:
- ตั้งค่า `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` เป็น Environment Variables บน Vercel Dashboard (ใช้ค่าคนละชุดกับตอน dev บนเครื่อง)
- ตั้ง `NODE_ENV=production` เพื่อให้ cookie ถูกบังคับส่งผ่าน HTTPS เท่านั้น
- ไฟล์อัปโหลด/รูปแนบยังอัปโหลดตรงไป Supabase Storage อยู่แล้ว ไม่ได้พึ่ง local disk จึงใช้กับ serverless ได้ทันทีโดยไม่ต้องแก้เพิ่ม
