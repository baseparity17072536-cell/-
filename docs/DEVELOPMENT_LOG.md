# Development Log

## 2026-11-17

### Phase 0 — วิเคราะห์และออกแบบ ✅
- ตรวจต้นแบบ, ออกแบบสถาปัตยกรรม, ER, โครงสร้างไฟล์ → `docs/PHASE-0-REPORT.md`

### ตรวจและแก้โค้ดต้นแบบ (branch `main`, push แล้ว)
- ตั้ง Git + baseline commit · TypeScript/ESLint/build ผ่าน
- แก้: ข้อมูลส่วนตัวลูกค้ารั่วในหน้า `/booking/[code]`, ไม่จำกัดการเดารหัสผ่าน/เบอร์, ลิงก์และปุ่มที่ไม่ทำงาน, โปรโมชั่นที่ระบบไม่ได้คิดจริง, เลือกวันย้อนหลังได้ · เพิ่มหน้าเงื่อนไขการจอง

### Phase 1 — Core backend (branch `phase-1`)
- Migration `0001_core`: 23 ตาราง, RLS ทุกตารางของ tenant, composite FK, role `app_runtime` (ไม่มี BYPASSRLS, ลบ audit log ไม่ได้)
- Migration `0002_rooms_pricing_tax`: ตาม Addendum Part 1–3 (code/วิว/เตียง/อาคาร/วิดีโอ, building/zone/housekeeping, `price_rules`, VAT/service charge, `price_source`)
- Services: `booking`, `inventory`, `pricing`, `catalog`, `approvals`, `auth`, `tenancy`, `rbac`, `audit`
- ผู้อนุมัติ (maker-checker) ตามคำขอเจ้าของ
- Test: 43 tests ผ่าน (unit + integration กับ PostgreSQL จริง)
  - 50 คำขอพร้อมกันจอง 3 ห้อง → สำเร็จ 3 พอดี
  - Mutation test: ลบ constraint กันจองเกิน → test ล้ม (พิสูจน์ว่า test จับบั๊กได้จริง)
  - Tenant isolation: ไม่ตั้ง tenant = เห็น 0 แถว, เขียนข้ามโรงแรมไม่ได้, FK ข้ามโรงแรมไม่ได้

### ปัญหาที่พบระหว่างทำ
| ปัญหา | แก้ |
|---|---|
| `@types/node@20` ขัดกับ vitest 5 บน Node 26 | อัปเป็น `@types/node@24` |
| npm 11 บล็อก install script ของ PostgreSQL/esbuild | ตรวจสคริปต์แล้วอนุญาตเฉพาะ 2 แพ็กเกจ |
| ลบโฟลเดอร์ test DB บน Windows ไม่ได้ (EBUSY) | ลบเองพร้อม retry |
| push GitHub จาก terminal ไม่มีหน้าต่างล็อกอิน | ใช้ Git Credential Manager โหมด browser |

### Phase 1 — หลังบ้าน (UI) + ย้ายหน้าเว็บลูกค้าขึ้นฐานข้อมูล
- หลังบ้านใหม่ `/admin`: เข้าสู่ระบบ/ลืมรหัสผ่าน/ตั้งรหัสใหม่, ภาพรวมวันนี้, การจอง (ค้นหา/กรอง), รายละเอียดการจอง (เปลี่ยนสถานะ จัดเลขห้อง ประวัติ), จองแทนลูกค้า (โทร/Walk-in/Facebook/LINE), ปฏิทินห้องว่าง & ราคา (แก้จากปฏิทินได้ทันที), ห้องพัก (ประเภทห้อง รูป ห้องจริง เพิ่มทีละหลายห้อง สถานะแม่บ้าน ประวัติห้อง), แพ็กเกจ & กฎราคา, รายการรออนุมัติ, พนักงาน + ตารางสิทธิ์, ตั้งค่าที่พัก & ภาษี, ประวัติการแก้ไข, เปลี่ยนรหัสผ่าน
- หน้าเว็บลูกค้า (`/`, `/booking/*`) อ่าน/เขียนฐานข้อมูลจริง ราคา ห้อง เบอร์โทร ที่อยู่ มาจากหลังบ้าน ไม่ hard-code
- ลบไฟล์ระบบเดิม: `lib/bookings.ts`, `lib/admin-auth.ts`, `lib/rate-limit.ts`, หน้า `/admin` เดิม · `lib/rooms.ts` ย้ายเป็นข้อมูลตั้งต้น `db/seed-data/fahtalay.ts`
- ธีม Luxury Coastal ตามที่กำหนด (Deep Sea / Champagne Gold / Ivory / Sea Mist)
- รองรับมือถือ: ปฏิทินเลื่อนไปวันนี้อัตโนมัติ, รายการจองเป็นการ์ด, เมนูพับ, ไม่มีหน้าใดเลื่อนแนวนอน (ตรวจที่ความกว้าง 412px)
- E2E (Playwright, Chromium จริง) 5 flow × desktop + mobile = 10 + setup 1 → ผ่านทั้งหมด

### บั๊กที่พบและแก้ระหว่างทดสอบ
| บั๊ก | ผลกระทบ | แก้ |
|---|---|---|
| ข้อความ "สำเร็จ" หายหลังยืนยัน/ยกเลิก (ปุ่มหายเพราะสถานะเปลี่ยน) | ผู้ใช้ไม่แน่ใจว่าทำสำเร็จ | redirect พร้อมแถบแจ้งผลบนหน้า |
| `Date.now()` ระหว่าง prerender (Cache Components) | คำเตือน dev ทุกหน้า | `connection()` ใน `getTenant()` |
| หน้าแอดมินไม่มี loading boundary ต่อหน้า | เปลี่ยนหน้าไม่ instant | `loading.tsx` ทุกโฟลเดอร์ (ใช้ component เดียว) |
| จัดห้องเดียวกันพร้อมกัน → deadlock (ADR-0010) | ข้อความผิด (ข้อมูลไม่เสีย) | ล็อกห้องก่อน insert + test 25 รอบ |
| พอร์ต test DB ค้างจากรอบก่อน | test รันไม่ได้ | เลือกพอร์ตว่างอัตโนมัติ |
| หน้าสถานะการจองแสดงเลขบัญชีตัวอย่าง `xxx-x-xxxxx-x` | ข้อมูลปลอมให้ลูกค้า | แสดงช่องทางติดต่อจริงจนกว่าจะมีระบบบัญชีธนาคาร (Phase 2) |
| ภาษาไทยเพี้ยน (ข้อความต่อจาก “สวัสดี” กลายเป็นอักษรขยะ “เน” + “เธ” สลับกัน) ในหลังบ้าน production | ชื่อเจ้าของ + ชื่อ/คำอธิบายแพ็กเกจแสดงผิด | สาเหตุ: แก้ `db/seed.ts` ด้วย PowerShell 5.1 ซึ่งอ่าน UTF-8 เป็น ANSI แล้วเขียนกลับ · กู้ไฟล์จาก commit ที่ถูก, แก้ข้อมูล 3 รายการใน Supabase (สแกนทุกตาราง ก่อน 3 → หลัง 0), เพิ่ม test สแกนทุกไฟล์หาข้อความเพี้ยน/BOM (ทดสอบแล้วว่าจับไฟล์เสียได้ 5/5 จุด) · กฎใหม่: ห้ามแก้ไฟล์ข้อความด้วย `Get-Content`/`Set-Content` ของ PowerShell 5.1 |

### Production (Vercel + Supabase) — 2026-11-17
- เว็บจริง https://mu-beryl-23.vercel.app เชื่อม Supabase (Mumbai) ผ่าน role `fahtalay_app` + RLS
- ติดตั้งด้วยไฟล์ SQL เดียว (`scripts/build-setup-sql.ts`) ผ่าน Supabase SQL Editor — ไม่ต้องส่งรหัสผ่านฐานข้อมูล
- Vercel env เหลือ 3 ค่า (2 ค่าเป็น Secret) · ลบค่าของเครื่องพัฒนาที่ถูกคัดลอกขึ้นไปออกทั้งหมด

### โดเมน Vercel ขึ้น “ไม่พบโรงแรมสำหรับโดเมนนี้” — 2026-11-18
- `scripts/add-vercel-domains.sql`: ลงทะเบียน `mu-beryl-23.vercel.app`, `sommao.vercel.app`, `git-main-sommao.vercel.app` (รันซ้ำได้)
- `DEFAULT_TENANT_SLUG` (ไม่บังคับ): โดเมนที่ไม่รู้จักใช้โรงแรมนี้แทน สำหรับ URL ของแต่ละ deployment ที่เปลี่ยนทุกครั้ง · โดเมนที่ลงทะเบียนไว้มีลำดับสูงกว่าเสมอ
- Test: `tests/integration/tenancy-host.test.ts` (5 กรณี)

### ปิด Phase 1 — 2026-11-18
- Test รูปห้อง `tests/integration/room-images.test.ts` (8 กรณี) · mutation: ปิดการตรวจ magic bytes → test ล้ม
- เอกสาร: `API_REFERENCE.md`, `USER_MANUAL.md`, `PHASE-1-REPORT.md`
- Vitest รวม 59 tests ผ่าน · พบว่า MFA เจ้าของ (D7) ยังไม่ได้ทำ → ใส่ในรายการตัดสินใจ P1-2

### ยืนยันตัวตน 2 ขั้นตอน (MFA) — 2026-11-18
เจ้าของอนุมัติ P1-1 ถึง P1-4 ตามที่เสนอ
- TOTP (RFC 6238) บน `node:crypto` · บังคับบทบาทเจ้าของ · รหัสกู้คืน 10 รหัส · secret เข้ารหัส AES-256-GCM · กันใช้รหัสซ้ำ · ล็อกบัญชีร่วมกับรหัสผ่านผิด → ADR-0011
- Migration `0004_mfa` + `scripts/upgrade-0004-mfa.sql` สำหรับ Supabase (ทดสอบบน dev: rollback → รันไฟล์ → รันซ้ำแล้วหยุดอย่างปลอดภัย)
- หน้าใหม่ `/admin/login/verify`, `/admin/mfa-setup` · บัญชีของฉัน: สถานะ/รหัสกู้คืนใหม่/ตั้งค่าเครื่องใหม่ · พนักงาน: ป้ายสถานะ + รีเซ็ต
- Test: unit 9 (test vector RFC 4226/6238, การเข้ารหัส, รหัสกู้คืน) + integration 12 + E2E 1 (Chromium จริง ใช้บัญชีชั่วคราวใน dev DB)
- Mutation: ปิดการกันใช้รหัสซ้ำ → 2 test ล้ม · ลบการตรวจ `mfa_ok` → ตอนแรก **ไม่มี test ล้ม** จึงเพิ่ม test ชั้นป้องกันซ้อน → ล้มแล้ว
- บั๊กที่ E2E จับได้: หลังยืนยัน หน้า refresh แล้ว redirect ทันที ผู้ใช้ **ไม่เห็นรหัสกู้คืน** → action นี้ไม่ refresh หน้า
- E2E owner login (`auth.setup.ts`) รองรับ MFA: ตั้งค่าอัตโนมัติครั้งแรกแล้วเก็บ secret ใน `playwright/.auth/` (git-ignored)

### ที่เก็บรูป Vercel Blob (P1-3) — 2026-11-18
- `storage.ts` เลือก driver ตาม env: มี `BLOB_READ_WRITE_TOKEN` → Vercel Blob (`@vercel/blob@2.8.2`, public, `rooms/<tenant>/<uuid>.<ext>`, cache 1 ปี, ไม่ทับไฟล์เดิม) · ไม่มี → ดิสก์ (dev) · บน Vercel แต่ยังไม่เปิด Blob → ข้อความบอกสาเหตุแทน EROFS
- ลบไฟล์เฉพาะของโรงแรมตัวเอง (`deleteStoredFile(tenantId, url)` ตรวจ host, https, path, ไม่มี query) · `next.config` อนุญาตเฉพาะ `*.public.blob.vercel-storage.com/rooms/**`
- Test เพิ่ม 4 (mock SDK) · mutation: ตัดการตรวจโรงแรมตอนลบ → test ล้ม

### Deploy + ปิดการบังคับ MFA ช่วงทดสอบ — 2026-11-18
- เจ้าของรัน `upgrade-0004-mfa.sql` แล้ว · push `phase-1` → `main` · ตรวจเว็บจริงผ่าน
- ตั้งรหัสผ่านเจ้าของใหม่ผ่าน SQL (รหัสเดิมแสดงครั้งเดียวตอนติดตั้ง ไม่มีที่เก็บ)
- เจ้าของขอปิดการบังคับ MFA เพื่อทดสอบ → `MFA_REQUIRED_ROLES` (ไม่ตั้ง = ไม่บังคับ) · ⚠ ต้องตั้ง `owner` ก่อนเปิดใช้จริง

### Phase 3 ส่วนที่ 1: งานหน้าเคาน์เตอร์ — 2026-11-18
- หน้าแรก: ปุ่มเช็คอิน/เช็คเอาท์ในรายการ, ลูกค้าเลยวันเข้าพักแต่ยังไม่มา (เช็คอิน/ไม่มาเข้าพัก), ผู้เข้าพักเลยวันเช็คเอาท์, ห้องที่ยังไม่สะอาด
- แก้ไขการจอง `/admin/bookings/[code]/edit`: เปลี่ยนวันที่ (คืนเดิมราคาเดิม), เปลี่ยนประเภทห้อง/อัปเกรดฟรี, แก้ข้อมูลลูกค้า — สิทธิ์ใหม่ `booking.modify`
- ย้ายห้องระหว่างเข้าพักเริ่มจากวันนี้ (คืนที่พักไปแล้วไม่ชนกับห้องใหม่) · เช็คเอาท์/ย้ายออก → ห้องเป็น "รอทำความสะอาด" · no-show ได้ตั้งแต่วันเช็คอิน
- ไม่มี migration ใหม่
- เทสต์: `booking-changes.test.ts` 10 เคส (mutation 3 จุดถูกจับได้ทั้งหมด) · E2E `booking-edit.spec.ts` desktop + mobile
- บั๊กที่ E2E เจอ: บนมือถือตารางในหน้าแรกดันคอลัมน์ grid กว้างเกินจอ ปุ่มด้านขวากดไม่ได้ → `min-w-0`
- หมายเหตุ E2E: router ของ Next เก็บหน้าก่อนหน้าไว้ใน DOM (ซ่อนอยู่) ฟิลด์ชื่อซ้ำกันจึงต้องจำกัดขอบเขต locator

### Phase 3 ส่วนที่ 2: แม่บ้าน + แจ้งซ่อม — 2026-11-18
- กระดานแม่บ้าน `/admin/housekeeping`: สถานะทุกห้อง ผู้เข้าพัก แขกเข้าวันนี้ ลำดับความสำคัญ (ห้องสกปรกที่มีแขกเข้าวันนี้ก่อน)
- แจ้งซ่อม `/admin/maintenance` + migration `0005_maintenance`: ห้องหรือจุดส่วนกลาง, ความเร่งด่วน, ปิดห้องงดขายระหว่างซ่อม (ปรับ inventory) และเปิดคืนเมื่อปิดงาน (ห้องเป็นรอทำความสะอาด)
- สิทธิ์ใหม่ `housekeeping.update`, `maintenance.report`, `maintenance.manage` · การปิด/เปิดห้องขายต้องมี `catalog.edit`
- เทสต์: `operations.test.ts` 5 เคส (mutation 5 จุดถูกจับได้หลังเพิ่มแถว inventory ในเทสต์) · E2E `operations.spec.ts` desktop + mobile
- `scripts/upgrade-0005-maintenance.sql` ทดสอบแล้วบนฐานข้อมูลในเครื่อง (rollback → รันไฟล์ → รันซ้ำหยุดด้วย already exists)

### ถัดไป
- ตั้ง `MFA_REQUIRED_ROLES=owner` ก่อนเปิดใช้จริง
- เปิด Vercel Blob store (`DEPLOYMENT_GUIDE.md`)
- Phase 3 ต่อ: ค่าใช้จ่ายระหว่างพัก (folio), ปิดยอดประจำวัน, รายงาน
- Phase 2: PromptPay QR + สลิป (P1-4)
- Phase 2 — Payment (ต้องการข้อมูลบัญชี/PromptPay/gateway จากเจ้าของ)
