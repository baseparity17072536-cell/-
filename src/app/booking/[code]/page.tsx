import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckCircle2, Clock, Phone, XCircle } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import { CancelForm, PrintButton } from "@/components/booking-forms";
import { findBooking, isExpired, type Booking } from "@/lib/bookings";
import { formatBaht, formatThaiDate, formatThaiDateTime } from "@/lib/dates";
import { RESORT } from "@/lib/rooms";

export const metadata: Metadata = { title: "รายละเอียดการจอง | ฟ้าทะเลรีสอร์ท" };

export default function BookingStatusPage({ params, searchParams }: PageProps<"/booking/[code]">) {
  return (
    <div className="space-y-8">
      <div className="print:hidden">
        <Steps current={3} />
      </div>
      <Suspense fallback={<Skeleton rows={2} />}>
        <BookingView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BookingView({ params, searchParams }: PageProps<"/booking/[code]">) {
  const { code } = await params;
  const { new: isNew } = await searchParams;
  await connection(); // สถานะการจอง/เวลาหมดอายุต้องเป็นปัจจุบันเสมอ
  const b = await findBooking(code);
  if (!b) notFound();

  const expired = isExpired(b);
  const deadline = new Date(Date.parse(b.createdAt) + RESORT.holdHours * 3_600_000).toISOString();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {isNew === "1" && b.status === "pending" && (
        <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-200">
          <p className="text-lg font-bold">ส่งคำขอจองสำเร็จ!</p>
          <p className="text-sm">
            กรุณาบันทึกรหัสการจอง <b>{b.code}</b> ไว้สำหรับตรวจสอบสถานะ และชำระเงินตามรายละเอียดด้านล่าง
          </p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-cream-200">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-teal-deep px-6 py-5 text-white">
          <div>
            <p className="text-xs text-white/70">รหัสการจอง</p>
            <p className="font-display text-2xl font-semibold tracking-widest text-gold-300">{b.code}</p>
          </div>
          <StatusBadge booking={b} expired={expired} />
        </div>

        <dl className="grid gap-x-8 gap-y-4 p-6 text-sm sm:grid-cols-2">
          <Item label="ผู้เข้าพัก" value={b.guest.name} />
          <Item label="เบอร์โทรศัพท์" value={b.guest.phone} />
          <Item label="ห้องพัก" value={`${b.roomName} × ${b.rooms} ห้อง`} />
          <Item label="จำนวนผู้เข้าพัก" value={`${b.guests} ผู้ใหญ่`} />
          <Item label="เช็คอิน" value={`${formatThaiDate(b.checkIn, { weekday: "long" })} หลัง ${RESORT.checkInTime} น.`} />
          <Item label="เช็คเอาท์" value={`${formatThaiDate(b.checkOut, { weekday: "long" })} ก่อน ${RESORT.checkOutTime} น.`} />
          <Item label="จำนวนคืน" value={`${b.nights} คืน`} />
          <Item label="วันที่ทำรายการ" value={formatThaiDateTime(b.createdAt)} />
          {b.guest.note && <Item label="คำขอพิเศษ" value={b.guest.note} wide />}
        </dl>

        <div className="flex items-end justify-between border-t border-cream-200 px-6 py-4">
          <span className="text-sm text-ink/60">
            ฿{formatBaht(b.pricePerNight)} × {b.nights} คืน × {b.rooms} ห้อง
          </span>
          <span className="text-2xl font-bold">฿{formatBaht(b.total)}</span>
        </div>
      </section>

      {b.status === "pending" && !expired && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gold-300">
          <h2 className="text-lg font-bold">ขั้นตอนการชำระเงิน</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80">
            <li>
              โอนเงินจำนวน <b>฿{formatBaht(b.total)}</b> เข้าบัญชี
              <div className="my-2 rounded-lg bg-cream p-3">
                {RESORT.bank.name}
                <br />
                ชื่อบัญชี {RESORT.bank.accountName}
                <br />
                เลขที่บัญชี <b>{RESORT.bank.accountNo}</b>
              </div>
            </li>
            <li>
              ส่งสลิปพร้อมรหัสการจอง <b>{b.code}</b> ทาง{" "}
              <a href={RESORT.facebook} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-600 underline">
                Facebook
              </a>{" "}
              หรือโทร <a href={`tel:${RESORT.phone.replaceAll("-", "")}`} className="font-semibold text-gold-600 underline">{RESORT.phone}</a>
            </li>
            <li>เจ้าหน้าที่จะตรวจสอบและยืนยันการจอง สถานะในหน้านี้จะเปลี่ยนเป็น “ยืนยันแล้ว”</li>
          </ol>
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-orange-50 px-4 py-2 text-sm text-orange-800">
            <Clock className="size-4 shrink-0" /> กรุณาชำระภายใน {formatThaiDateTime(deadline)} น. มิฉะนั้นการจองจะหมดอายุ
          </p>
        </section>
      )}

      {b.status === "confirmed" && (
        <section className="rounded-2xl bg-emerald-50 p-6 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <p className="font-bold">การจองของคุณได้รับการยืนยันแล้ว</p>
          <p className="mt-1">
            แสดงรหัสการจองนี้ที่เคาน์เตอร์ในวันเช็คอิน · มีเงินประกันความเสียหาย ฿{RESORT.deposit} ชำระที่รีสอร์ท (ได้คืนเมื่อเช็คเอาท์)
          </p>
        </section>
      )}

      {(b.status === "cancelled" || expired) && (
        <section className="rounded-2xl bg-white p-6 text-sm ring-1 ring-cream-200">
          <p>
            {expired ? "การจองนี้หมดอายุเนื่องจากไม่ได้ชำระเงินภายในเวลาที่กำหนด" : "การจองนี้ถูกยกเลิกแล้ว"} ·{" "}
            <Link href="/booking" className="font-semibold text-gold-600 underline">
              จองใหม่
            </Link>
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div className="flex flex-wrap gap-3">
          <PrintButton />
          <a
            href={`tel:${RESORT.phone.replaceAll("-", "")}`}
            className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-5 py-2 text-sm font-semibold transition hover:bg-white"
          >
            <Phone className="size-4" /> ติดต่อรีสอร์ท
          </a>
        </div>
        {b.status === "pending" && !expired && (
          <div className="w-full sm:w-80">
            <CancelForm code={b.code} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ booking, expired }: { booking: Booking; expired: boolean }) {
  const base = "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold";
  if (booking.status === "confirmed")
    return (
      <span className={`${base} bg-emerald-500 text-white`}>
        <CheckCircle2 className="size-4" /> ยืนยันแล้ว
      </span>
    );
  if (booking.status === "cancelled" || expired)
    return (
      <span className={`${base} bg-white/15 text-white`}>
        <XCircle className="size-4" /> {expired ? "หมดอายุ" : "ยกเลิกแล้ว"}
      </span>
    );
  return (
    <span className={`${base} bg-gold text-white`}>
      <Clock className="size-4" /> รอชำระเงิน
    </span>
  );
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-ink/60">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
