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
- `SESSION_SECRET` — ตั้งเป็นสตริงยาวๆ สุ่มๆ สำหรับเซ็น session cookie

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

## หมายเหตุก่อน deploy ขึ้น Vercel

โค้ดชุดนี้ใช้ `express-session` แบบ in-memory store ซึ่ง**ใช้ไม่ได้กับ serverless** (แต่ละ request อาจไปคนละ instance ทำให้ session หาย) ตามที่ระบุไว้ในสเปคแล้วว่าต้องเปลี่ยนไปใช้ JWT (`jsonwebtoken` + `cookie-parser`) แทนก่อน deploy จริง — ไฟล์ `vercel.json` ที่แนบมาเป็นแค่โครงเริ่มต้น ยังไม่ได้ปรับส่วน auth ให้รองรับ serverless
