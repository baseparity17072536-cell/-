import { ActionForm } from "@/components/admin/action-form";
import { btnGhost, btnPrimary, Card, Field, inputCls, NoAccess, PageHeader, Table } from "@/components/admin/ui";
import { formatThaiDateTime } from "@/lib/dates";
import { listStaff } from "@/server/auth";
import { requireStaff } from "@/server/context";
import { can, PERMISSION_MATRIX, ROLE_LABEL, ROLES } from "@/server/rbac";
import { inviteStaffAction, resetLinkAction, updateStaffAction } from "../../actions";

const PERM_LABEL: Record<string, string> = {
  "booking.view": "ดูการจอง", "booking.create": "สร้างการจอง / จองแทนลูกค้า", "booking.status": "ยืนยัน เช็คอิน เช็คเอาท์",
  "booking.cancel_confirmed": "ยกเลิกการจองที่ยืนยันแล้ว", "booking.assign_room": "จัดเลขห้อง", "catalog.view": "ดูข้อมูลห้อง",
  "catalog.edit": "แก้ข้อมูลห้อง รูป ห้องจริง", "rates.edit": "แก้ราคา กฎราคา แพ็กเกจ", "inventory.close": "ปิด/เปิดขาย",
  "property.edit": "ตั้งค่าที่พักและภาษี", "users.view": "ดูรายชื่อพนักงาน", "users.manage": "จัดการพนักงาน",
  "approvals.review": "อนุมัติคำขอ", "audit.view": "ดูประวัติการแก้ไข",
};
const DECISION = { allow: "✓", approval: "ขออนุมัติ", deny: "—" };

export default async function StaffPage() {
  const { tenant, session } = await requireStaff("users.view");
  if (!can(session.role, "users.view")) return <NoAccess />;
  const staff = await listStaff(tenant.id, session);
  const manage = can(session.role, "users.manage");

  return (
    <>
      <PageHeader title="พนักงาน" subtitle="บัญชีแยกรายคน · ทุกการกระทำถูกบันทึกในประวัติการแก้ไข" />
      <Table head={["ชื่อ", "อีเมล", "บทบาท", "เข้าใช้ล่าสุด", manage ? "จัดการ" : ""]} minWidth={820}>
        {staff.map((u) => (
          <tr key={u.id} className={u.is_active ? "" : "text-ink/40"}>
            <td className="px-4 py-3 font-medium">{u.name}{u.id === session.userId && " (คุณ)"}{u.locked_until && u.locked_until > new Date() && <span className="ml-1 text-xs text-red-600">ถูกล็อกชั่วคราว</span>}</td>
            <td className="px-4 py-3">{u.email}</td>
            <td className="px-4 py-3">
              {manage && u.id !== session.userId ? (
                <ActionForm action={updateStaffAction} className="flex items-center gap-2" submitLabel="เปลี่ยน" submitClass={btnGhost} inlineSubmit>
                  <input type="hidden" name="user_id" value={u.id} />
                  <select name="role" defaultValue={u.role} className="rounded border border-cream-200 bg-white px-2 py-1 text-sm" aria-label={`บทบาทของ ${u.name}`}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </ActionForm>
              ) : ROLE_LABEL[u.role]}
            </td>
            <td className="px-4 py-3 text-xs">{u.last_login_at ? formatThaiDateTime(u.last_login_at.toISOString()) : "ยังไม่เคย"}</td>
            <td className="px-4 py-3">
              {manage && u.id !== session.userId && (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={updateStaffAction} submitLabel={u.is_active ? "ปิดบัญชี" : "เปิดบัญชี"} submitClass={btnGhost} inlineSubmit className="" confirm={u.is_active ? `ปิดบัญชีของ ${u.name}? ผู้ใช้จะถูกออกจากระบบทันที` : undefined}>
                    <input type="hidden" name="user_id" value={u.id} />
                    <input type="hidden" name="active" value={u.is_active ? "false" : "true"} />
                  </ActionForm>
                  <ActionForm action={resetLinkAction} submitLabel="สร้างลิงก์ตั้งรหัสผ่าน" submitClass={btnGhost} inlineSubmit className="">
                    <input type="hidden" name="user_id" value={u.id} />
                  </ActionForm>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>

      {manage && (
        <Card title="เพิ่มพนักงาน" className="mt-6">
          <ActionForm action={inviteStaffAction} submitLabel="เพิ่มพนักงาน" submitClass={btnPrimary} className="grid gap-4 sm:grid-cols-4" resetOnSuccess>
            <Field label="ชื่อ"><input name="name" required className={inputCls} /></Field>
            <Field label="อีเมล"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="บทบาท">
              <select name="role" defaultValue="front_desk" className={inputCls}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            </Field>
            <div />
          </ActionForm>
          <p className="mt-2 text-xs text-ink/60">ระบบจะสร้างลิงก์ให้พนักงานตั้งรหัสผ่านเอง (ส่งทางอีเมลอัตโนมัติเมื่อตั้งค่าระบบอีเมลแล้ว)</p>
        </Card>
      )}

      <Card title="สิทธิ์ของแต่ละบทบาท" className="mt-6">
        <Table head={["สิทธิ์", ...ROLES.map((r) => ROLE_LABEL[r])]} minWidth={640}>
          {Object.entries(PERMISSION_MATRIX).map(([p, row]) => (
            <tr key={p}>
              <td className="px-4 py-2">{PERM_LABEL[p] ?? p}</td>
              {ROLES.map((r) => <td key={r} className={`px-4 py-2 text-center ${row[r] === "approval" ? "text-gold-600" : ""}`}>{DECISION[row[r]]}</td>)}
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
