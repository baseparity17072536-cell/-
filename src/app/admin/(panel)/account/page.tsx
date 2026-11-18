import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/admin/action-form";
import { btnGhost, btnPrimary, Card, Field, inputCls, PageHeader } from "@/components/admin/ui";
import { mfaRequiredFor } from "@/server/auth";
import { requireStaff } from "@/server/context";
import { getMfaStatus } from "@/server/mfa";
import { ROLE_LABEL } from "@/server/rbac";
import { changePasswordAction, disableMfaAction, regenerateRecoveryAction } from "../../actions";

export default async function AccountPage({ searchParams }: PageProps<"/admin/account">) {
  const { tenant, session } = await requireStaff();
  const mfa = session.mfaEnabled ? await getMfaStatus(tenant.id, session) : null;
  return (
    <>
      <PageHeader title="บัญชีของฉัน" subtitle={`${session.name} · ${session.email} · ${ROLE_LABEL[session.role]}`} />
      <Suspense>
        <RecoveryNotice searchParams={searchParams} />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="เปลี่ยนรหัสผ่าน">
          <ActionForm action={changePasswordAction} submitLabel="เปลี่ยนรหัสผ่าน" submitClass={btnPrimary}>
            <Field label="รหัสผ่านปัจจุบัน"><input type="password" name="current" required autoComplete="current-password" className={inputCls} /></Field>
            <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 10 ตัว มีทั้งตัวอักษรและตัวเลข"><input type="password" name="next" required minLength={10} autoComplete="new-password" className={inputCls} /></Field>
            <Field label="ยืนยันรหัสผ่านใหม่"><input type="password" name="confirm" required minLength={10} autoComplete="new-password" className={inputCls} /></Field>
          </ActionForm>
          <p className="mt-3 text-xs text-ink/60">หลังเปลี่ยนรหัสผ่าน ทุกอุปกรณ์จะถูกออกจากระบบ</p>
        </Card>

        <Card title="ยืนยันตัวตน 2 ขั้นตอน">
          {!mfa ? (
            <div className="space-y-3 text-sm">
              <p>ยังไม่ได้เปิด · เมื่อเปิดแล้ว การเข้าสู่ระบบต้องใช้รหัสผ่าน + รหัส 6 หลักจากแอปในโทรศัพท์</p>
              <Link href="/admin/mfa-setup" className={btnPrimary}>เปิดใช้งาน</Link>
            </div>
          ) : (
            <div className="space-y-5 text-sm">
              <p>
                <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">เปิดใช้งานอยู่</span>
                <span className={`ml-2 ${mfa.recoveryLeft <= 3 ? "font-semibold text-red-700" : "text-ink/60"}`}>รหัสกู้คืนเหลือ {mfa.recoveryLeft} รหัส</span>
              </p>
              <div>
                <p className="mb-2 font-medium">สร้างรหัสกู้คืนชุดใหม่</p>
                <ActionForm action={regenerateRecoveryAction} submitLabel="สร้างชุดใหม่" submitClass={btnGhost}>
                  <Field label="รหัสจากแอป"><input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className={inputCls} /></Field>
                </ActionForm>
              </div>
              {mfaRequiredFor(session.role) ? (
                <div>
                  <p className="mb-1 font-medium">ย้ายไปโทรศัพท์เครื่องใหม่</p>
                  <p className="mb-2 text-xs text-ink/60">ยกเลิกโทรศัพท์เครื่องเดิมแล้วสแกน QR ใหม่ทันที (บทบาทเจ้าของปิดการยืนยัน 2 ขั้นตอนไม่ได้)</p>
                  <ActionForm action={disableMfaAction} submitLabel="ตั้งค่าเครื่องใหม่" submitClass={btnGhost} confirm="ยกเลิกโทรศัพท์เครื่องเดิมและรหัสกู้คืนทั้งหมด แล้วตั้งค่าใหม่?">
                    <Field label="รหัสผ่าน"><input type="password" name="password" required autoComplete="current-password" className={inputCls} /></Field>
                  </ActionForm>
                </div>
              ) : (
                <div>
                  <p className="mb-2 font-medium">ปิดการยืนยัน 2 ขั้นตอน</p>
                  <ActionForm action={disableMfaAction} submitLabel="ปิดใช้งาน" submitClass={btnGhost} confirm="ปิดการยืนยันตัวตน 2 ขั้นตอน? บัญชีจะเหลือแค่รหัสผ่าน">
                    <Field label="รหัสผ่าน"><input type="password" name="password" required autoComplete="current-password" className={inputCls} /></Field>
                  </ActionForm>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

async function RecoveryNotice({ searchParams }: Pick<PageProps<"/admin/account">, "searchParams">) {
  const left = Number((await searchParams).recovery_left);
  if (!Number.isInteger(left)) return null;
  return (
    <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      คุณเข้าสู่ระบบด้วยรหัสกู้คืน (เหลือ {left} รหัส) · ถ้าโทรศัพท์หายหรือเปลี่ยนเครื่อง ให้ตั้งค่าเครื่องใหม่ด้านล่าง
    </p>
  );
}
