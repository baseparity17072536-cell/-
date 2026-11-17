import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Field, inputCls } from "@/components/admin/ui";
import { loginAction } from "../../actions";

export default function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <>
      <h1 className="text-xl font-bold">เข้าสู่ระบบหลังบ้าน</h1>
      <p className="mb-5 mt-1 text-sm text-ink/60">สำหรับเจ้าของและพนักงานโรงแรม</p>
      <Suspense>
        <Notice searchParams={searchParams} />
      </Suspense>
      <ActionForm action={loginAction} submitLabel="เข้าสู่ระบบ" submitClass={`${btnPrimary} w-full`}>
        <Field label="อีเมล">
          <input name="email" type="email" required autoComplete="username" className={inputCls} />
        </Field>
        <Field label="รหัสผ่าน">
          <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
        </Field>
      </ActionForm>
      <Link href="/admin/forgot-password" className="mt-4 block text-center text-sm text-gold-600 underline">
        ลืมรหัสผ่าน?
      </Link>
    </>
  );
}

async function Notice({ searchParams }: Pick<PageProps<"/admin/login">, "searchParams">) {
  const sp = await searchParams;
  const msg = sp.reset ? "ตั้งรหัสผ่านใหม่เรียบร้อย กรุณาเข้าสู่ระบบ" : sp.changed ? "เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบอีกครั้ง" : null;
  return msg ? <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p> : null;
}
