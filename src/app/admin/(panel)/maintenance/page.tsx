import Link from "next/link";
import { ActionButton, ActionForm } from "@/components/admin/action-form";
import { btnDanger, btnGhost, btnPrimary, Card, Empty, Field, inputCls, PageHeader } from "@/components/admin/ui";
import { formatThaiDateTime } from "@/lib/dates";
import { listRooms } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { listTickets, ticketNext, type TicketPriority, type TicketStatus } from "@/server/operations";
import { can } from "@/server/rbac";
import { createTicketAction, ticketStatusAction } from "../../actions";

const PRIORITY: Record<TicketPriority, { label: string; tone: string }> = {
  urgent: { label: "ด่วน", tone: "bg-red-100 text-red-800 ring-red-200" },
  normal: { label: "ปกติ", tone: "bg-cream text-ink/80 ring-cream-200" },
  low: { label: "ไม่รีบ", tone: "bg-gray-100 text-gray-600 ring-gray-200" },
};
const STATUS: Record<TicketStatus, string> = { open: "รอซ่อม", in_progress: "กำลังซ่อม", done: "ซ่อมเสร็จ", cancelled: "ยกเลิก" };
const ACTION: Record<TicketStatus, string> = { open: "กลับไปรอซ่อม", in_progress: "เริ่มซ่อม", done: "ซ่อมเสร็จ", cancelled: "ยกเลิก" };

export default async function MaintenancePage({ searchParams }: PageProps<"/admin/maintenance">) {
  const { tenant, propertyId, session } = await requireStaff("booking.view");
  const sp = await searchParams;
  const show = sp.show === "closed" ? "closed" : "open";
  const preselect = typeof sp.room === "string" ? sp.room : "";
  const [tickets, rooms] = await Promise.all([listTickets(tenant.id, propertyId, show), listRooms(tenant.id, propertyId)]);
  const canReport = can(session.role, "maintenance.report");
  const canManage = can(session.role, "maintenance.manage");
  const canBlock = can(session.role, "catalog.edit");

  return (
    <>
      <PageHeader title="แจ้งซ่อม" subtitle="บันทึกของเสีย ติดตามงานซ่อม และปิดห้องงดขายระหว่างซ่อม" />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <section className="min-w-0 space-y-3">
          <nav className="flex gap-2" aria-label="สถานะงานซ่อม">
            {(["open", "closed"] as const).map((k) => (
              <Link key={k} href={k === "open" ? "/admin/maintenance" : "?show=closed"} aria-current={show === k ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 ${show === k ? "bg-teal-deep font-semibold text-white ring-teal-deep" : "bg-white text-ink/70 ring-cream-200 hover:bg-cream"}`}>
                {k === "open" ? "งานค้าง" : "ปิดแล้ว"}
              </Link>
            ))}
          </nav>
          {tickets.length === 0 ? (
            <Empty title={show === "open" ? "ไม่มีงานซ่อมค้าง" : "ยังไม่มีงานที่ปิดแล้ว"} />
          ) : (
            <ul className="space-y-3">
              {tickets.map((t) => (
                <li key={t.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-cream-200" aria-label={`งานซ่อม ${t.title}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {t.room_number ? `ห้อง ${t.room_number}` : t.location} · {t.title}
                      </p>
                      {t.detail && <p className="mt-0.5 whitespace-pre-line text-sm text-ink/70">{t.detail}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${PRIORITY[t.priority].tone}`}>{PRIORITY[t.priority].label}</span>
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold ring-1 ring-cream-200">{STATUS[t.status]}</span>
                    </div>
                  </div>
                  {t.room_blocked && t.status !== "done" && t.status !== "cancelled" && (
                    <p className="mt-2 text-xs font-semibold text-red-700">ห้องนี้ถูกปิดงดขายระหว่างซ่อม · ปิดงานแล้วห้องจะกลับมาขาย (สถานะรอทำความสะอาด)</p>
                  )}
                  <p className="mt-2 text-xs text-ink/50">
                    แจ้งโดย {t.reported_by_name ?? "—"} · {formatThaiDateTime(t.created_at.toISOString())}
                    {t.resolved_at && ` · ${STATUS[t.status]}โดย ${t.resolved_by_name ?? "—"} ${formatThaiDateTime(t.resolved_at.toISOString())}`}
                  </p>
                  {t.resolution && <p className="mt-1 text-sm">ผลการซ่อม: {t.resolution}</p>}
                  {canManage && ticketNext(t.status).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ticketNext(t.status).map((to) => {
                        if (t.room_blocked && (to === "done" || to === "cancelled") && !canBlock) return null;
                        return (
                          <ActionButton key={to} action={ticketStatusAction} fields={{ id: t.id, to }} label={ACTION[to]}
                            className={`${to === "done" ? btnPrimary : to === "cancelled" ? btnDanger : btnGhost} !px-2.5 !py-1.5 text-xs`}
                            prompt={to === "done" ? "ซ่อมอะไรไปบ้าง (จำเป็น)" : to === "cancelled" ? "เหตุผลที่ยกเลิก (จำเป็น)" : undefined} />
                        );
                      })}
                      {t.room_blocked && !canBlock && <span className="self-center text-xs text-ink/50">เจ้าของ/แอดมินเป็นผู้ปิดงานนี้ (ห้องจะกลับมาขาย)</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canReport && (
          <Card title="แจ้งซ่อมใหม่" className="h-fit scroll-mt-6">
            <div id="new" />
            <ActionForm action={createTicketAction} submitLabel="บันทึกแจ้งซ่อม" resetOnSuccess>
              <Field label="ห้อง">
                <select name="room_id" defaultValue={preselect} className={inputCls}>
                  <option value="">— ไม่ใช่ห้องพัก (ระบุจุดด้านล่าง) —</option>
                  {rooms.filter((r) => r.status !== "inactive").map((r) => (
                    <option key={r.id} value={r.id}>{r.room_number} · {r.type_name}{r.status === "maintenance" ? " (ปิดซ่อม)" : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="จุดที่ต้องซ่อม (ถ้าไม่ใช่ห้องพัก)"><input name="location" maxLength={120} placeholder="เช่น สระว่ายน้ำ, ล็อบบี้" className={inputCls} /></Field>
              <Field label="เสียอะไร"><input name="title" required maxLength={200} placeholder="เช่น แอร์ไม่เย็น" className={inputCls} /></Field>
              <Field label="รายละเอียด"><textarea name="detail" rows={3} maxLength={2000} className={inputCls} /></Field>
              <Field label="ความเร่งด่วน">
                <select name="priority" defaultValue="normal" className={inputCls}>
                  <option value="urgent">ด่วน</option>
                  <option value="normal">ปกติ</option>
                  <option value="low">ไม่รีบ</option>
                </select>
              </Field>
              {canBlock && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="block_room" className="mt-0.5 size-4" />
                  <span>ปิดห้องงดขายระหว่างซ่อม<span className="block text-xs text-ink/50">ห้องที่มีผู้เข้าพักหรือจัดให้การจองไว้ต้องย้ายห้องก่อน</span></span>
                </label>
              )}
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
