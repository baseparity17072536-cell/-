# Architecture Decision Records

แต่ละรายการบันทึกการตัดสินใจที่มีผลต่อโครงสร้างระบบ เหตุผล และผลที่ตามมา
สถานะ: **Accepted** = ใช้งานอยู่ · **Superseded** = ถูกแทนที่

---

## ADR-0001 · Modular monolith บน Next.js + PostgreSQL แบบ shared schema
**สถานะ:** Accepted · 2026-11-17 · อ้างอิง Phase 0 §2, §10

- หน้าเว็บ หลังบ้าน และ API อยู่ในโปรเจกต์ Next.js 16 เดียว logic ทางธุรกิจทั้งหมดอยู่ใน `src/server/*` ซึ่งไม่ผูกกับ UI
- ทุกโรงแรม (tenant) ใช้ฐานข้อมูลเดียวกัน แยกข้อมูลด้วย `tenant_id` + PostgreSQL Row-Level Security + composite foreign key `(tenant_id, id)`
- **ผลที่ตามมา:** ดูแลง่าย ต้นทุนต่ำ ย้าย tenant ใหญ่ไปฐานข้อมูลแยกได้ภายหลัง เพราะทุกแถวมี `tenant_id`

## ADR-0002 · SQL migration เขียนเอง + `pg` แทน Drizzle ORM
**สถานะ:** Accepted · 2026-11-17 · **เปลี่ยนจาก** Phase 0 (เสนอ Drizzle)

- ความปลอดภัยของระบบพึ่ง RLS policy, CHECK constraint, exclusion constraint (`btree_gist`) และ role grants ซึ่งเขียนเป็น SQL ตรงได้ชัดเจนที่สุด Drizzle ยังไม่รองรับ exclusion constraint และจะทำให้ schema ถูกนิยามซ้ำสองที่
- ใช้ `db/migrations/NNNN_name.up.sql` + `.down.sql` ทุก migration รันใน transaction และบันทึกใน `schema_migrations`
- query ทั้งหมดใช้ parameter (`$1`) ห้ามต่อ string จาก input — ป้องกัน SQL injection
- test suite รัน migration up → down ทั้งหมด → up ทุกครั้ง เพื่อพิสูจน์ว่า rollback ใช้ได้จริง

## ADR-0003 · Inventory ledger รายคืน + constraint ในฐานข้อมูล (กันจองเกิน)
**สถานะ:** Accepted · 2026-11-17 · อ้างอิง Phase 0 §9, Addendum Part 3

- ตาราง `inventory_nights` (ประเภทห้อง × คืน) มี `total / held / sold` และ `CHECK (held + sold <= total)`
- `total` = จำนวนห้องจริงที่สถานะ `active` (ห้องปิดซ่อม `maintenance` ไม่ถูกนับ) จึง **ไม่หักห้องซ่อมซ้ำ** — สูตรของ Addendum
  `Sellable = Total − Confirmed − Holds − Out of Order` ได้ผลเท่ากัน โดย Total ใน Addendum = ห้องจริงทั้งหมด (`physical`) และ `total` ของเรา = `physical − outOfOrder`
- ล็อกแถวตามลำดับ (ประเภทห้อง, วันที่) ป้องกัน deadlock · ห้องจริงกันซ้อนด้วย exclusion constraint บน `daterange`
- **หลักฐาน:** test ยิง 50 คำขอพร้อมกันจองห้องสุดท้าย 3 ห้อง → สำเร็จ 3 · mutation test ลบ constraint แล้ว test ล้มทันที (50/50 สำเร็จ)

## ADR-0004 · ลำดับการคำนวณราคา (Price Rule Priority)
**สถานะ:** Accepted · 2026-11-17 · อ้างอิง Addendum Part 2.3

ราคาต่อคืนต่อห้อง คำนวณตามลำดับนี้ และบันทึกแหล่งที่มาไว้ใน `booking_nights.price_source` ทุกคืน:

1. **ราคากำหนดรายวัน** (`daily_rates.price_satang`) — ชนะทุกกฎ
2. **กฎราคา** (`price_rules`: วันในสัปดาห์ / ฤดูกาล / เทศกาล / อีเวนต์) — เลือก `priority` สูงสุด ถ้าเท่ากันเลือกกฎที่สร้างล่าสุด ถ้ายังเท่ากันเลือกตาม id (ผลลัพธ์แน่นอนเสมอ)
3. **ราคาพื้นฐาน** ของประเภทห้อง
4. ปรับตาม **Rate Plan** (เช่น รวมอาหารเช้า +x%)
5. **โปรโมชั่น** (Phase 4)
6. **ค่าบริการ + VAT** (ADR-0005)

ค่าผู้ใหญ่เพิ่ม/เด็ก/เตียงเสริม คิดแยกต่อคืน ไม่ถูกปรับด้วยกฎราคา

## ADR-0005 · ภาษีและค่าบริการ
**สถานะ:** Accepted · 2026-11-17 · อ้างอิง Addendum Part 2.5

- ตั้งค่าต่อที่พัก: `prices_include_tax`, `service_charge_bp`, `vat_bp` (basis points, 700 = 7%)
- ตามธรรมเนียมไทย: ค่าบริการคิดจากราคาสุทธิ VAT คิดจาก (ราคาสุทธิ + ค่าบริการ)
- ราคารวมภาษี → แยกองค์ประกอบออกมาแสดง ยอดรวมไม่เปลี่ยน · ราคาไม่รวมภาษี → บวกเพิ่ม **ครั้งเดียว**
- ฐานข้อมูลบังคับสูตรด้วย `bookings_total_formula` จึงคิดภาษีซ้ำไม่ได้
- ระบบนี้ **ไม่ใช่** ระบบออกใบกำกับภาษีอิเล็กทรอนิกส์ (ต้องเชื่อมผู้ให้บริการที่ได้รับอนุญาต — Phase 6/7)

## ADR-0006 · ผู้อนุมัติ (Maker-checker) สำหรับการเปลี่ยนแปลงสำคัญ
**สถานะ:** Accepted · 2026-11-17 · ตามคำขอเจ้าของโปรเจกต์ "แอดมินแก้ไขบางส่วน ผู้อนุมัติจริงคือทั้งหมด"

| บทบาท | ทำได้ทันที | ต้องรออนุมัติ |
|---|---|---|
| เจ้าของ (owner) | ทุกอย่าง + อนุมัติคำขอ | — |
| แอดมิน (admin) | การจอง, ข้อมูลห้อง/รูป/ห้องจริง | ราคา, กฎราคา, แพ็กเกจ, ปิด/เปิดขาย, ตั้งค่าที่พัก, ยกเลิกการจองที่ยืนยันแล้ว |
| พนักงานต้อนรับ | การจอง, เช็คอิน/เอาท์, จัดห้อง | ยกเลิกการจองที่ยืนยันแล้ว |
| บัญชี | ดูการจอง/รายงาน | — |

- คำขอเก็บ payload ที่ผ่านการตรวจแล้วใน `change_requests` เมื่ออนุมัติจะรันผ่านฟังก์ชันเดียวกับที่เจ้าของใช้ (ไม่มีโค้ดซ้ำ)
- ฐานข้อมูลห้ามผู้ขออนุมัติคำขอของตัวเอง (`CHECK reviewed_by <> requested_by`)
- ถ้าข้อมูลเปลี่ยนไปหลังส่งคำขอ (เช่น version การจองไม่ตรง) คำขอจะถูกบันทึกเป็น `failed` พร้อมเหตุผล ไม่ apply ทับ

## ADR-0007 · ฐานข้อมูลสำหรับพัฒนาและทดสอบ: embedded PostgreSQL
**สถานะ:** Accepted · 2026-11-17

- เครื่องพัฒนาไม่มี Docker/PostgreSQL จึงใช้แพ็กเกจ `embedded-postgres` (PostgreSQL 18 จริง ไม่ใช่ตัวจำลอง) รันในโฟลเดอร์โปรเจกต์ ไม่ติดตั้งลงระบบ
- test suite เปิด PostgreSQL แยกชั่วคราวทุกครั้ง ไม่แตะข้อมูลพัฒนา
- production ใช้ PostgreSQL ที่จัดการโดยผู้ให้บริการ (เช่น Neon / Supabase / RDS) ผ่าน `DATABASE_URL` — โค้ดเหมือนกันทุกประการ

## ADR-0008 · ลำดับงานของ Addendum
**สถานะ:** Accepted · 2026-11-17 · อ้างอิง Addendum Part 15

Addendum ระบุว่าห้ามเริ่มฟังก์ชันเสริมก่อน Booking Engine, Inventory, Payment และ Tenant Isolation ผ่านการทดสอบ จึงแบ่งเป็น:
- **ใส่ใน Phase 1 ทันที** (กระทบโครงสร้างข้อมูลหลัก): ข้อมูลห้องเพิ่มเติม, bulk room creation, กฎราคา + ลำดับความสำคัญ, ภาษี/ค่าบริการ, ประวัติการแก้ราคา, inventory แยก out-of-order
- **เลื่อนไปตาม dependency** — ดู `docs/ROADMAP.md`
