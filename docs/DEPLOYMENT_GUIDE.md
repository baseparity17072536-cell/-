# Deployment Guide — Vercel + PostgreSQL

ระบบนี้ **ต้องมีฐานข้อมูล PostgreSQL** ถ้า deploy ขึ้น Vercel โดยไม่ตั้งค่าฐานข้อมูล ทุกหน้าจะขึ้น
“This page couldn’t load / A server error occurred” และใน Vercel Logs จะเห็น `DATABASE_URL is not set`

ขั้นตอนนี้ทำครั้งเดียว ใช้เวลาประมาณ 15 นาที

## 1. สร้างฐานข้อมูล (แนะนำ Neon — มีแพ็กเกจฟรี)

ใน Vercel → Project → **Storage** → **Create Database** → **Neon (Postgres)** → Region **Singapore** → Connect to project
หรือสมัครที่ neon.tech เองก็ได้ จะได้ connection string 2 แบบ:

| ชื่อ | ลักษณะ | ใช้กับ |
|---|---|---|
| Pooled | host มีคำว่า `-pooler` | `DATABASE_URL` ของแอป (หลังข้อ 2) |
| Direct / Unpooled | ไม่มี `-pooler` | `DATABASE_ADMIN_URL` สำหรับ migration (ใช้ในเครื่องเท่านั้น ไม่ต้องใส่ใน Vercel) |

## 2. สร้างตารางและข้อมูลตั้งต้น (รันจากเครื่องตัวเอง ใน PowerShell)

```powershell
cd "C:\Users\acer\Desktop\AI RESORT\ai-resort"
$env:DATABASE_ADMIN_URL   = "<Direct connection string ของ Neon>"
$env:DATABASE_APP_PASSWORD = "<ตั้งรหัสผ่านใหม่ยาว ๆ สำหรับแอป เช่น สุ่ม 32 ตัว>"
$env:SEED_HOSTS           = "mu-beryl-23.vercel.app"       # โดเมนที่จะเปิดเว็บนี้ (คั่นด้วย , ได้หลายโดเมน)
$env:SEED_OWNER_EMAIL     = "<อีเมลเจ้าของ>"

npm run db:migrate    # สร้างตาราง + role ของแอปชื่อ fahtalay_app (ไม่มีสิทธิ์ข้าม RLS)
npm run db:seed       # สร้างข้อมูลฟ้าทะเล + บัญชีเจ้าของ  ⚠ จดรหัสผ่านที่แสดงครั้งเดียว
```

เพิ่มโดเมนภายหลัง (เช่นโดเมนจริงของรีสอร์ท): `npm run db:domain -- book.fahtalay.com`

## 3. ตั้งค่า Environment Variables ใน Vercel

Vercel → Project → **Settings → Environment Variables** (Production):

| Key | Value |
|---|---|
| `DATABASE_URL` | Pooled connection string แต่เปลี่ยน **user/password** เป็น `fahtalay_app` / `DATABASE_APP_PASSWORD` จากข้อ 2 · ต่อท้าย `?sslmode=require` |
| `APP_SECRET` | ข้อความสุ่มยาวอย่างน้อย 32 ตัว (สร้างได้ด้วย `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
| `DATABASE_POOL_MAX` | `3` (serverless เปิดหลาย instance พร้อมกัน) |

> ⚠ ห้ามใส่ `DATABASE_ADMIN_URL` (สิทธิ์เจ้าของตาราง) ใน Vercel แอปต้องใช้ role `fahtalay_app` เท่านั้น เพื่อให้ RLS แยกข้อมูลโรงแรมทำงาน

แล้วกด **Deployments → Redeploy**

## 4. ตรวจสอบ

- เปิดหน้าแรก → เห็นห้องพัก 3 ประเภท
- `/admin/login` → เข้าด้วยอีเมลและรหัสผ่านจากข้อ 2 → เปลี่ยนรหัสผ่านทันทีที่ “บัญชีของฉัน”
- ถ้ายังขึ้น error: Vercel → **Logs** ค้นหารหัสอ้างอิงที่แสดงบนหน้า

| ข้อความใน Logs | สาเหตุ | แก้ |
|---|---|---|
| `DATABASE_URL is not set` | ยังไม่ได้ตั้งค่าข้อ 3 หรือยังไม่ได้ Redeploy | ข้อ 3 |
| `ไม่พบโรงแรมสำหรับโดเมนนี้` | โดเมนที่เปิดไม่อยู่ใน `tenant_domains` (เช่น URL preview ที่มีเลขสุ่ม) | `npm run db:domain -- <โดเมน>` |
| `APP_SECRET is missing` | ยังไม่ได้ตั้ง `APP_SECRET` | ข้อ 3 |
| `password authentication failed for user "fahtalay_app"` | รหัสผ่านใน `DATABASE_URL` ไม่ตรงกับ `DATABASE_APP_PASSWORD` ตอน migrate | รัน `npm run db:migrate` ใหม่ด้วยรหัสเดิม หรือแก้ `DATABASE_URL` |
| `relation "tenants" does not exist` | ยังไม่ได้ migrate | ข้อ 2 |

## ข้อจำกัดบน Vercel ที่ต้องรู้
- **อัปโหลดรูปห้องจากหลังบ้านยังใช้ไม่ได้บน Vercel** (Vercel เขียนไฟล์ถาวรไม่ได้) รูปเริ่มต้นจาก seed แสดงได้ปกติ — ต้องเพิ่ม object storage (Vercel Blob / S3) ซึ่งอยู่ในรายการ Pending Configuration
- การส่งอีเมล/LINE ยังเป็นคิวในฐานข้อมูล ยังไม่ส่งจริง (Phase 6)
- งานปล่อยห้องที่หมดเวลาทำอัตโนมัติทุกครั้งที่มีคนค้นหา/จอง จึงไม่ต้องตั้ง cron ในตอนนี้
