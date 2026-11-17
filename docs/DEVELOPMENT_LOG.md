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

### ถัดไป
- ส่วนที่เหลือของ Phase 1: Phase 1 completion report, เอกสาร API/คู่มือฉบับแรก
- Phase 2 — Payment (ต้องการข้อมูลบัญชี/PromptPay/gateway จากเจ้าของ)
