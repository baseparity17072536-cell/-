import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import QRCode from "qrcode";
import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Field, inputCls, Skeleton } from "@/components/admin/ui";
import { getStaff, getTenant } from "@/server/context";
import { getMfaStatus } from "@/server/mfa";
import { confirmMfaAction, logoutAction } from "../../actions";

// Set up two-factor sign-in. Owners are sent here by requireStaff() until it is done;
// other roles reach it from "บัญชีของฉัน". Lives outside the panel layout on purpose
// (the panel itself requires finished setup).
export default function MfaSetupPage() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <Setup />
    </Suspense>
  );
}

async function Setup() {
  const tenant = await getTenant();
  const session = await getStaff();
  if (!session) redirect("/admin/login");
  const status = await getMfaStatus(tenant.id, session);
  if (status.enabled) redirect("/admin/account");
  const { secret, uri } = status.setup!;
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return (
    <>
      <h1 className="text-xl font-bold">ตั้งค่ายืนยันตัวตน 2 ขั้นตอน</h1>
      <p className="mb-4 mt-1 text-sm text-ink/60">
        {session.mfaRequired
          ? "บัญชีเจ้าของต้องใช้รหัสจากโทรศัพท์ทุกครั้งที่เข้าสู่ระบบ เพื่อป้องกันกรณีรหัสผ่านรั่ว"
          : "เพิ่มความปลอดภัยให้บัญชี: เข้าสู่ระบบด้วยรหัสผ่าน + รหัสจากโทรศัพท์"}
      </p>
      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm">
        <li>ติดตั้งแอป <b>Google Authenticator</b> หรือ <b>Microsoft Authenticator</b> ในโทรศัพท์</li>
        <li>ในแอปกด “+” แล้วสแกน QR นี้</li>
      </ol>
      <div className="mx-auto mb-2 w-48 rounded-lg bg-white p-2 ring-1 ring-cream-200" dangerouslySetInnerHTML={{ __html: svg }} />
      <details className="mb-4 text-center text-xs text-ink/60">
        <summary className="cursor-pointer">สแกนไม่ได้? ใส่รหัสเอง</summary>
        <p className="mt-2 break-all font-mono text-sm text-ink">{secret.match(/.{1,4}/g)!.join(" ")}</p>
      </details>
      <p className="mb-2 text-sm">3. กรอกรหัส 6 หลักที่แอปแสดง</p>
      <ActionForm action={confirmMfaAction} submitLabel="ยืนยันและเปิดใช้" submitClass={`${btnPrimary} w-full`}>
        <Field label="รหัสจากแอป">
          <input
            name="code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7}
            className={`${inputCls} text-center font-mono text-lg tracking-widest`} placeholder="123456"
          />
        </Field>
      </ActionForm>
      <Link href="/admin" className="mt-4 block text-center text-sm font-semibold text-teal-deep underline">
        เก็บรหัสกู้คืนแล้ว ไปหน้าหลังบ้าน →
      </Link>
      <form action={logoutAction} className="mt-2 text-center">
        <button type="submit" className="text-xs text-ink/50 underline">ออกจากระบบ</button>
      </form>
    </>
  );
}
