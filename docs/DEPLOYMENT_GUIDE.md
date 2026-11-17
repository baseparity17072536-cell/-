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

### ทางเลือก: ใช้ Supabase

1. supabase.com → **New project** → Region **Southeast Asia (Singapore)** → ตั้ง Database Password (จดไว้)
2. กดปุ่ม **Connect** ด้านบนของโปรเจกต์ จะเห็น connection string 3 แบบ:

| แบบ | หน้าตา | ใช้กับ |
|---|---|---|
| Direct connection | `postgresql://postgres:[PW]@db.<ref>.supabase.co:5432/postgres` | ไม่แนะนำ (แพ็กเกจฟรีเป็น IPv6 อย่างเดียว เน็ตบ้านส่วนใหญ่ต่อไม่ได้) |
| **Session pooler** | `postgresql://postgres.<ref>:[PW]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres` | `DATABASE_ADMIN_URL` ในข้อ 2 (migrate/seed จากเครื่อง) |
| **Transaction pooler** | `…pooler.supabase.com:6543/postgres` | `DATABASE_URL` ของแอปบน Vercel (ข้อ 3) |

3. ใน `DATABASE_URL` (ข้อ 3) ให้เปลี่ยนผู้ใช้เป็น **`fahtalay_app.<ref>`** (ต้องมี `.<ref>` ต่อท้ายเมื่อผ่าน pooler) และรหัสผ่านเป็น `DATABASE_APP_PASSWORD` เช่น
   `postgresql://fahtalay_app.abcdxyz:<APP_PW>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true`
   (ทดสอบแล้ว: Supabase ใช้ใบรับรองของตัวเอง ถ้าใช้ `sslmode=require` อย่างเดียวจะขึ้น `self-signed certificate in certificate chain`)

**ติดตั้งโดยไม่ต้องส่งรหัสผ่านฐานข้อมูลให้ใคร:** สร้างไฟล์ติดตั้งด้วย
`npx tsx scripts/build-setup-sql.ts --out setup.sql --host <โดเมน>` แล้ววางใน Supabase → **SQL Editor** → Run
(ตรวจไฟล์ก่อนใช้ได้ด้วย `npx tsx scripts/verify-setup-sql.ts setup.sql <app-password> <โดเมน>`) — ไฟล์มีรหัสผ่าน ห้าม commit
4. **ปิด Data API** (แอปนี้ไม่ใช้): Project Settings → Data API → ปิด หรือเอา `public` ออกจาก Exposed schemas
   — migration `0003_supabase_hardening` ถอนสิทธิ์ของ `anon`/`authenticated` จากทุกตารางให้อยู่แล้ว (มี test ยืนยัน) การปิด Data API เป็นชั้นป้องกันเพิ่ม
5. ห้ามนำ `service_role` key หรือ `anon` key มาใส่ในโปรเจกต์นี้ — ไม่จำเป็นต้องใช้

> ระบบนี้ทำงานกับ Transaction pooler ได้ เพราะทุก request ทำงานใน transaction เดียว (ตั้ง `app.tenant_id` ด้วย `SET LOCAL`) และไม่ใช้ named prepared statements
>
> ถ้าเชื่อมต่อแล้วขึ้น `self-signed certificate in certificate chain` ให้ต่อท้าย connection string เป็น `?sslmode=require&uselibpqcompat=true` (เข้ารหัสการเชื่อมต่อแบบเดียวกับ psql) หรือดาวน์โหลด CA certificate จาก Supabase (Database Settings → SSL) เพื่อตรวจสอบใบรับรองเต็มรูปแบบ

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
| `DEFAULT_TENANT_SLUG` | `fahtalay` (ไม่บังคับ) — โรงแรมที่จะแสดงเมื่อเปิดจากโดเมนที่ไม่อยู่ใน `tenant_domains` เช่น URL ของแต่ละ deployment ที่มีเลขสุ่ม · ใช้เฉพาะตอนติดตั้งโรงแรมเดียว ถ้าเป็นแพลตฟอร์มหลายโรงแรมให้เว้นว่าง |

> ⚠ ห้ามใส่ `DATABASE_ADMIN_URL` (สิทธิ์เจ้าของตาราง) ใน Vercel แอปต้องใช้ role `fahtalay_app` เท่านั้น เพื่อให้ RLS แยกข้อมูลโรงแรมทำงาน

แล้วกด **Deployments → Redeploy**

## 4. ตรวจสอบ

- เปิดหน้าแรก → เห็นห้องพัก 3 ประเภท
- `/admin/login` → เข้าด้วยอีเมลและรหัสผ่านจากข้อ 2 → เปลี่ยนรหัสผ่านทันทีที่ “บัญชีของฉัน”
- ถ้ายังขึ้น error: Vercel → **Logs** ค้นหารหัสอ้างอิงที่แสดงบนหน้า

| ข้อความใน Logs | สาเหตุ | แก้ |
|---|---|---|
| `DATABASE_URL is not set` | ยังไม่ได้ตั้งค่าข้อ 3 หรือยังไม่ได้ Redeploy | ข้อ 3 |
| `ไม่พบโรงแรมสำหรับโดเมนนี้` | โดเมนที่เปิดไม่อยู่ใน `tenant_domains` (เช่น URL preview ที่มีเลขสุ่ม) | `npm run db:domain -- <โดเมน>` หรือรัน `scripts/add-vercel-domains.sql` ใน Supabase SQL Editor · URL ที่เปลี่ยนทุก deploy: ตั้ง `DEFAULT_TENANT_SLUG` |
| `APP_SECRET is missing` | ยังไม่ได้ตั้ง `APP_SECRET` | ข้อ 3 |
| `password authentication failed for user "fahtalay_app"` | รหัสผ่านใน `DATABASE_URL` ไม่ตรงกับ `DATABASE_APP_PASSWORD` ตอน migrate | รัน `npm run db:migrate` ใหม่ด้วยรหัสเดิม หรือแก้ `DATABASE_URL` |
| `relation "tenants" does not exist` | ยังไม่ได้ migrate | ข้อ 2 |

## ตำแหน่งเซิร์ฟเวอร์ (สำคัญต่อความเร็ว)
ให้ฟังก์ชันของ Vercel อยู่ region เดียวกับฐานข้อมูล ตั้งใน `vercel.json` → `"regions": ["bom1"]` (Supabase ของฟ้าทะเลอยู่ Mumbai)
วัดจริง 2026-11-17: ก่อนย้าย (iad1 ↔ Mumbai) หน้าค้นหา/กรอกข้อมูล ~5 วินาที · หลังย้าย (bom1) ~0.2–0.5 วินาที
ถ้าติดตั้งให้โรงแรมอื่นที่ฐานข้อมูลอยู่ region อื่น ให้เปลี่ยนค่านี้ให้ตรงกัน (เช่น Singapore = `sin1`)

## ข้อจำกัดบน Vercel ที่ต้องรู้
- **อัปโหลดรูปห้องจากหลังบ้านยังใช้ไม่ได้บน Vercel** (Vercel เขียนไฟล์ถาวรไม่ได้) รูปเริ่มต้นจาก seed แสดงได้ปกติ — ต้องเพิ่ม object storage (Vercel Blob / S3) ซึ่งอยู่ในรายการ Pending Configuration
- การส่งอีเมล/LINE ยังเป็นคิวในฐานข้อมูล ยังไม่ส่งจริง (Phase 6)
- งานปล่อยห้องที่หมดเวลาทำอัตโนมัติทุกครั้งที่มีคนค้นหา/จอง จึงไม่ต้องตั้ง cron ในตอนนี้
