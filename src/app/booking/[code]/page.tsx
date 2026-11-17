import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, Clock, Phone, XCircle } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import { CancelForm, PrintButton } from "@/components/booking-forms";
import { hasBookingAccess } from "@/lib/booking-access";
import { formatThaiDate, formatThaiDateTime } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { getBooking } from "@/server/booking";
import { STATUS_LABEL, type BookingStatus } from "@/server/booking-status";
import { getStaff } from "@/server/context";
import { getSite } from "@/server/site";

export const metadata: Metadata = { title: "รายละเอียดการจอง", robots: { index: false, follow: false } };

export default function BookingStatusPage({ params, searchParams }: PageProps<"/booking/[code]">) {
  return (
    <div className="space-y-8">
      <div className="print:hidden"><Steps current={3} /></div>
      <Suspense fallback={<Skeleton rows={2} />}>
        <BookingView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BookingView({ params, searchParams }: PageProps<"/booking/[code]">) {
  const { code } = await params;
  const { new: isNew, cancelled } = await searchParams;
  const { tenant, property } = await getSite();
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) notFound();
  const b = await getBooking(tenant.id, code);
  if (!b) notFound();

  // ข้อมูลส่วนบุคคลแสดงเฉพาะผู้ที่ยืนยันเบอร์โทรแล้ว หรือเจ้าหน้าที่ที่ล็อกอิน
  const canSeePersonal = (await hasBookingAccess(b.code)) || !!(await getStaff());
  const tel = (property.phone ?? "").replace(/[^\d+]/g, "");
  const tm = (t: string) => t.slice(0, 5);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {cancelled === "1" && b.status === "cancelled" && (
        <div role="status" className="rounded-2xl bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-200">ยกเลิกการจองเรียบร้อยแล้ว</div>
      )}
      {isNew === "1" && b.status === "pending_payment" && (
        <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-200">
          <p className="text-lg font-bold">ส่งคำขอจองสำเร็จ!</p>
          <p className="text-sm">กรุณาบันทึกรหัสการจอง <b>{b.code}</b> ไว้สำหรับตรวจสอบสถานะ และชำระเงินตามรายละเอียดด้านล่าง</p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-cream-200">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-teal-deep px-6 py-5 text-white">
          <div>
            <p className="text-xs text-white/70">รหัสการจอง</p>
            <p className="font-display text-2xl font-semibold tracking-widest text-gold-300">{b.code}</p>
          </div>
          <StatusBadge status={b.status} />
        </div>

        <dl className="grid gap-x-8 gap-y-4 p-6 text-sm sm:grid-cols-2">
          {canSeePersonal ? (
            <>
              <Item label="ผู้เข้าพัก" value={b.guest_name} />
              <Item label="เบอร์โทรศัพท์" value={b.guest_phone} />
            </>
          ) : (
            <div className="rounded-lg bg-cream px-4 py-3 sm:col-span-2 print:hidden">
              ข้อมูลผู้เข้าพักถูกซ่อนไว้เพื่อความเป็นส่วนตัว ·{" "}
              <Link href="/booking/lookup" className="font-semibold text-gold-600 underline">ยืนยันด้วยเบอร์โทรศัพท์</Link> เพื่อดูรายละเอียดทั้งหมด
            </div>
          )}
          <Item label="ห้องพัก" value={summarizeRooms(b.rooms)} />
          <Item label="จำนวนผู้เข้าพัก" value={`${b.adults} ผู้ใหญ่${b.children ? ` · ${b.children} เด็ก` : ""}`} />
          <Item label="เช็คอิน" value={`${formatThaiDate(b.check_in, { weekday: "long" })} หลัง ${tm(property.check_in_time)} น.`} />
          <Item label="เช็คเอาท์" value={`${formatThaiDate(b.check_out, { weekday: "long" })} ก่อน ${tm(property.check_out_time)} น.`} />
          <Item label="จำนวนคืน" value={`${b.nights} คืน`} />
          <Item label="วันที่ทำรายการ" value={formatThaiDateTime(b.created_at.toISOString())} />
          {canSeePersonal && b.special_request && <Item label="คำขอพิเศษ" value={b.special_request} wide />}
        </dl>

        <div className="space-y-1 border-t border-cream-200 px-6 py-4 text-sm">
          {!b.tax_inclusive && (
            <>
              <Line k="ค่าห้องพัก" v={formatSatang(b.subtotal_satang - b.discount_satang)} />
              {b.service_charge_satang > 0 && <Line k="ค่าบริการ" v={formatSatang(b.service_charge_satang)} />}
              <Line k="VAT" v={formatSatang(b.vat_satang)} />
            </>
          )}
          <div className="flex items-end justify-between pt-1">
            <span className="text-ink/60">ยอดรวม{b.tax_inclusive ? " (รวมภาษีแล้ว)" : ""}</span>
            <span className="text-2xl font-bold tabular-nums">{formatSatang(b.total_satang)}</span>
          </div>
        </div>
      </section>

      {b.status === "pending_payment" && b.hold_expires_at && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gold-300">
          <h2 className="text-lg font-bold">ขั้นตอนการชำระเงิน</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80">
            <li>
              ติดต่อรีสอร์ทเพื่อรับรายละเอียดการโอนเงินจำนวน <b>{formatSatang(b.total_satang)}</b>
              {property.phone && <> ทางโทรศัพท์ <a href={`tel:${tel}`} className="font-semibold text-gold-600 underline">{property.phone}</a></>}
              {property.facebook_url && <> หรือ <a href={property.facebook_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-600 underline">Facebook</a></>}
            </li>
            <li>ส่งสลิปพร้อมรหัสการจอง <b>{b.code}</b></li>
            <li>เจ้าหน้าที่จะตรวจสอบและยืนยันการจอง สถานะในหน้านี้จะเปลี่ยนเป็น “ยืนยันแล้ว”</li>
          </ol>
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-orange-50 px-4 py-2 text-sm text-orange-800">
            <Clock className="size-4 shrink-0" /> กรุณาชำระภายใน {formatThaiDateTime(b.hold_expires_at.toISOString())} น. มิฉะนั้นการจองจะหมดอายุ
          </p>
        </section>
      )}

      {b.status === "payment_review" && (
        <section className="rounded-2xl bg-amber-50 p-6 text-sm text-amber-900 ring-1 ring-amber-200">เจ้าหน้าที่ได้รับหลักฐานการชำระเงินแล้ว และกำลังตรวจสอบ</section>
      )}

      {(b.status === "confirmed" || b.status === "checked_in") && (
        <section className="rounded-2xl bg-emerald-50 p-6 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <p className="font-bold">การจองของคุณได้รับการยืนยันแล้ว</p>
          <p className="mt-1">
            แสดงรหัสการจองนี้ที่เคาน์เตอร์ในวันเช็คอิน
            {property.damage_deposit_satang > 0 && ` · มีเงินประกันความเสียหาย ${formatSatang(property.damage_deposit_satang)} ชำระที่รีสอร์ท (ได้คืนเมื่อเช็คเอาท์)`}
          </p>
        </section>
      )}

      {(b.status === "cancelled" || b.status === "expired" || b.status === "no_show") && (
        <section className="rounded-2xl bg-white p-6 text-sm ring-1 ring-cream-200">
          <p>
            {b.status === "expired" ? "การจองนี้หมดอายุเนื่องจากไม่ได้ชำระเงินภายในเวลาที่กำหนด" : `การจองนี้${STATUS_LABEL[b.status]}แล้ว`} ·{" "}
            <Link href="/booking" className="font-semibold text-gold-600 underline">จองใหม่</Link>
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div className="flex flex-wrap gap-3">
          <PrintButton />
          {property.phone && (
            <a href={`tel:${tel}`} className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-5 py-2 text-sm font-semibold transition hover:bg-white">
              <Phone className="size-4" /> ติดต่อรีสอร์ท {property.phone}
            </a>
          )}
        </div>
        {b.status === "pending_payment" && (
          <div className="w-full sm:w-80"><CancelForm code={b.code} /></div>
        )}
      </div>
    </div>
  );
}

function summarizeRooms(rooms: { room_type_name: string; rate_plan_name: string }[]) {
  const groups = new Map<string, number>();
  for (const r of rooms) groups.set(`${r.room_type_name} (${r.rate_plan_name})`, (groups.get(`${r.room_type_name} (${r.rate_plan_name})`) ?? 0) + 1);
  return [...groups].map(([k, n]) => `${k} × ${n} ห้อง`).join(", ");
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const base = "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold";
  if (status === "confirmed" || status === "checked_in" || status === "checked_out")
    return <span className={`${base} bg-emerald-500 text-white`}><CheckCircle2 className="size-4" /> {STATUS_LABEL[status]}</span>;
  if (status === "cancelled" || status === "expired" || status === "no_show")
    return <span className={`${base} bg-white/15 text-white`}><XCircle className="size-4" /> {STATUS_LABEL[status]}</span>;
  return <span className={`${base} bg-gold text-white`}><Clock className="size-4" /> {STATUS_LABEL[status]}</span>;
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-ink/60">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-ink/60">{k}</span><span className="tabular-nums">{v}</span></div>;
}
