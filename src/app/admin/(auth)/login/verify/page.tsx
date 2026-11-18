import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Field, inputCls } from "@/components/admin/ui";
import { verifyMfaAction } from "../../../actions";

// Second sign-in step. The pending login lives in an httpOnly cookie set by loginAction;
// without it (or after 5 minutes) the action asks the user to sign in again.
export default function VerifyPage() {
  return (
    <>
      <h1 className="text-xl font-bold">ยืนยันตัวตน 2 ขั้นตอน</h1>
      <p className="mb-5 mt-1 text-sm text-ink/60">เปิดแอป Authenticator ในโทรศัพท์ แล้วกรอกรหัส 6 หลักของ FahTalay</p>
      <ActionForm action={verifyMfaAction} submitLabel="ยืนยัน" submitClass={`${btnPrimary} w-full`}>
        <Field label="รหัสจากแอป" hint="หรือรหัสกู้คืน (เช่น K7QX-M2PA) ถ้าไม่มีโทรศัพท์">
          <input
            name="code" required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={20}
            className={`${inputCls} text-center font-mono text-lg tracking-widest`} placeholder="123456"
          />
        </Field>
      </ActionForm>
      <Link href="/admin/login" className="mt-4 block text-center text-sm text-gold-600 underline">
        เข้าสู่ระบบใหม่
      </Link>
    </>
  );
}
