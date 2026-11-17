import { Empty, NoAccess, PageHeader, Table } from "@/components/admin/ui";
import { formatThaiDateTime } from "@/lib/dates";
import { listAudit } from "@/server/auth";
import { requireStaff } from "@/server/context";
import { can } from "@/server/rbac";

export default async function AuditPage() {
  const { tenant, session } = await requireStaff("audit.view");
  if (!can(session.role, "audit.view")) return <NoAccess />;
  const rows = await listAudit(tenant.id, session, 300);
  return (
    <>
      <PageHeader title="ประวัติการแก้ไข" subtitle="บันทึกแบบเพิ่มได้อย่างเดียว ไม่มีใครแก้ไขหรือลบได้ (300 รายการล่าสุด)" />
      {rows.length === 0 ? <Empty title="ยังไม่มีประวัติ" /> : (
        <Table head={["เวลา", "ผู้ใช้", "การกระทำ", "รายการ", "รายละเอียด"]} minWidth={900}>
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-2 text-xs">{formatThaiDateTime(r.created_at.toISOString())}</td>
              <td className="px-4 py-2 text-xs">{r.user_name ?? "ระบบ"}{r.ip && <div className="text-ink/40">{r.ip}</div>}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
              <td className="px-4 py-2 text-xs">{r.entity}{r.entity_id && <div className="max-w-40 truncate text-ink/50" title={r.entity_id}>{r.entity_id}</div>}</td>
              <td className="px-4 py-2"><pre className="max-h-32 max-w-[28rem] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-ink/70">{r.data ? JSON.stringify(r.data, null, 1) : ""}</pre></td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
