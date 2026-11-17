import { ActionForm } from "@/components/admin/action-form";
import { btnPrimary, Field, inputCls } from "@/components/admin/ui";
import { satangToBahtInput } from "@/lib/money";
import type { RoomTypeRecord } from "@/server/catalog";
import { saveRoomTypeAction } from "../../actions";

export default function RoomTypeForm({ t, priceAccess }: { t?: RoomTypeRecord; priceAccess: "allow" | "approval" | "deny" }) {
  const priceLocked = priceAccess === "deny" || (!t && priceAccess !== "allow");
  return (
    <ActionForm action={saveRoomTypeAction} submitLabel={t ? "บันทึกการแก้ไข" : "สร้างประเภทห้อง"} submitClass={btnPrimary} className="space-y-5">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="ชื่อประเภทห้อง (ไทย)" className="sm:col-span-2"><input name="name_th" required defaultValue={t?.name_th} className={inputCls} /></Field>
        <Field label="รหัส (Room Type Code)" hint="เช่น DLX, VILLA_GV"><input name="code" required defaultValue={t?.code} pattern="[A-Za-z0-9_-]{2,20}" className={`${inputCls} uppercase`} /></Field>
        <Field label="ชื่อภาษาอังกฤษ" className="sm:col-span-2"><input name="name_en" defaultValue={t?.name_en ?? ""} className={inputCls} /></Field>
        <Field label="ลำดับการแสดง"><input name="sort_order" type="number" min={0} max={1000} defaultValue={t?.sort_order ?? 0} className={inputCls} /></Field>
      </div>
      <Field label="รายละเอียดห้อง (ไทย)"><textarea name="description_th" rows={3} defaultValue={t?.description_th} className={inputCls} /></Field>
      <Field label="รายละเอียดห้อง (อังกฤษ)"><textarea name="description_en" rows={2} defaultValue={t?.description_en ?? ""} className={inputCls} /></Field>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="ประเภทเตียง"><input name="bed_info" defaultValue={t?.bed_info} placeholder="เตียงคิงไซซ์" className={inputCls} /></Field>
        <Field label="จำนวนเตียง"><input name="bed_count" type="number" min={0} max={20} defaultValue={t?.bed_count ?? 1} className={inputCls} /></Field>
        <Field label="วิวห้อง"><input name="view_type" defaultValue={t?.view_type ?? ""} placeholder="วิวทะเล" className={inputCls} /></Field>
        <Field label="ขนาด (ตร.ม.)"><input name="size_sqm" type="number" min={1} defaultValue={t?.size_sqm ?? ""} className={inputCls} /></Field>
        <Field label="อาคาร/ชั้น"><input name="building" defaultValue={t?.building ?? ""} className={inputCls} /></Field>
        <Field label="วิดีโอ (ลิงก์ https)" className="sm:col-span-3"><input name="video_url" type="url" defaultValue={t?.video_url ?? ""} placeholder="https://youtube.com/…" className={inputCls} /></Field>
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-5">
        <legend className="mb-1 text-sm font-semibold">จำนวนผู้เข้าพักต่อห้อง</legend>
        <Field label="ผู้ใหญ่ที่รวมในราคา"><input name="base_adults" type="number" min={1} defaultValue={t?.base_adults ?? 2} className={inputCls} /></Field>
        <Field label="ผู้ใหญ่สูงสุด"><input name="max_adults" type="number" min={1} defaultValue={t?.max_adults ?? 2} className={inputCls} /></Field>
        <Field label="เด็กสูงสุด"><input name="max_children" type="number" min={0} defaultValue={t?.max_children ?? 1} className={inputCls} /></Field>
        <Field label="รวมสูงสุด"><input name="max_occupancy" type="number" min={1} defaultValue={t?.max_occupancy ?? 3} className={inputCls} /></Field>
        <Field label="เตียงเสริมสูงสุด"><input name="max_extra_beds" type="number" min={0} defaultValue={t?.max_extra_beds ?? 0} className={inputCls} /></Field>
      </fieldset>
      <fieldset className="grid gap-4 rounded-lg bg-ivory p-4 sm:grid-cols-4" disabled={priceLocked}>
        <legend className="px-1 text-sm font-semibold">
          ราคา (บาท) {priceAccess === "approval" && t && <span className="font-normal text-gold-600">· การแก้ราคาต้องรอเจ้าของอนุมัติ</span>}
          {priceLocked && !t && <span className="font-normal text-ink/60">· การสร้างประเภทห้องใหม่ทำได้เฉพาะเจ้าของ</span>}
        </legend>
        <Field label="ราคาพื้นฐาน / คืน"><input name="base_price" inputMode="decimal" required defaultValue={t ? satangToBahtInput(t.base_price_satang) : ""} className={inputCls} /></Field>
        <Field label="ผู้ใหญ่เพิ่ม / คน / คืน"><input name="extra_adult" inputMode="decimal" defaultValue={t ? satangToBahtInput(t.extra_adult_satang) : "0"} className={inputCls} /></Field>
        <Field label="เด็ก / คน / คืน"><input name="child_price" inputMode="decimal" defaultValue={t ? satangToBahtInput(t.child_satang) : "0"} className={inputCls} /></Field>
        <Field label="เตียงเสริม / เตียง / คืน"><input name="extra_bed" inputMode="decimal" defaultValue={t ? satangToBahtInput(t.extra_bed_satang) : "0"} className={inputCls} /></Field>
      </fieldset>
      {priceLocked && t && (
        <>
          {/* disabled fields are not submitted: send current prices so nothing changes */}
          <input type="hidden" name="base_price" value={satangToBahtInput(t.base_price_satang)} />
          <input type="hidden" name="extra_adult" value={satangToBahtInput(t.extra_adult_satang)} />
          <input type="hidden" name="child_price" value={satangToBahtInput(t.child_satang)} />
          <input type="hidden" name="extra_bed" value={satangToBahtInput(t.extra_bed_satang)} />
        </>
      )}
      <Field label="สิ่งอำนวยความสะดวก (บรรทัดละ 1 รายการ)"><textarea name="amenities" rows={4} defaultValue={t?.amenities.join("\n")} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={t?.is_active ?? true} className="size-4 accent-[#123c46]" /> เปิดขายประเภทห้องนี้</label>
    </ActionForm>
  );
}
