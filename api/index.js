// Vercel จะ auto-detect ไฟล์ใดๆ ในโฟลเดอร์ /api ว่าเป็น serverless function
// (ไม่ต้องพึ่ง `builds` แบบเก่าใน vercel.json อีกต่อไป — วิธีนี้เป็นวิธีที่
// Environment Variables จาก Project Settings ถูก inject เข้ามาอย่างแน่นอน)
module.exports = require('../server.js');
