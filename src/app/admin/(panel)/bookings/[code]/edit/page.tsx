import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { btnGhost, Card, Field, inputCls, NoAccess, PageHeader } from "@/components/admin/ui";
import { formatThaiDate } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { getBooking } from "@/server/booking";
import { listRoomTypes } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { can } from "@/server/rbac";
import { bookingDetailsAction, changeDatesAction, changeRoomTypeAction } from "../../../../actions";

const LIVE = ["pending_payment", "payment_review", "confirmed", "checked_in"];
const BEFORE_ARRIVAL = ["pending_payment", "payment_review", "confirmed"];

export default async function EditBookingPage({ params }: PageProps<"/admin/bookings/[code]/edit">) {
  const { tenant, session } = await requireStaff("booking.view");
  const { code } = await params;
  const b = await getBooking(tenant.id, code);
  if (!b) notFound();
  if (!can(session.role, "booking.modify")) return <NoAccess what="การแก้ไขการจอง" />;
  const types = BEFORE_ARRIVAL.includes(b.status) ? await listRoomTypes(tenant.id, b.property_id) : [];
  const inHouse = b.status === "checked_in";

  return (
    <>
      <Link href={`/admin/bookings/${b.code}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="size-4" /> กลับไปหน้าการจอง
      </Link>
      <PageHeader
        title={`แก้ไขการจอง ${b.code}`}
        subtitle={<>{b.guest_name} · {formatThaiDate(b.check_in)} – {formatThaiDate(b.check_out)} ({b.nights} คืน) · ยอดรวม {formatSatang(b.total_satang)}</>}
        actions={<StatusBadge status={b.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="ข้อมูลผู้เข้าพัก">
          <ActionForm action={bookingDetailsAction}>
            <input type="hidden" name="code" value={b.code} />
            <input type="hidden" name="version" value={b.version} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อ-นามสกุล"><input name="name" required defaultValue={b.guest_name} className={inputCls} /></Field>
              <Field label="เบอร์โทร"><input name="phone" type="tel" required defaultValue={b.guest_phone} className={inputCls} /></Field>
              <Field label="อีเมล" className="sm:col-span-2"><input name="email" type="email" defaultValue={b.guest_email ?? ""} className={inputCls} /></Field>
              <Field label="คำขอพิเศษจากลูกค้า" className="sm:col-span-2"><textarea name="special_request" rows={2} defaultValue={b.special_request ?? ""} className={inputCls} /></Field>
              <Field label="บันทึกภายใน (ลูกค้าไม่เห็น)" className="sm:col-span-2"><textarea name="internal_note" rows={2} defaultValue={b.internal_note ?? ""} className={inputCls} /></Field>
            </div>
          </ActionForm>
        </Card>

        <Card title="เปลี่ยนวันที่เข้าพัก">
          {!LIVE.includes(b.status) ? (
            <p className="text-sm text-ink/60">การจองสถานะนี้เปลี่ยนวันที่ไม่ได้</p>
          ) : (
            <ActionForm action={changeDatesAction} submitLabel="เปลี่ยนวันที่">
              <input type="hidden" name="code" value={b.code} />
              <input type="hidden" name="version" value={b.version} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="วันเช็คอิน" hint={inHouse ? "เช็คอินแล้ว เปลี่ยนไม่ได้" : undefined}>
                  {inHouse ? (
                    <>
                      <input type="hidden" name="check_in" value={b.check_in} />
                      <input value={formatThaiDate(b.check_in)} disabled className={inputCls} aria-label="วันเช็คอิน" />
                    </>
                  ) : (
                    <input type="date" name="check_in" required defaultValue={b.check_in} min={b.check_in < b.today ? b.check_in : b.today} className={inputCls} />
                  )}
                </Field>
                <Field label="วันเช็คเอาท์" hint={inHouse ? "ขยายวันพัก หรือออกก่อนกำหนด" : undefined}>
                  <input type="date" name="check_out" required defaultValue={b.check_out} min={inHouse ? b.today : undefined} className={inputCls} />
                </Field>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-ink/60">
                <li>คืนที่จองไว้แล้วใช้ราคาเดิม คืนที่เพิ่มใหม่คิดราคาปัจจุบัน แล้วระบบคำนวณยอดรวมใหม่</li>
                <li>ถ้าห้องที่จัดไว้ไม่ว่างในวันใหม่ ระบบจะยกเลิกการจัดห้องให้ แล้วให้คุณจัดห้องใหม่{inHouse && " (ผู้เข้าพักที่เช็คอินแล้วต้องย้ายห้องก่อน)"}</li>
              </ul>
            </ActionForm>
          )}
        </Card>

        <Card title="เปลี่ยนประเภทห้อง / อัปเกรด" className="xl:col-span-2">
          {!BEFORE_ARRIVAL.includes(b.status) ? (
            <p className="text-sm text-ink/60">
              {inHouse ? "ผู้เข้าพักเช็คอินแล้ว: ย้ายห้องได้โดยเลือกเลขห้องใหม่ในหน้าการจอง (ประเภทเดียวกัน)" : "การจองสถานะนี้เปลี่ยนประเภทห้องไม่ได้"}
            </p>
          ) : (
            <ul className="divide-y divide-cream-200">
              {b.rooms.map((r, i) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="mb-2 text-sm">
                    ห้องที่ {i + 1}: <b>{r.room_type_name}</b> · {r.adults} ผู้ใหญ่{r.children ? ` · ${r.children} เด็ก` : ""} · {formatSatang(r.amount_satang)}
                    {r.room_number && <span className="text-ink/60"> · ห้อง {r.room_number}</span>}
                  </p>
                  <ActionForm action={changeRoomTypeAction} className="flex flex-wrap items-end gap-3" submitLabel="เปลี่ยนประเภทห้อง" submitClass={btnGhost} inlineSubmit
                    confirm="ยืนยันเปลี่ยนประเภทห้อง? เลขห้องที่จัดไว้จะถูกยกเลิก">
                    <input type="hidden" name="booking_room_id" value={r.id} />
                    <input type="hidden" name="version" value={b.version} />
                    <Field label="เปลี่ยนเป็น" className="min-w-56">
                      <select name="room_type_id" required defaultValue="" className={inputCls}>
                        <option value="" disabled>— เลือกประเภทห้อง —</option>
                        {types.filter((t) => t.id !== r.room_type_id).map((t) => (
                          <option key={t.id} value={t.id}>{t.name_th} · {formatSatang(t.base_price_satang)}/คืน</option>
                        ))}
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 pb-2 text-sm">
                      <input type="checkbox" name="keep_price" className="size-4" /> คิดราคาเดิม (อัปเกรดฟรี)
                    </label>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
