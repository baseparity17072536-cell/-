# Environment Setup (Development)

ต้องมี: Node.js 22+ (ทดสอบกับ 26), npm 11, Git ไม่ต้องติดตั้ง PostgreSQL หรือ Docker

```powershell
npm install
npm install-scripts approve @embedded-postgres/windows-x64 esbuild   # ครั้งแรกครั้งเดียว (npm 11)
npm rebuild @embedded-postgres/windows-x64 esbuild

# Terminal 1 — เปิดฐานข้อมูล (ค้างไว้)
npm run db:start          # ครั้งแรกจะสร้าง .env.development.local (รหัสผ่านสุ่ม, ไม่ถูก commit)

# Terminal 2
npm run db:migrate        # สร้างตาราง + role ของแอป
npm run db:seed           # สร้างข้อมูลฟ้าทะเล + บัญชีเจ้าของ (แสดงรหัสผ่านครั้งเดียว)
npm run dev
```

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run db:start` | เปิด PostgreSQL 18 ที่ `localhost:54329` ข้อมูลอยู่ใน `.pgdata/` |
| `npm run db:migrate` | รัน migration ที่ยังไม่รัน |
| `npm run db:rollback` | ย้อน migration ล่าสุด 1 ขั้น |
| `npm run db:seed` | ใส่ข้อมูลเริ่มต้น (ข้ามถ้ามีแล้ว) และนำเข้า `data/bookings.json` เดิม |
| `npm test` | เปิด PostgreSQL ชั่วคราวแยก (พอร์ตว่างอัตโนมัติ) แล้วรัน unit + integration test ทั้งหมด |
| `npm run test:e2e` | ทดสอบผ่านเบราว์เซอร์จริง (desktop + mobile) ต้องเปิด `db:start` ไว้ และตั้ง `E2E_OWNER_PASSWORD` · ติดตั้งเบราว์เซอร์ครั้งแรก: `npx playwright install chromium` |
| `npm run typecheck` / `npm run lint` | ตรวจ TypeScript / ESLint |

## ตัวแปรสภาพแวดล้อม

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `DATABASE_URL` | การเชื่อมต่อของแอป — **ต้องเป็น role ที่ไม่ใช่ superuser และไม่มี BYPASSRLS** (`fahtalay_app`) |
| `DATABASE_ADMIN_URL` | ใช้เฉพาะ migration/seed (เจ้าของตาราง) ห้ามให้แอปใช้ |
| `APP_SECRET` | **จำเป็น** อย่างน้อย 32 ตัวอักษร ใช้เซ็นสิทธิ์ดูข้อมูลการจองของลูกค้า (สร้างให้อัตโนมัติใน dev) |
| `TRUST_PROXY_HOST` | ตั้งเป็น `1` เฉพาะเมื่ออยู่หลัง reverse proxy ที่เชื่อถือได้ (ให้ใช้ `x-forwarded-host`) |
| `ADMIN_PASSWORD` | ไม่ใช้แล้ว (ระบบเดิม) ลบออกจาก `.env.local` ได้ |
| `SEED_OWNER_EMAIL` | อีเมลบัญชีเจ้าของตอน seed (ไม่ใส่ = `owner@fahtalay.local`) |

ไฟล์ `.env*`, `.pgdata/`, `data/` อยู่ใน `.gitignore` ห้าม commit
