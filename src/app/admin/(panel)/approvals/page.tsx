import { ActionForm } from "@/components/admin/action-form";
import { btnDanger, btnGhost, btnPrimary, Card, Empty, inputCls, NoAccess, PageHeader } from "@/components/admin/ui";
import { formatThaiDateTime } from "@/lib/dates";
import { listChangeRequests } from "@/server/approvals";
import { requireStaff } from "@/server/context";
import { reviewRequestAction, withdrawRequestAction } from "../../actions";

const STATUS = { pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ปฏิเสธ", withdrawn: "ยกเลิกคำขอ", failed: "อนุมัติไม่สำเร็จ" } as Record<string, string>;
const TONE = { pending: "bg-orange-100 text-orange-800", approved: "bg-emerald-100 text-emerald-800", rejected: "bg-red-100 text-red-700", withdrawn: "bg-gray-100 text-gray-600", failed: "bg-red-100 text-red-700" } as Record<string, string>;

export default async function ApprovalsPage() {
  const { tenant, session } = await requireStaff();
  if (session.role !== "owner" && session.role !== "admin") return <NoAccess />;
  const all = await listChangeRequests(tenant.id, "all");
  const owner = session.role === "owner";
  const mine = owner ? all : all.filter((r) => r.requested_by === session.userId);
  const pending = mine.filter((r) => r.status === "pending");
  const done = mine.filter((r) => r.status !== "pending").slice(0, 50);

  return (
    <>
      <PageHeader title={owner ? "รายการรออนุมัติ" : "คำขอของฉัน"} subtitle={owner ? "การแก้ราคา ปิดขาย ตั้งค่า และยกเลิกการจองที่ยืนยันแล้ว ซึ่งส่งมาจากแอดมิน/พนักงาน" : "คำขอที่ส่งให้เจ้าของอนุมัติ"} />
      <Card title={`รอดำเนินการ (${pending.length})`} className="mb-6">
        {pending.length === 0 ? <Empty title="ไม่มีคำขอที่รออนุมัติ" /> : (
          <ul className="space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="rounded-lg p-4 ring-1 ring-cream-200">
                <p className="font-medium">{r.summary}</p>
                <p className="mt-1 text-xs text-ink/60">ส่งโดย {r.requested_by_name} · {formatThaiDateTime(r.created_at.toISOString())}</p>
                {owner && r.requested_by !== session.userId ? (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <ActionForm action={reviewRequestAction} className="flex flex-wrap items-start gap-2" submitLabel="อนุมัติ" submitClass={btnPrimary} inlineSubmit>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                    </ActionForm>
                    <ActionForm action={reviewRequestAction} className="flex flex-wrap items-start gap-2" submitLabel="ปฏิเสธ" submitClass={btnDanger} inlineSubmit>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <input name="note" placeholder="เหตุผล (ไม่บังคับ)" className={`${inputCls} mt-0 w-56`} />
                    </ActionForm>
                  </div>
                ) : (
                  <ActionForm action={withdrawRequestAction} className="mt-3" submitLabel="ยกเลิกคำขอ" submitClass={btnGhost} inlineSubmit confirm="ยกเลิกคำขอนี้?">
                    <input type="hidden" name="id" value={r.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="ประวัติคำขอ">
        {done.length === 0 ? <Empty title="ยังไม่มีประวัติ" /> : (
          <ul className="divide-y divide-cream-200 text-sm">
            {done.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p>{r.summary}</p>
                  <p className="text-xs text-ink/60">
                    {r.requested_by_name} · {formatThaiDateTime(r.created_at.toISOString())}
                    {r.reviewed_by_name && ` · ตรวจโดย ${r.reviewed_by_name}`}{r.review_note && ` · “${r.review_note}”`}{r.apply_error && ` · ${r.apply_error}`}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[r.status]}`}>{STATUS[r.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
