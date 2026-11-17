import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import ScrollToToday from "@/components/admin/scroll-to-today";
import { ApprovalNotice, btnGhost, btnPrimary, Card, Field, inputCls, PageHeader } from "@/components/admin/ui";
import { addDays, formatThaiDate, isIsoDate, nightsBetween, todayInBangkok } from "@/lib/dates";
import { formatSatang, satangToBahtInput } from "@/lib/money";
import { getCalendar } from "@/server/booking";
import { requireStaff } from "@/server/context";
import { decide } from "@/server/rbac";
import { dailyRatesAction } from "../../actions";

const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function monthStart(m: string | undefined, today: string) {
  return m && /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : `${today.slice(0, 7)}-01`;
}
function shiftMonth(first: string, n: number) {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  const { tenant, propertyId, session } = await requireStaff("catalog.view");
  const sp = await searchParams;
  const today = todayInBangkok();
  const first = monthStart(typeof sp.month === "string" ? sp.month : undefined, today);
  const next = `${shiftMonth(first, 1)}-01`;
  const days = nightsBetween(first, next);
  const cal = await getCalendar(tenant.id, propertyId, first, days);
  const selDate = typeof sp.date === "string" && isIsoDate(sp.date) ? sp.date : null;
  const selType = typeof sp.type === "string" ? sp.type : null;
  const rateAccess = decide(session.role, "rates.edit");
  const closeAccess = decide(session.role, "inventory.close");
  const canEdit = rateAccess !== "deny" || closeAccess !== "deny";
  const month = first.slice(0, 7);
  const sel = selDate && selType ? cal.find((t) => t.id === selType)?.days.find((d) => d.date === selDate) : null;

  return (
    <>
      <PageHeader
        title="ปฏิทินห้องว่าง & ราคา"
        subtitle="ตัวเลขใหญ่ = ห้องที่ขายได้ · คลิกช่องวันที่เพื่อแก้ราคา ปิด/เปิดขาย หรือพักขั้นต่ำ"
        actions={
          <div className="flex items-center gap-2">
            <Link className={btnGhost} href={`/admin/calendar?month=${shiftMonth(first, -1)}`} aria-label="เดือนก่อน"><ChevronLeft className="size-4" /></Link>
            <span className="min-w-36 text-center font-semibold">{formatThaiDate(first, { day: undefined, month: "long", year: "numeric" })}</span>
            <Link className={btnGhost} href={`/admin/calendar?month=${shiftMonth(first, 1)}`} aria-label="เดือนถัดไป"><ChevronRight className="size-4" /></Link>
          </div>
        }
      />

      <ScrollToToday containerId="rate-calendar" />
      <div id="rate-calendar" className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-cream-200">
        <table className="w-full border-collapse text-center text-xs tabular-nums" style={{ minWidth: 120 + days * 56 }}>
          <thead className="sticky top-0 bg-ivory text-ink/60">
            <tr>
              <th className="sticky left-0 z-10 w-28 bg-ivory px-2 py-2 text-left font-semibold sm:w-48 sm:px-3">ประเภทห้อง</th>
              {cal[0]?.days.map((d) => {
                const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
                return (
                  <th key={d.date} data-today={d.date === today ? "" : undefined} className={`min-w-14 px-1 py-2 font-medium ${wd === 0 || wd === 6 ? "text-gold-600" : ""} ${d.date === today ? "bg-gold-300/30" : ""}`}>
                    <div>{WD[wd]}</div>
                    <div className="text-sm text-ink">{Number(d.date.slice(8))}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {cal.map((t) => (
              <tr key={t.id} className="border-t border-cream-200">
                <th className="sticky left-0 z-10 w-28 bg-white px-2 py-2 text-left align-top text-[11px] font-semibold leading-tight shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] sm:w-48 sm:px-3 sm:text-xs">
                  {t.name_th}
                  <div className="mt-0.5 text-[10px] font-normal text-ink/50 sm:text-[11px]">{t.code} · {t.active_rooms} ห้อง{t.out_of_order ? ` · ซ่อม ${t.out_of_order}` : ""}</div>
                </th>
                {t.days.map((d) => {
                  const active = selDate === d.date && selType === t.id;
                  const tone = d.closed ? "bg-gray-100 text-gray-500" : d.free === 0 ? "bg-red-50" : d.free <= 1 ? "bg-orange-50" : "";
                  return (
                    <td key={d.date} className={`border-l border-cream-200 p-0 ${tone} ${active ? "ring-2 ring-inset ring-gold-500" : ""}`}>
                      <Link
                        href={`/admin/calendar?month=${month}&type=${t.id}&date=${d.date}#edit`}
                        className="block px-1 py-1.5 hover:bg-gold-300/20"
                        title={`ทั้งหมด ${d.physical} · จองแล้ว ${d.sold} · กันไว้ ${d.held} · ซ่อม ${d.outOfOrder} · ขายได้ ${d.free}\nราคา ${formatSatang(d.price)} (${d.priceSource})${d.minNights ? ` · พักขั้นต่ำ ${d.minNights} คืน` : ""}`}
                      >
                        <div className={`text-base font-bold ${d.closed ? "" : d.free === 0 ? "text-red-600" : "text-ink"}`}>{d.closed ? "ปิด" : d.free}</div>
                        <div className="text-[10px] text-ink/50">{d.sold + d.held}/{d.total}</div>
                        <div className={`text-[11px] ${d.priceSource === "ราคาพื้นฐาน" ? "text-ink/60" : "font-semibold text-gold-600"}`}>{(d.price / 100).toLocaleString("th-TH")}</div>
                        {d.minNights ? <div className="text-[10px] text-sky-700">≥{d.minNights}คืน</div> : null}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink/60">
        ตัวเลขเล็ก = จองแล้ว+กันไว้ / ห้องขายได้ · ราคาสีทอง = มาจากกฎราคาหรือราคากำหนดรายวัน · ห้องซ่อมไม่ถูกนับเป็นห้องขายได้ จึงไม่ถูกหักซ้ำ
      </p>

      <div id="edit" className="mt-6 grid scroll-mt-6 gap-6 xl:grid-cols-[1fr_320px]">
        <Card title="แก้ไขราคา / ปิดขาย / พักขั้นต่ำ">
          {!canEdit ? (
            <p className="text-sm text-ink/60">บทบาทของคุณดูปฏิทินได้อย่างเดียว</p>
          ) : (
            <>
              {(rateAccess === "approval" || closeAccess === "approval") && <ApprovalNotice />}
              <ActionForm action={dailyRatesAction} submitLabel={rateAccess === "approval" ? "ส่งคำขออนุมัติ" : "บันทึก"} submitClass={btnPrimary} key={`${selType}-${selDate}`}>
                <fieldset>
                  <legend className="text-sm font-medium">ประเภทห้อง</legend>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {cal.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="room_type_id" value={t.id} defaultChecked={selType ? selType === t.id : true} className="size-4 accent-[#123c46]" /> {t.name_th}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="ตั้งแต่วันที่"><input type="date" name="from" required defaultValue={selDate ?? today} className={inputCls} /></Field>
                  <Field label="ถึงวันที่ (รวมวันนี้)"><input type="date" name="to" required defaultValue={selDate ?? addDays(today, 6)} className={inputCls} /></Field>
                </div>
                <fieldset>
                  <legend className="text-sm font-medium">เฉพาะวัน (ไม่เลือก = ทุกวัน)</legend>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {WD.map((w, i) => (
                      <label key={i} className="flex items-center gap-1 text-sm"><input type="checkbox" name="weekdays" value={i} className="size-4 accent-[#123c46]" /> {w}</label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-3">
                  <fieldset disabled={rateAccess === "deny"} className="space-y-1 text-sm">
                    <legend className="font-medium">ราคาต่อคืน</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="price_mode" value="keep" defaultChecked /> ไม่เปลี่ยน</label>
                    <label className="flex items-center gap-2"><input type="radio" name="price_mode" value="set" /> กำหนดราคา (บาท)</label>
                    <input name="price" inputMode="decimal" placeholder="เช่น 4500" defaultValue={sel?.priceOverridden ? satangToBahtInput(sel.price) : ""} className={inputCls} aria-label="ราคา (บาท)" />
                    <label className="flex items-center gap-2"><input type="radio" name="price_mode" value="reset" /> กลับไปใช้ราคาตามกฎ/พื้นฐาน</label>
                  </fieldset>
                  <fieldset disabled={closeAccess === "deny"} className="space-y-1 text-sm">
                    <legend className="font-medium">การขาย</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="closed" value="keep" defaultChecked /> ไม่เปลี่ยน</label>
                    <label className="flex items-center gap-2"><input type="radio" name="closed" value="close" /> ปิดขาย (Stop sell)</label>
                    <label className="flex items-center gap-2"><input type="radio" name="closed" value="open" /> เปิดขาย</label>
                  </fieldset>
                  <fieldset disabled={rateAccess === "deny"} className="space-y-1 text-sm">
                    <legend className="font-medium">พักขั้นต่ำ (วันที่เข้าพัก)</legend>
                    <label className="flex items-center gap-2"><input type="radio" name="min_mode" value="keep" defaultChecked /> ไม่เปลี่ยน</label>
                    <label className="flex items-center gap-2"><input type="radio" name="min_mode" value="set" /> กำหนด (คืน)</label>
                    <input name="min_nights" type="number" min={1} max={60} defaultValue={sel?.minNights ?? 2} className={inputCls} aria-label="จำนวนคืนขั้นต่ำ" />
                    <label className="flex items-center gap-2"><input type="radio" name="min_mode" value="reset" /> ยกเลิกพักขั้นต่ำ</label>
                  </fieldset>
                </div>
              </ActionForm>
            </>
          )}
        </Card>

        <Card title={sel ? `${cal.find((t) => t.id === selType)?.name_th} · ${formatThaiDate(selDate!)}` : "รายละเอียดวันที่เลือก"}>
          {sel ? (
            <dl className="space-y-1 text-sm">
              {[
                ["ห้องทั้งหมด", sel.physical], ["ปิดซ่อม", sel.outOfOrder], ["ห้องที่ขายได้", sel.total], ["ยืนยันแล้ว", sel.sold],
                ["กันไว้ (รอชำระ)", sel.held], ["เหลือขายได้", sel.free],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt className="text-ink/60">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
              <div className="flex justify-between border-t border-cream-200 pt-2"><dt className="text-ink/60">ราคา</dt><dd className="font-semibold">{formatSatang(sel.price)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink/60">ที่มาของราคา</dt><dd>{sel.priceSource}</dd></div>
              <div className="flex justify-between"><dt className="text-ink/60">สถานะ</dt><dd>{sel.closed ? "ปิดขาย" : "เปิดขาย"}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-ink/60">คลิกช่องวันที่ในปฏิทินเพื่อดูจำนวนห้องและที่มาของราคา</p>
          )}
        </Card>
      </div>
    </>
  );
}
