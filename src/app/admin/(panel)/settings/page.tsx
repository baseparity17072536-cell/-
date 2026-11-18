import { TranslationFields } from "@/components/admin/translation-fields";
import { ActionForm } from "@/components/admin/action-form";
import { ApprovalNotice, btnPrimary, Card, Field, inputCls, NoAccess, PageHeader } from "@/components/admin/ui";
import { satangToBahtInput } from "@/lib/money";
import { getProperty } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { savePropertyAction } from "../../actions";

export default async function SettingsPage() {
  const { tenant, propertyId, access } = await requireStaff("property.edit");
  if (access === "deny") return <NoAccess />;
  const p = (await getProperty(tenant.id, propertyId))!;
  const t = (x: string) => x.slice(0, 5);

  return (
    <>
      <PageHeader title="ตั้งค่าที่พัก & ภาษี" subtitle="ข้อมูลนี้แสดงบนหน้าเว็บและใช้คำนวณการจอง" />
      {access === "approval" && <ApprovalNotice />}
      <ActionForm action={savePropertyAction} submitLabel={access === "approval" ? "ส่งคำขออนุมัติ" : "บันทึก"} submitClass={btnPrimary} className="space-y-6">
        <Card title="ข้อมูลที่พัก">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ชื่อที่พัก (ไทย)"><input name="name_th" required defaultValue={p.name_th} className={inputCls} /></Field>
            <Field label="เบอร์โทร"><input name="phone" defaultValue={p.phone ?? ""} className={inputCls} /></Field>
            <Field label="อีเมล"><input name="email" type="email" defaultValue={p.email ?? ""} className={inputCls} /></Field>
            <Field label="ที่อยู่" className="sm:col-span-2"><textarea name="address" rows={2} defaultValue={p.address ?? ""} className={inputCls} /></Field>
            <Field label="Facebook (https://…)"><input name="facebook_url" defaultValue={p.facebook_url ?? ""} className={inputCls} /></Field>
            <Field label="LINE (https://…)"><input name="line_url" defaultValue={p.line_url ?? ""} className={inputCls} /></Field>
          </div>
          <div className="mt-4">
            <TranslationFields value={p.translations} fields={[{ key: "name", label: "ชื่อที่พัก" }, { key: "address", label: "ที่อยู่", rows: 2 }]} />
          </div>
        </Card>
        <Card title="กฎการจอง">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="เวลาเช็คอิน"><input type="time" name="check_in_time" defaultValue={t(p.check_in_time)} className={inputCls} /></Field>
            <Field label="เวลาเช็คเอาท์"><input type="time" name="check_out_time" defaultValue={t(p.check_out_time)} className={inputCls} /></Field>
            <Field label="กันห้องรอชำระ (ชั่วโมง)"><input type="number" name="hold_hours" min={1} max={168} defaultValue={Math.round(p.hold_minutes / 60)} className={inputCls} /></Field>
            <Field label="จองได้สูงสุด (คืน)"><input type="number" name="max_nights" min={1} max={365} defaultValue={p.max_nights} className={inputCls} /></Field>
            <Field label="จองล่วงหน้าได้ (วัน)"><input type="number" name="booking_window_days" min={1} max={730} defaultValue={p.booking_window_days} className={inputCls} /></Field>
            <Field label="อายุเด็กสูงสุด (ปี)"><input type="number" name="child_max_age" min={0} max={17} defaultValue={p.child_max_age} className={inputCls} /></Field>
            <Field label="เงินประกันความเสียหาย (บาท)" hint="เก็บที่รีสอร์ท คืนเมื่อเช็คเอาท์"><input name="damage_deposit" inputMode="decimal" defaultValue={satangToBahtInput(p.damage_deposit_satang)} className={inputCls} /></Field>
          </div>
        </Card>
        <Card title="ภาษีและค่าบริการ">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="ราคาที่ตั้งไว้">
              <select name="prices_include_tax" defaultValue={String(p.prices_include_tax)} className={inputCls}>
                <option value="true">รวมภาษีและค่าบริการแล้ว</option>
                <option value="false">ยังไม่รวม (บวกเพิ่มตอนคิดเงิน)</option>
              </select>
            </Field>
            <Field label="VAT (%)"><input name="vat" inputMode="decimal" defaultValue={p.vat_bp / 100} className={inputCls} /></Field>
            <Field label="ค่าบริการ / Service charge (%)"><input name="service_charge" inputMode="decimal" defaultValue={p.service_charge_bp / 100} className={inputCls} /></Field>
            <Field label="ชื่อนิติบุคคล / ผู้ประกอบการ"><input name="legal_name" defaultValue={p.legal_name ?? ""} className={inputCls} /></Field>
            <Field label="เลขประจำตัวผู้เสียภาษี"><input name="tax_id" inputMode="numeric" defaultValue={p.tax_id ?? ""} className={inputCls} /></Field>
          </div>
          <p className="mt-3 text-xs text-ink/60">คิดค่าบริการจากราคาห้อง แล้วคิด VAT จาก (ราคาห้อง + ค่าบริการ) · ระบบคิดภาษีครั้งเดียวเสมอ · การเปลี่ยนค่าเหล่านี้ไม่กระทบการจองที่สร้างไปแล้ว</p>
        </Card>
      </ActionForm>
    </>
  );
}
