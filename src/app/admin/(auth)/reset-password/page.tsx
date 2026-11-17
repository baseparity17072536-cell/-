import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Field, inputCls } from "@/components/admin/ui";
import { resetPasswordAction } from "../../actions";

export default function ResetPasswordPage({ searchParams }: PageProps<"/admin/reset-password">) {
  return (
    <>
      <h1 className="text-xl font-bold">ตั้งรหัสผ่านใหม่</h1>
      <p className="mb-5 mt-1 text-sm text-ink/60">อย่างน้อย 10 ตัวอักษร มีทั้งตัวอักษรและตัวเลข</p>
      <Suspense>
        <ResetForm searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ResetForm({ searchParams }: Pick<PageProps<"/admin/reset-password">, "searchParams">) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !token)
    return (
      <p className="text-sm text-red-700">
        ลิงก์ไม่ถูกต้อง · <Link href="/admin/forgot-password" className="underline">ขอลิงก์ใหม่</Link>
      </p>
    );
  return (
    <ActionForm action={resetPasswordAction} submitLabel="บันทึกรหัสผ่าน" submitClass={`${btnPrimary} w-full`}>
      <input type="hidden" name="token" value={token} />
      <Field label="รหัสผ่านใหม่">
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputCls} />
      </Field>
      <Field label="ยืนยันรหัสผ่านใหม่">
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputCls} />
      </Field>
    </ActionForm>
  );
}
