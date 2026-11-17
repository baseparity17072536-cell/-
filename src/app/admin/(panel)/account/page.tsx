import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Card, Field, inputCls, PageHeader } from "@/components/admin/ui";
import { requireStaff } from "@/server/context";
import { ROLE_LABEL } from "@/server/rbac";
import { changePasswordAction } from "../../actions";

export default async function AccountPage() {
  const { session } = await requireStaff();
  return (
    <>
      <PageHeader title="บัญชีของฉัน" subtitle={`${session.name} · ${session.email} · ${ROLE_LABEL[session.role]}`} />
      <Card title="เปลี่ยนรหัสผ่าน" className="max-w-md">
        <ActionForm action={changePasswordAction} submitLabel="เปลี่ยนรหัสผ่าน" submitClass={btnPrimary}>
          <Field label="รหัสผ่านปัจจุบัน"><input type="password" name="current" required autoComplete="current-password" className={inputCls} /></Field>
          <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัว มีทั้งตัวอักษรและตัวเลข"><input type="password" name="next" required minLength={10} autoComplete="new-password" className={inputCls} /></Field>
          <Field label="ยืนยันรหัสผ่านใหม่"><input type="password" name="confirm" required minLength={10} autoComplete="new-password" className={inputCls} /></Field>
        </ActionForm>
        <p className="mt-3 text-xs text-ink/60">หลังเปลี่ยนรหัสผ่าน ทุกอุปกรณ์จะถูกออกจากระบบ</p>
      </Card>
    </>
  );
}
