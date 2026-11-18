# API Reference — FAHTALAY Booking Engine (Phase 1)

ฉบับแรก · 2026-11-18 · ปรับปรุง: เพิ่มการยืนยันตัวตน 2 ขั้นตอน (MFA)

> **ยังไม่มี REST API สาธารณะ** (`/api/v1/*`) — ตามข้อ D9 ใน `PHASE-0-REPORT.md` จะเปิดเมื่อเริ่ม Phase ที่ต้องใช้ (Payment webhook ใน Phase 2, Partner/Channel ใน Phase 6)
> ใน Phase 1 ทุกการทำงานผ่าน **Server Actions** ของ Next.js ซึ่งเรียกได้เฉพาะจากฟอร์มในเว็บนี้เอง (มี Origin check ของ Next.js) และทุกกติกาถูกตรวจซ้ำใน service layer (`src/server/*`)

## 1. โครงสร้างการเรียก

```
ฟอร์ม (browser)
  → Server Action  src/app/actions.ts (ลูกค้า) · src/app/admin/actions.ts (หลังบ้าน)
      ตรวจรูปแบบข้อมูล, rate limit, สิทธิ์ (requireStaff)
  → Service        src/server/*.ts
      ตรวจสิทธิ์ซ้ำ (RBAC), กติกาธุรกิจ, maker-checker, audit log
  → PostgreSQL     role fahtalay_app + RLS ตาม app.tenant_id
```

กติกาที่ใช้ทุก action:

| เรื่อง | กติกา |
|---|---|
| ระบุโรงแรม | จาก Host header เท่านั้น (`tenant_domains`, สำรองด้วย `DEFAULT_TENANT_SLUG`) — ไม่รับ tenant id จาก client |
| ตัวตนพนักงาน | cookie `ft_session` (httpOnly, SameSite=Lax, Secure บน production) อายุ 12 ชั่วโมง · ผู้ที่เปิด MFA: session ต้องผ่านขั้นที่ 2 (`mfa_ok`) · เจ้าของที่ยังไม่ตั้ง MFA ถูก redirect ไป `/admin/mfa-setup` ทุกหน้าและทุก action |
| ผลลัพธ์ | `{ ok?: string; error?: string; link?: string }` ข้อความเป็นภาษาไทยที่แสดงผู้ใช้ได้ หรือ redirect ไปหน้าถัดไป |
| ข้อผิดพลาดที่คาดได้ | `DomainError` / `ForbiddenError` → ส่ง `error` กลับ · ข้อผิดพลาดอื่นถูก log ฝั่งเซิร์ฟเวอร์ และผู้ใช้เห็นข้อความทั่วไป |
| เงิน | เก็บเป็น **สตางค์** (integer) · ฟอร์มรับเป็นบาท |
| วันที่ | `YYYY-MM-DD` ตามเวลา Asia/Bangkok · คืนสุดท้ายคือ `check_out - 1` |
| ต้องอนุมัติ | ถ้าบทบาทได้สิทธิ์แบบ `approval` action จะสร้างคำขอแทนการแก้ทันที และตอบ “ส่งคำขอให้เจ้าของอนุมัติแล้ว…” |

## 2. Routes (HTTP)

| Path | ใคร | หมายเหตุ |
|---|---|---|
| `/` | ลูกค้า | หน้าแรก ค้นหาห้องว่าง |
| `/booking?checkin&checkout&guests&rooms&children` | ลูกค้า | เลือกห้อง/แพ็กเกจ แสดงราคาจากระบบราคาจริง |
| `/booking/details` | ลูกค้า | กรอกข้อมูลผู้จอง → `createBookingAction` |
| `/booking/[code]` | ลูกค้าเจ้าของการจอง | ดูได้เฉพาะ browser ที่ได้สิทธิ์ (cookie ที่ลงชื่อด้วย `APP_SECRET`) หลังจองหรือหลังค้นหาด้วยเบอร์โทร |
| `/booking/lookup` | ลูกค้า | ค้นหาการจองด้วยรหัส + เบอร์โทร |
| `/booking/policy` | ทุกคน | เงื่อนไขการจอง |
| `/media/[tenant]/[file]` | ทุกคน | รูปที่อัปโหลด ส่งเฉพาะบนโดเมนของโรงแรมเจ้าของรูป · ชื่อไฟล์ต้องเป็น `uuid.(jpg\|png\|webp)` · `X-Content-Type-Options: nosniff` |
| `/admin/login`, `/admin/forgot-password`, `/admin/reset-password?token=` | พนักงาน | |
| `/admin/login/verify` | พนักงานที่เปิด MFA | ขั้นที่ 2 ของการเข้าสู่ระบบ ใช้ cookie `ft_mfa` (httpOnly, path `/admin`, อายุ 5 นาที) |
| `/admin/mfa-setup` | ผู้ที่ล็อกอินแล้ว | ตั้งค่า MFA (QR + รหัสลับสำหรับพิมพ์เอง) · เจ้าของที่ยังไม่ตั้งค่าเข้าได้แค่หน้านี้ |
| `/admin/*` | พนักงานที่ล็อกอิน | เมนูที่เห็นขึ้นกับบทบาท (ดูข้อ 6) |

## 3. Server Actions — ลูกค้า (`src/app/actions.ts`)

| Action | ฟิลด์ | กติกา | ผลลัพธ์ |
|---|---|---|---|
| `createBookingAction` | `checkin`, `checkout`, `room` (room type id), `plan?`, `rooms` 1–10, `guests` 1–40, `children` 0–20, `name`, `phone`, `email?`, `note?`, `accept=on`, `idempotency_key?` | rate limit 10 ครั้ง/ชม./IP · ผู้ใหญ่ ≥ 1 ต่อห้อง · กระจายผู้เข้าพักเท่า ๆ กันต่อห้อง · กดซ้ำด้วย key เดิมได้การจองเดิม | redirect `/booking/{code}?new=1` สถานะ `pending_payment` |
| `lookupBookingAction` | `code`, `phone` | rate limit 5 ครั้ง/15 นาที/IP (ล้างเมื่อสำเร็จ) · เบอร์ต้องตรงกับการจอง | redirect `/booking/{code}` |
| `cancelBookingAction` | `code`, `phone` | rate limit 5 ครั้ง/15 นาที/IP · ลูกค้ายกเลิกได้เฉพาะ `pending_payment` | redirect `/booking/{code}?cancelled=1` |

## 4. Server Actions — หลังบ้าน (`src/app/admin/actions.ts`)

คอลัมน์ “สิทธิ์” คือ permission ที่ตรวจ (ตาราง RBAC ข้อ 6)

### 4.1 บัญชีผู้ใช้
| Action | ฟิลด์ | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `loginAction` | `email`, `password` | — | ผิด 5 ครั้งล็อก 15 นาที · ข้อความผิดพลาดเหมือนกันทุกกรณี (ไม่บอกว่าอีเมลมีหรือไม่) · ถ้าเปิด MFA: ตั้ง cookie `ft_mfa` แล้ว redirect `/admin/login/verify` |
| `verifyMfaAction` | `code` (6 หลัก หรือรหัสกู้คืน `XXXX-XXXX`) | — | ผิดได้ 5 ครั้งต่อการเข้าสู่ระบบ และนับรวมกับการล็อกบัญชี · รหัสใช้ซ้ำไม่ได้ · ใช้รหัสกู้คืน → redirect `/admin/account?recovery_left=n` |
| `confirmMfaAction` | `code` | ล็อกอินแล้ว | เปิด MFA · คืน `codes` (รหัสกู้คืน 10 รหัส แสดงครั้งเดียว) · ออกจากระบบทุกเครื่องอื่น |
| `regenerateRecoveryAction` | `code` (จากแอป) | ล็อกอินแล้ว + MFA | รหัสกู้คืนชุดใหม่ ชุดเดิมใช้ไม่ได้ |
| `disableMfaAction` | `password` | ล็อกอินแล้ว + MFA | บทบาทอื่น: ปิด MFA · เจ้าของ: ล้างเครื่องเดิมแล้วไปตั้งค่าใหม่ทันที |
| `resetMfaAction` | `user_id` | `users.manage` | เจ้าของรีเซ็ต MFA ของพนักงานคนอื่น (โทรศัพท์หาย) · ผู้ใช้ถูกออกจากระบบ · รีเซ็ตของตนเองไม่ได้ |
| `logoutAction` | — | — | ลบ session ในฐานข้อมูลและ cookie |
| `forgotPasswordAction` | `email` | — | ตอบเหมือนกันเสมอ · ลิงก์อายุ 60 นาที ใช้ครั้งเดียว (ส่งอีเมลจริงใน Phase 6) |
| `resetPasswordAction` | `token`, `password`, `confirm` | — | รหัสผ่าน ≥ 10 ตัว |
| `changePasswordAction` | `current`, `next`, `confirm` | ล็อกอินแล้ว | ออกจากระบบทุกเครื่องหลังเปลี่ยน |

### 4.2 การจอง
| Action | ฟิลด์ | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `createStaffBookingAction` | `source` (phone/walk_in/facebook/line/web), `check_in`, `check_out`, ต่อห้อง: `room_type[]`, `adults[]`, `children[]`, `extra_beds[]`, `rate_plan_{i}`, ลูกค้า: `name`, `phone`, `email?`, `note?`, `confirm_now?`, `internal_note?`, `idempotency_key?` | `booking.create` | หลายประเภทห้องในการจองเดียวได้ · `confirm_now` = ยืนยันทันที (ขายเป็น sold) |
| `bookingStatusAction` | `code`, `to`, `version`, `reason?` | `booking.status` (+ `booking.cancel_confirmed` สำหรับยกเลิกที่ยืนยันแล้ว) | optimistic lock ด้วย `version` · ยกเลิกต้องมีเหตุผล · เปลี่ยนได้ตาม state machine ข้อ 5 |
| `assignRoomAction` | `booking_room_id`, `room_id?` (ว่าง = ยกเลิกการจัด) | `booking.assign_room` | ห้องจริงซ้อนช่วงวันไม่ได้ (exclusion constraint + ล็อกห้อง) · ผู้เข้าพักที่เช็คอินแล้ว = ย้ายห้อง: ห้องใหม่เริ่มวันนี้ ห้องเดิม → `dirty` |
| `changeDatesAction` | `code`, `version`, `check_in`, `check_out` | `booking.modify` | คืนเดิมราคาเดิม คืนใหม่ราคาปัจจุบัน (ไม่ใช้กฎพักขั้นต่ำ แต่คืนที่ปิดขายไม่ได้) · ย้าย held/sold ใน inventory · เช็คอินแล้วเปลี่ยนได้เฉพาะ `check_out` · `SOLD_OUT` / `ROOM_TAKEN` |
| `changeRoomTypeAction` | `booking_room_id`, `room_type_id`, `version`, `keep_price?` | `booking.modify` | ก่อนเช็คอินเท่านั้น · ตรวจความจุห้อง · ยกเลิกเลขห้องเดิม · `keep_price` = อัปเกรดฟรี |
| `bookingDetailsAction` | `code`, `version`, `name`, `phone`, `email?`, `special_request?`, `internal_note?` | `booking.modify` | บันทึกเฉพาะฟิลด์ที่เปลี่ยน (ค่าก่อน/หลังใน audit) |

`bookingStatusAction` รับ `back=dashboard` เพื่อกลับหน้าแรกพร้อมแถบผลลัพธ์ · `no_show` ทำได้ตั้งแต่วันเช็คอิน · `checked_out` ตั้งห้องที่จัดไว้เป็น `dirty`
Service: `src/server/booking-changes.ts` · ประวัติใน `booking_events.action`: `dates_changed`, `room_type_changed`, `details_updated`

### 4.3 ห้องพัก
| Action | ฟิลด์หลัก | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `saveRoomTypeAction` | `id?`, `code` (A–Z0–9_- 2–20), `name_th`, `name_en?`, คำอธิบาย, `bed_info`, `bed_count`, `view_type`, `building?`, `video_url?` (https), `size_sqm?`, จำนวนคน (`base_adults`, `max_adults`, `max_children`, `max_occupancy`, `max_extra_beds`), ราคา (`base_price`, `extra_adult`, `child_price`, `extra_bed`), `amenities`, `sort_order`, `is_active` | `catalog.edit` | ส่วนที่เป็น **ราคา** ใช้สิทธิ์ `rates.edit` — แอดมินแก้ข้อมูลห้องได้ทันที แต่การเปลี่ยนราคาส่งขออนุมัติ |
| `saveRoomAction` | `id?`, `room_type_id`, `room_number`, `building?`, `floor?`, `zone?`, `status` (active/maintenance/inactive), `note?` | `catalog.edit` | |
| `bulkRoomsAction` | `room_type_id`, `start` (เช่น `A101`), `count` 1–200, `building?`, `floor?`, `zone?` | `catalog.edit` | สร้างเลขต่อเนื่อง A101–A110 |
| `housekeepingAction` | `room_id`, `status` (clean/dirty/inspected/out_of_service) | `booking.status` | บันทึกประวัติห้อง |
| `uploadImageAction` | `room_type_id`, `images[]` ≤ 10 ไฟล์, `alt?` | `catalog.edit` | ≤ 5 MB/ไฟล์ · ตรวจชนิดจาก **เนื้อไฟล์** (magic bytes) รับ JPG/PNG/WebP เท่านั้น · production เก็บใน Vercel Blob (`rooms/<tenant>/<uuid>.<ext>`), dev เก็บในดิสก์ |
| `imageAction` | `image_id`, `op` (up/down/delete) | `catalog.edit` | ลบแล้วลบไฟล์ด้วย — เฉพาะไฟล์ของโรงแรมนี้ (ไม่แตะรูปตั้งต้นใน `/public`, โรงแรมอื่น หรือ host อื่น) |

### 4.4 ราคา
| Action | ฟิลด์หลัก | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `saveRatePlanAction` | `id?`, `code`, `name_th`, `meal_plan` (room_only/breakfast/half_board/full_board), `adjust_type` (none/percent/fixed), `adjust_value`, `min_nights`, `is_refundable`, `is_default`, `is_active`, `sort_order` | `rates.edit` | |
| `savePriceRuleAction` | `id?`, `room_type_id[]`, `name`, `kind` (weekday/season/holiday/event), `date_from?`, `date_to?`, `weekdays[]` (0=อา.–6=ส.), `price`, `priority`, `is_active` | `rates.edit` | สร้างหลายประเภทห้องพร้อมกันได้ · ลำดับราคา ADR-0004 |
| `deletePriceRuleAction` | `id`, `room_type_id`, `name` | `rates.edit` | |
| `dailyRatesAction` | `room_type_id[]`, `from`, `to`, `weekdays[]`, `price_mode` (keep/set/reset) + `price`, `closed` (keep/close/open), `min_mode` (keep/set/reset) + `min_nights` | `rates.edit` / `inventory.close` | แก้ราคารายวัน/ปิดขาย/พักขั้นต่ำเป็นช่วง |

### 4.5 อนุมัติ · พนักงาน · ที่พัก
| Action | ฟิลด์ | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `reviewRequestAction` | `id`, `decision` (approve/reject), `note?` | `approvals.review` | อนุมัติแล้วนำไปใช้ใน transaction เดียว ถ้าข้อมูลเปลี่ยนไปจนใช้ไม่ได้ สถานะเป็น `failed` |
| `withdrawRequestAction` | `id` | ผู้ขอเอง | |
| `inviteStaffAction` | `email`, `name`, `role` | `users.manage` | ได้ลิงก์ตั้งรหัสผ่าน (60 นาที ครั้งเดียว) ให้ส่งต่อเอง |
| `updateStaffAction` | `user_id`, `role?`, `active?` | `users.manage` | ต้องมีเจ้าของที่ใช้งานได้ ≥ 1 คนเสมอ |
| `resetLinkAction` | `user_id` | `users.manage` | |
| `savePropertyAction` | ชื่อ, ติดต่อ, `facebook_url`/`line_url` (https), `check_in_time`, `check_out_time`, `hold_hours` 1–168, `max_nights`, `booking_window_days`, `damage_deposit`, VAT/service charge 0–30% | `property.edit` | |

## 5. สถานะการจอง (state machine)

นิยามที่เดียว: `src/server/booking-status.ts`

| จาก → ไป | ใครทำได้ | Inventory |
|---|---|---|
| `pending_payment` → `payment_review` | ลูกค้า, พนักงาน | held |
| `pending_payment` → `confirmed` | พนักงาน, ระบบ | held → sold |
| `pending_payment` → `expired` | ระบบ (หมดเวลากันห้อง) | คืน held |
| `pending_payment` → `cancelled` | ลูกค้า, พนักงาน | คืน held |
| `payment_review` → `confirmed` / `pending_payment` / `cancelled` | พนักงาน (confirmed: ระบบด้วย) | |
| `expired` → `confirmed` | พนักงาน | ต้องมีห้องว่างอีกครั้ง |
| `confirmed` → `checked_in` / `no_show` / `cancelled` | พนักงาน (ยกเลิก: แอดมินและพนักงานต้อนรับต้องขออนุมัติ) | no_show/cancelled คืน sold |
| `checked_in` → `checked_out` | พนักงาน | |

## 6. สิทธิ์ (RBAC)

นิยามที่เดียว: `src/server/rbac.ts` · A = ทำได้ · ข = ต้องขออนุมัติ · – = ไม่ได้

| Permission | เจ้าของ | แอดมิน | ต้อนรับ | บัญชี |
|---|---|---|---|---|
| booking.view | A | A | A | A |
| booking.create / status / assign_room / modify | A | A | A | – |
| booking.cancel_confirmed | A | ข | ข | – |
| catalog.view | A | A | A | A |
| catalog.edit | A | A | – | – |
| rates.edit / inventory.close / property.edit | A | ข | – | – |
| users.view | A | A | – | – |
| users.manage / approvals.review | A | – | – | – |
| audit.view | A | A | – | A |

## 7. รหัสข้อผิดพลาด (`DomainError.code`)

| Code | ความหมาย |
|---|---|
| `VALIDATION` | ข้อมูลไม่ถูกต้อง |
| `NOT_FOUND` | ไม่พบ (รวมถึงข้อมูลของโรงแรมอื่น — RLS ซ่อนไว้) |
| `SOLD_OUT` | ห้องเต็มในบางคืน |
| `CLOSED` | ปิดขายในบางคืน |
| `MIN_STAY` | พักน้อยกว่าขั้นต่ำ |
| `OCCUPANCY` | ผู้เข้าพักเกินที่ห้องรับได้ |
| `INVALID_TRANSITION` | เปลี่ยนสถานะแบบนี้ไม่ได้ |
| `CONFLICT` | มีคนแก้ข้อมูลนี้ก่อนหน้า (version ไม่ตรง) |
| `FORBIDDEN` | ไม่มีสิทธิ์ |
| `RATE_LIMITED` | ทำรายการถี่เกินไป (รวมถึงการลองรหัส MFA เกิน 10 ครั้ง/15 นาที) |
| `ROOM_TAKEN` | ห้องจริงถูกจัดให้การจองอื่นในช่วงนั้นแล้ว |

## 8. Environment variables

| Key | จำเป็น | ใช้ทำอะไร |
|---|---|---|
| `DATABASE_URL` | ✅ | ต่อฐานข้อมูลด้วย role `fahtalay_app` |
| `APP_SECRET` | ✅ | ลงชื่อ cookie สิทธิ์ดูการจองของลูกค้า + เข้ารหัส secret ของ MFA (≥ 32 ตัว) ⚠ เปลี่ยนแล้วผู้ใช้ทุกคนต้องตั้ง MFA ใหม่ (เข้าด้วยรหัสกู้คืน) |
| `DATABASE_POOL_MAX` | – | ขนาด connection pool (Vercel: 3) |
| `DEFAULT_TENANT_SLUG` | – | โรงแรมสำหรับโดเมนที่ไม่ได้ลงทะเบียน (ติดตั้งโรงแรมเดียว) |
| `BLOB_READ_WRITE_TOKEN` | production | ที่เก็บรูปห้อง (Vercel ตั้งให้เองเมื่อเชื่อม Blob store) · ไม่มี = เก็บในดิสก์ (dev) |
| `MFA_REQUIRED_ROLES` | – | บทบาทที่ต้องใช้ MFA คั่นด้วย `,` (แนะนำ `owner`) · ไม่ตั้ง = ไม่บังคับใคร |
| `TRUST_PROXY_HOST` | – | `1` = เชื่อ `x-forwarded-host` (ใช้เมื่ออยู่หลัง proxy ที่ควบคุมเองเท่านั้น) |
| `DATABASE_ADMIN_URL` | เฉพาะ migrate/seed | **ห้ามใส่ใน Vercel** |

## 9. API ที่วางแผนไว้ (ยังไม่เปิด)
ร่างอยู่ใน `PHASE-0-REPORT.md` หัวข้อ 6: `/api/v1/*` (partner, API key ต่อ tenant), `/api/webhooks/*` (payment gateway, ตรวจ signature), `/api/cron/*` (ใช้ `CRON_SECRET`) — ปัจจุบันการปล่อยห้องที่หมดเวลาทำทุกครั้งที่มีการค้นหา/จอง จึงยังไม่ต้องมี cron
