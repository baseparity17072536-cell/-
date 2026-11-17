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

### ถัดไป
- หลังบ้านใหม่ (UI): login, dashboard, การจอง, จองแทนลูกค้า, ปฏิทินห้องว่าง/ราคา, ห้อง, กฎราคา, คำขออนุมัติ, พนักงาน, audit log
- ย้ายหน้าจองลูกค้าไปใช้ฐานข้อมูล แล้วเลิกใช้ `lib/bookings.ts` / `data/bookings.json`
