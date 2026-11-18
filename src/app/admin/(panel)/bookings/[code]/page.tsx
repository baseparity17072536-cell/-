import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { ActionButton, ActionForm } from "@/components/admin/action-form";
import { SOURCE_LABEL, StatusBadge } from "@/components/admin/status-badge";
import { btnDanger, btnGhost, btnPrimary, Card, PageHeader } from "@/components/admin/ui";
import { formatThaiDate, formatThaiDateTime } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { assignableRooms, getBooking } from "@/server/booking";
import { nextStatuses, STATUS_LABEL, type BookingStatus } from "@/server/booking-status";
import { requireStaff } from "@/server/context";
import { can, decide } from "@/server/rbac";
import { assignRoomAction, bookingStatusAction } from "../../../actions";

const ACTION_LABEL: Partial<Record<BookingStatus, string>> = {
  payment_review: "รับสลิปแล้ว (รอตรวจ)",
  confirmed: "ยืนยันการจอง / ชำระแล้ว",
  pending_payment: "สลิปไม่ผ่าน (กลับไปรอชำระ)",
  checked_in: "เช็คอิน",
  checked_out: "เช็คเอาท์",
  no_show: "ไม่มาเข้าพัก",
  cancelled: "ยกเลิกการจอง",
};

export default async function BookingDetailPage({ params, searchParams }: PageProps<"/admin/bookings/[code]">) {
  const { tenant, session } = await requireStaff("booking.view");
  const { code } = await params;
  const sp = await searchParams;
  const b = await getBooking(tenant.id, code);
  if (!b) notFound();
  const canStatus = can(session.role, "booking.status");
  const cancelConfirmed = decide(session.role, "booking.cancel_confirmed");
  // no-show can only be recorded from the arrival day on
  const actions = canStatus ? nextStatuses(b.status, "staff").filter((to) => to !== "no_show" || b.today >= b.check_in) : [];
  const canModify = can(session.role, "booking.modify") && ["pending_payment", "payment_review", "confirmed", "checked_in"].includes(b.status);
  const canAssign = can(session.role, "booking.assign_room") && ["pending_payment", "payment_review", "confirmed", "checked_in"].includes(b.status);
  const options = canAssign ? await Promise.all(b.rooms.map((r) => assignableRooms(tenant.id, r.id))) : [];

  return (
    <>
      <Link href="/admin/bookings" className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"><ArrowLeft className="size-4" /> รายการการจอง</Link>
      <PageHeader
        title={`การจอง ${b.code}`}
        subtitle={<>สร้างเมื่อ {formatThaiDateTime(b.created_at.toISOString())} · ช่องทาง {SOURCE_LABEL[b.source] ?? b.source}</>}
        actions={
          <>
            {canModify && (
              <Link href={`/admin/bookings/${b.code}/edit`} className={btnGhost}><Pencil className="size-4" /> แก้ไขการจอง</Link>
            )}
            <StatusBadge status={b.status} />
          </>
        }
      />
      {sp.created && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">สร้างการจองเรียบร้อย</p>}
      {typeof sp.done === "string" && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {sp.done === "approval" ? "ส่งคำขอให้เจ้าของอนุมัติแล้ว สถานะจะเปลี่ยนเมื่อได้รับอนุมัติ" : `อัปเดตสถานะเป็น “${STATUS_LABEL[sp.done as BookingStatus] ?? sp.done}” เรียบร้อย`}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="ผู้เข้าพักและวันที่">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item k="ชื่อ" v={b.guest_name} />
              <Item k="เบอร์โทร" v={<a href={`tel:${b.guest_phone}`} className="underline">{b.guest_phone}</a>} />
              <Item k="อีเมล" v={b.guest_email ?? "—"} />
              <Item k="จำนวนผู้เข้าพัก" v={`${b.adults} ผู้ใหญ่${b.children ? ` · ${b.children} เด็ก` : ""}`} />
              <Item k="เช็คอิน" v={formatThaiDate(b.check_in, { weekday: "long" })} />
              <Item k="เช็คเอาท์" v={`${formatThaiDate(b.check_out, { weekday: "long" })} (${b.nights} คืน)`} />
              {b.special_request && <Item k="คำขอพิเศษจากลูกค้า" v={b.special_request} wide />}
              {b.internal_note && <Item k="บันทึกภายใน" v={b.internal_note} wide />}
              {b.status === "pending_payment" && b.hold_expires_at && <Item k="ต้องชำระภายใน" v={formatThaiDateTime(b.hold_expires_at.toISOString())} />}
              {b.cancel_reason && <Item k="เหตุผลการยกเลิก" v={`${b.cancel_reason} (โดย${b.cancelled_by === "guest" ? "ลูกค้า" : b.cancelled_by === "system" ? "ระบบ" : "เจ้าหน้าที่"})`} wide />}
            </dl>
          </Card>

          <Card title="ห้องพัก">
            <ul className="divide-y divide-cream-200">
              {b.rooms.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{r.room_type_name} <span className="font-normal text-ink/60">· {r.rate_plan_name}</span></p>
                    <p className="text-xs text-ink/60">
                      {r.adults} ผู้ใหญ่{r.children ? ` · ${r.children} เด็ก` : ""}{r.extra_beds ? ` · เตียงเสริม ${r.extra_beds}` : ""} · {formatSatang(r.amount_satang)}
                    </p>
                    <p className="mt-1 text-xs">เลขห้อง: <b>{r.room_number ?? "ยังไม่จัดห้อง"}</b></p>
                  </div>
                  {canAssign && (
                    <ActionForm action={assignRoomAction} className="flex flex-wrap items-start gap-2" submitLabel="บันทึก" submitClass={btnGhost} inlineSubmit>
                      <input type="hidden" name="booking_room_id" value={r.id} />
                      <select name="room_id" defaultValue={r.room_id ?? ""} className="rounded-lg border border-cream-200 bg-white px-2 py-2 text-sm" aria-label="เลือกห้อง">
                        <option value="">— ไม่จัดห้อง —</option>
                        {options[i].map((o) => (
                          <option key={o.id} value={o.id} disabled={!o.free}>
                            {o.room_number}{!o.free ? " (ไม่ว่าง)" : o.housekeeping_status === "dirty" ? " (รอทำความสะอาด)" : ""}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1 border-t border-cream-200 pt-3 text-sm">
              <Row k="ค่าห้องพัก" v={formatSatang(b.subtotal_satang)} />
              {b.discount_satang > 0 && <Row k="ส่วนลด" v={`−${formatSatang(b.discount_satang)}`} />}
              {b.service_charge_satang > 0 && <Row k={`ค่าบริการ${b.tax_inclusive ? " (รวมในราคาแล้ว)" : ""}`} v={formatSatang(b.service_charge_satang)} />}
              <Row k={`VAT${b.tax_inclusive ? " (รวมในราคาแล้ว)" : ""}`} v={formatSatang(b.vat_satang)} />
              <Row k="ยอดรวม" v={<span className="text-lg font-bold">{formatSatang(b.total_satang)}</span>} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="ดำเนินการ">
            {actions.length === 0 ? (
              <p className="text-sm text-ink/60">ไม่มีการดำเนินการสำหรับสถานะนี้</p>
            ) : (
              <div className="flex flex-col gap-2">
                {actions.map((to) => {
                  const needsApproval = to === "cancelled" && ["confirmed", "checked_in"].includes(b.status) && cancelConfirmed === "approval";
                  if (to === "cancelled" && ["confirmed", "checked_in"].includes(b.status) && cancelConfirmed === "deny") return null;
                  return (
                    <ActionButton
                      key={to}
                      action={bookingStatusAction}
                      fields={{ code: b.code, to, version: b.version }}
                      label={`${ACTION_LABEL[to] ?? STATUS_LABEL[to]}${needsApproval ? " (ขออนุมัติ)" : ""}`}
                      className={`${to === "cancelled" || to === "no_show" ? btnDanger : btnPrimary} w-full`}
                      prompt={to === "cancelled" ? "เหตุผลการยกเลิก (จำเป็น)" : undefined}
                      confirm={to === "no_show" ? "ยืนยันว่าลูกค้าไม่มาเข้าพัก? ห้องจะถูกปล่อยกลับมาขาย" : to === "checked_out" ? "ยืนยันเช็คเอาท์?" : undefined}
                    />
                  );
                })}
              </div>
            )}
            {b.status === "confirmed" && b.rooms.some((r) => !r.room_number) && (
              <p className="mt-3 text-xs text-ink/60">ต้องจัดเลขห้องให้ครบก่อนเช็คอิน</p>
            )}
          </Card>

          <Card title="ประวัติ">
            <ol className="space-y-3 text-sm">
              {b.events.map((e, i) => (
                <li key={i} className="border-l-2 border-gold-300 pl-3">
                  <p className="font-medium">
                    {eventTitle(e)}
                  </p>
                  <p className="text-xs text-ink/60">
                    {formatThaiDateTime(e.created_at.toISOString())} · {e.actor_name ?? (e.actor_type === "guest" ? "ลูกค้า" : e.actor_type === "system" ? "ระบบ" : e.actor_type)}
                    {typeof e.data?.reason === "string" && ` · ${e.data.reason}`}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

type BookingEvent = NonNullable<Awaited<ReturnType<typeof getBooking>>>["events"][number];

function eventTitle(e: BookingEvent) {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const money = (k: string) => (typeof d[k] === "number" ? formatSatang(d[k] as number) : "");
  const total = d.total_before !== d.total_after ? ` · ยอด ${money("total_before")} → ${money("total_after")}` : "";
  switch (e.action) {
    case "created": return "สร้างการจอง";
    case "imported": return "นำเข้าจากระบบเดิม";
    case "dates_changed": {
      const f = d.from as { check_in: string; check_out: string };
      const t = d.to as { check_in: string; check_out: string };
      return `เปลี่ยนวันที่ ${formatThaiDate(f.check_in)}–${formatThaiDate(f.check_out)} → ${formatThaiDate(t.check_in)}–${formatThaiDate(t.check_out)}${total}`;
    }
    case "room_type_changed": return `เปลี่ยนประเภทห้อง ${d.from} → ${d.to}${d.keep_price ? " (คิดราคาเดิม)" : ""}${total}`;
    case "details_updated": return "แก้ไขข้อมูลผู้เข้าพัก";
    default: return `${e.from_status ? STATUS_LABEL[e.from_status as BookingStatus] : ""} → ${STATUS_LABEL[e.to_status as BookingStatus]}`;
  }
}

function Item({ k, v, wide }: { k: string; v: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-ink/60">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-ink/60">{k}</span><span className="tabular-nums">{v}</span></div>;
}
