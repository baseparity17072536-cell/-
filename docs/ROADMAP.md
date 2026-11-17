# Roadmap — FAHTALAY Booking Engine

รวม Master Command (Phase 1–7) และ Project Addendum (Part 1–15) เป็นแผนเดียว ไม่สร้างโมดูลซ้ำ
ลำดับยึด dependency: ระบบจอง + inventory + tenant isolation → การชำระเงิน → งานโรงแรม → การตลาด → white-label → เชื่อมต่อภายนอก → production

สถานะ: ✅ เสร็จและผ่าน test · 🟡 กำลังทำ · ⬜ ยังไม่เริ่ม · 🔑 รอข้อมูลจากเจ้าของ

## Phase 1 — Core System 🟡

| โมดูล | Backend + DB | UI | Test |
|---|---|---|---|
| Multi-tenant foundation (RLS, composite FK, app role) | ✅ | — | ✅ isolation |
| Auth: login/logout, session, lockout, rate limit, password reset | ✅ | ✅ | ✅ + E2E |
| User management + RBAC 4 บทบาท | ✅ | ✅ | ✅ |
| ผู้อนุมัติ (maker-checker) | ✅ | ✅ | ✅ |
| Property settings (+ ภาษี/ค่าบริการ) | ✅ | ✅ | ✅ |
| Room types (code, วิว, เตียง, อาคาร, วิดีโอ, สิ่งอำนวยความสะดวก) | ✅ | ✅ | ✅ |
| Physical rooms + bulk create (A101–A110) + housekeeping status + ประวัติห้อง | ✅ | ✅ | ✅ |
| Room images (อัปโหลด ตรวจ magic bytes จัดลำดับ ลบ) | ✅ | ✅ | 🟡 ยังไม่มี test อัตโนมัติ |
| Rate plans (แพ็กเกจ เช่น รวมอาหารเช้า) | ✅ | ✅ | ✅ |
| Price rules (วันธรรมดา/ศุกร์/เสาร์/ฤดูกาล/เทศกาล) + ลำดับความสำคัญ | ✅ | ✅ | ✅ |
| Daily rate calendar (หลายวัน, ช่วงวัน, เลือกวันในสัปดาห์, ปิดขาย, พักขั้นต่ำ) | ✅ | ✅ | ✅ + E2E |
| Availability / inventory รายวัน (ทั้งหมด/จอง/hold/ซ่อม/ขายได้) | ✅ | ✅ | ✅ |
| Booking engine: hold, หมดอายุ, กันจองซ้ำ, idempotency, สถานะ 8 แบบ | ✅ | ✅ | ✅ concurrency + E2E |
| Walk-in / Phone booking (จองแทนลูกค้า) | ✅ | ✅ | ✅ + E2E |
| Room assignment, check-in/out | ✅ | ✅ | ✅ + E2E |
| Audit log (พร้อมค่าก่อน/หลังของราคา) | ✅ | ✅ | ✅ |
| หน้าเว็บลูกค้าย้ายมาใช้ฐานข้อมูล | ✅ | ✅ | ✅ E2E |
| รองรับมือถือ (เว็บลูกค้า + หลังบ้าน) | — | ✅ | ✅ E2E mobile |
| Outbox แจ้งเตือน (คิวเท่านั้น ส่งจริง Phase 6) | ✅ | — | — |

## Phase 2 — Payment ⬜
โอนธนาคาร, จัดการบัญชีธนาคาร, PromptPay QR, อัปโหลด/ตรวจสลิป, Payment gateway + webhook 🔑, มัดจำ/จ่ายบางส่วน/จ่ายเต็ม, คืนเงิน, Payment ledger, ใบยืนยันการจอง PDF
+ จาก Addendum Part 7: Deposit management, Outstanding balance, Refund management

## Phase 3 — Hotel PMS ⬜
Dashboard ตามบทบาท, จัดการการจอง, ย้าย/อัปเกรดห้อง, Early check-in/Late check-out, No-show, Housekeeping, Maintenance + Maintenance calendar, Guest management, Extra charges (folio: อาหารเช้า, สัตว์เลี้ยง, บริการเพิ่ม — ต่อคน/คืน/ห้อง/ครั้ง), Night audit / Daily closing, Shift handover, Guest request, Lost & found, Occupancy reports, Group/Corporate booking
+ Addendum Part 8: Staff scheduling, Task assignment, Room inspection
+ Addendum Part 7 (ส่วนรายงาน): Revenue by room type, Daily cash report, Expense management, Tax reports

## Phase 4 — Marketing & CRM ⬜
Promotions (Promo code, Early Bird, Last Minute, Flash Sale, Weekday Deal, Stay Longer), Membership/Loyalty points, Customer profile/history, Reviews, Segmentation, Campaigns, Birthday coupon, Marketing reports, LINE marketing (ตามความยินยอม PDPA)

## Phase 5 — White-label & License ⬜
Tenant provisioning, Custom domain/Subdomain, Logo/Brand color/Theme, Email branding, License (Perpetual, Feature entitlement, Activation, Verification, Transfer), Suspension, Platform super admin
+ Addendum Part 10: Multi-property (Property switcher, dashboard/รายงานแยกและรวมสาขา) — **โครงสร้างฐานข้อมูลรองรับแล้วตั้งแต่ Phase 1** (`properties`)
+ Addendum Part 11: Customer/License management, Installation records, Support ticket, Knowledge base, Release notes, SLA/Maintenance agreement, Standard/Enterprise edition

## Phase 6 — External Integration ⬜ 🔑
LINE OA, Email, SMS, Payment provider, Channel manager adapter, Agoda/Booking.com (เมื่อได้สิทธิ์ API เท่านั้น ห้าม scraping), Reservation import/modify/cancel, Availability/Rate sync, Integration logs, Retry queue, Reconciliation
+ Addendum Part 5: Excel/CSV import-export (template, preview, validation, history, กันนำเข้าซ้ำ)

## Phase 7 — Testing & Production ⬜
Functional/E2E/Security/Load/Responsive/Browser testing, Backup + **ทดสอบกู้คืนจริง**, PITR, Monitoring, Error tracking, Security event log, Suspicious activity alert, Data retention, PDPA data request, Incident response, SEO, Deployment config, เอกสารทั้งหมดใน `docs/09-*` ถึง `docs/14-*`, FINAL_* reports

## Pending Configuration (ข้อมูลที่ต้องได้จากเจ้าของ)
| รายการ | ใช้ใน | สถานะ |
|---|---|---|
| ราคา/จำนวนห้องจริงของฟ้าทะเล (ตอนนี้ใช้ค่าจาก mockup 7/5/3 ห้อง) | Phase 1 | 🔑 แก้ได้เองในหลังบ้านเมื่อ UI เสร็จ |
| ภาษี: ราคารวม VAT หรือไม่, มี service charge หรือไม่, เลขผู้เสียภาษี | Phase 1–2 | 🔑 ค่าเริ่มต้น: รวม VAT 7%, ไม่มี service charge |
| เลขบัญชีธนาคาร / PromptPay ID จริง | Phase 2 | 🔑 |
| Payment gateway (Omise / 2C2P / GB Prime Pay) + sandbox key | Phase 2 | 🔑 |
| LINE OA channel token, อีเมลผู้ส่ง (Resend API key) | Phase 6 | 🔑 |
| สิทธิ์ API Agoda / Booking.com | Phase 6 | 🔑 |
| โดเมนแพลตฟอร์ม + โดเมนโรงแรม | Phase 5/7 | 🔑 |
| ผู้ให้บริการ PostgreSQL production + hosting | Phase 7 | 🔑 |
