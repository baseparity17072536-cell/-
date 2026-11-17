import { addDays, formatThaiDate, isIsoDate, todayInBangkok } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { btnGhost, Card, Field, inputCls, NoAccess, PageHeader, Table } from "@/components/admin/ui";
import { searchAvailability } from "@/server/booking";
import { listRatePlans, listRoomTypes } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { DomainError } from "@/server/errors";
import { can } from "@/server/rbac";
import StaffBookingForm from "./staff-booking-form";

export default async function NewBookingPage({ searchParams }: PageProps<"/admin/bookings/new">) {
  const { tenant, propertyId, session, actor, access } = await requireStaff("booking.create");
  if (access === "deny") return <NoAccess what="การสร้างการจอง" />;
  const sp = await searchParams;
  const today = todayInBangkok();
  const checkIn = typeof sp.check_in === "string" && isIsoDate(sp.check_in) ? sp.check_in : today;
  const checkOut = typeof sp.check_out === "string" && isIsoDate(sp.check_out) && sp.check_out > checkIn ? sp.check_out : addDays(checkIn, 1);
  const adults = Math.min(20, Math.max(1, Number(sp.adults) || 2));

  const [types, plans] = await Promise.all([listRoomTypes(tenant.id, propertyId), listRatePlans(tenant.id, propertyId)]);
  let avail: Awaited<ReturnType<typeof searchAvailability>> = [];
  let availError = "";
  try {
    avail = await searchAvailability(tenant.id, { propertyId, checkIn, checkOut, adults, children: 0, rooms: 1 }, actor);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    availError = e.message;
  }

  return (
    <>
      <PageHeader title="จองแทนลูกค้า" subtitle="สำหรับการจองทางโทรศัพท์ Walk-in Facebook หรือ LINE — ใช้ห้องว่างชุดเดียวกับหน้าเว็บ จึงไม่จองซ้ำกัน" />
      <Card title="1. ตรวจสอบห้องว่าง" className="mb-6">
        <form className="mb-4 flex flex-wrap items-end gap-3" action="/admin/bookings/new">
          <Field label="เช็คอิน"><input type="date" name="check_in" defaultValue={checkIn} min={today} className={inputCls} /></Field>
          <Field label="เช็คเอาท์"><input type="date" name="check_out" defaultValue={checkOut} className={inputCls} /></Field>
          <Field label="ผู้ใหญ่ต่อห้อง"><input type="number" name="adults" min={1} max={20} defaultValue={adults} className={`${inputCls} w-24`} /></Field>
          <button className={btnGhost}>ตรวจห้องว่าง</button>
        </form>
        <p className="mb-2 text-sm text-ink/60">{formatThaiDate(checkIn)} – {formatThaiDate(checkOut)}</p>
        {availError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{availError}</p>
        ) : (
          <Table head={["ประเภทห้อง", "ว่าง", ...(avail[0]?.plans.map((p) => `${p.name} (รวม)`) ?? [])]} minWidth={520}>
            {avail.map((a) => (
              <tr key={a.roomTypeId}>
                <td className="px-4 py-2 font-medium">{a.name}{a.closed && <span className="ml-2 text-xs text-red-600">ปิดขายบางคืน</span>}</td>
                <td className={`px-4 py-2 font-semibold tabular-nums ${a.available === 0 ? "text-red-600" : "text-emerald-700"}`}>{a.available}</td>
                {a.plans.map((p) => (
                  <td key={p.ratePlanId} className="px-4 py-2 tabular-nums">{p.error ? <span className="text-xs text-ink/50">{p.error}</span> : formatSatang(p.total)}</td>
                ))}
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="2. รายละเอียดการจอง">
        <StaffBookingForm
          key={`${checkIn}_${checkOut}`}
          types={types.map((t) => ({ id: t.id, name: t.name_th, maxAdults: t.max_adults, maxChildren: t.max_children, maxExtraBeds: t.max_extra_beds }))}
          plans={plans.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name_th }))}
          checkIn={checkIn}
          checkOut={checkOut}
          canConfirm={can(session.role, "booking.status")}
        />
      </Card>
    </>
  );
}
