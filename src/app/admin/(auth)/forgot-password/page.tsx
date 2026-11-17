import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Field, inputCls } from "@/components/admin/ui";
import { forgotPasswordAction } from "../../actions";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-bold">ลืมรหัสผ่าน</h1>
      <p className="mb-5 mt-1 text-sm text-ink/60">กรอกอีเมลที่ใช้เข้าสู่ระบบ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้</p>
      <ActionForm action={forgotPasswordAction} submitLabel="ส่งลิงก์ตั้งรหัสผ่าน" submitClass={`${btnPrimary} w-full`}>
        <Field label="อีเมล">
          <input name="email" type="email" required autoComplete="username" className={inputCls} />
        </Field>
      </ActionForm>
      <Link href="/admin/login" className="mt-4 block text-center text-sm text-gold-600 underline">
        กลับไปหน้าเข้าสู่ระบบ
      </Link>
    </>
  );
}
