import { ActionButton, ActionForm } from "@/components/admin/action-form";
import { MEAL_LABEL, RULE_KIND_LABEL, WEEKDAY_SHORT } from "@/components/admin/labels";
import { ApprovalNotice, btnDanger, btnGhost, btnPrimary, Card, Empty, Field, inputCls, NoAccess, PageHeader, Table } from "@/components/admin/ui";
import { formatThaiDate } from "@/lib/dates";
import { formatSatang, satangToBahtInput } from "@/lib/money";
import { listPriceRules, listRatePlans, listRoomTypes, type RatePlanRecord } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { deletePriceRuleAction, savePriceRuleAction, saveRatePlanAction } from "../../actions";

export default async function RatesPage() {
  const { tenant, propertyId, access } = await requireStaff("rates.edit");
  if (access === "deny") return <NoAccess what="การจัดการราคา" />;
  const [plans, rules, types] = await Promise.all([
    listRatePlans(tenant.id, propertyId), listPriceRules(tenant.id, propertyId), listRoomTypes(tenant.id, propertyId),
  ]);
  const submit = access === "approval" ? "ส่งคำขออนุมัติ" : "บันทึก";

  return (
    <>
      <PageHeader title="แพ็กเกจ & กฎราคา" subtitle="ลำดับการคิดราคาต่อคืน: ราคากำหนดรายวัน (ปฏิทิน) → กฎราคาที่ลำดับความสำคัญสูงสุด → ราคาพื้นฐาน → ปรับตามแพ็กเกจ → ภาษี/ค่าบริการ" />
      {access === "approval" && <ApprovalNotice />}

      <Card title="กฎราคา (วันธรรมดา / ศุกร์–เสาร์ / ฤดูกาล / เทศกาล)" className="mb-6">
        {rules.length === 0 ? <Empty title="ยังไม่มีกฎราคา">ทุกคืนใช้ราคาพื้นฐานของประเภทห้อง</Empty> : (
          <Table head={["ประเภทห้อง", "ชื่อกฎ", "ประเภท", "ช่วงวันที่", "วัน", "ราคา/คืน", "ลำดับ", ""]} minWidth={900}>
            {rules.map((r) => (
              <tr key={r.id} className={r.is_active ? "" : "text-ink/40"}>
                <td className="px-4 py-2">{r.type_name}</td>
                <td className="px-4 py-2 font-medium">{r.name}{!r.is_active && " (ปิด)"}</td>
                <td className="px-4 py-2 text-xs">{RULE_KIND_LABEL[r.kind]}</td>
                <td className="px-4 py-2 text-xs">{r.date_from ? formatThaiDate(r.date_from) : "ไม่กำหนด"} – {r.date_to ? formatThaiDate(r.date_to) : "ไม่กำหนด"}</td>
                <td className="px-4 py-2 text-xs">{r.weekdays.length ? r.weekdays.map((w) => WEEKDAY_SHORT[w]).join(" ") : "ทุกวัน"}</td>
                <td className="px-4 py-2 tabular-nums">{formatSatang(r.price_satang)}</td>
                <td className="px-4 py-2 tabular-nums">{r.priority}</td>
                <td className="px-4 py-2 text-right">
                  <ActionButton action={deletePriceRuleAction} fields={{ id: r.id, room_type_id: r.room_type_id, name: r.name }} label="ลบ" className={btnDanger} confirm={`ลบกฎราคา “${r.name}”?`} />
                </td>
              </tr>
            ))}
          </Table>
        )}
        <details className="mt-4 rounded-lg bg-ivory p-4">
          <summary className="cursor-pointer text-sm font-semibold">+ เพิ่มกฎราคา</summary>
          <ActionForm action={savePriceRuleAction} submitLabel={submit} submitClass={btnPrimary} className="mt-4 space-y-4" resetOnSuccess>
            <fieldset>
              <legend className="text-sm font-medium">ใช้กับประเภทห้อง</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {types.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="room_type_id" value={t.id} className="size-4 accent-[#123c46]" /> {t.name_th} <span className="text-xs text-ink/50">(พื้นฐาน {formatSatang(t.base_price_satang)})</span></label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="ชื่อกฎ" className="sm:col-span-2"><input name="name" required placeholder="เช่น ราคาวันเสาร์, High Season, ปีใหม่" className={inputCls} /></Field>
              <Field label="ประเภท">
                <select name="kind" className={inputCls}>{Object.entries(RULE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Field>
              <Field label="ราคา/คืน (บาท)"><input name="price" inputMode="decimal" required className={inputCls} /></Field>
              <Field label="ตั้งแต่วันที่" hint="ไม่บังคับสำหรับกฎวันในสัปดาห์"><input type="date" name="date_from" className={inputCls} /></Field>
              <Field label="ถึงวันที่"><input type="date" name="date_to" className={inputCls} /></Field>
              <Field label="ลำดับความสำคัญ (0–1000)" hint="ตัวเลขมากชนะ เช่น วันธรรมดา 10, ศุกร์–เสาร์ 20, ฤดูกาล 50, เทศกาล 100"><input name="priority" type="number" min={0} max={1000} defaultValue={10} className={inputCls} /></Field>
              <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" name="is_active" defaultChecked className="size-4 accent-[#123c46]" /> เปิดใช้งาน</label>
            </div>
            <fieldset>
              <legend className="text-sm font-medium">เฉพาะวันในสัปดาห์ (ไม่เลือก = ทุกวันในช่วง)</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {WEEKDAY_SHORT.map((w, i) => <label key={i} className="flex items-center gap-1 text-sm"><input type="checkbox" name="weekdays" value={i} className="size-4 accent-[#123c46]" /> {w}</label>)}
              </div>
            </fieldset>
          </ActionForm>
        </details>
      </Card>

      <Card title="แพ็กเกจราคา (Rate Plans)">
        <p className="mb-4 text-sm text-ink/60">เช่น “ราคาห้องพัก” (หลัก) และ “รวมอาหารเช้า +15%” · แพ็กเกจจะปรับจากราคาต่อคืนที่คำนวณได้</p>
        <div className="space-y-3">
          {plans.map((p) => (
            <details key={p.id} className="rounded-lg ring-1 ring-cream-200">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-semibold">{p.name_th} <span className="text-xs font-normal text-ink/50">{p.code}</span>{p.is_default && <span className="ml-2 rounded bg-gold-300/40 px-1.5 text-xs">หลัก</span>}{!p.is_active && <span className="ml-2 text-xs text-ink/50">(ปิด)</span>}</span>
                <span className="text-xs text-ink/60">{MEAL_LABEL[p.meal_plan]} · {p.adjust_type === "none" ? "ราคาตามห้อง" : p.adjust_type === "percent" ? `${p.adjust_value > 0 ? "+" : ""}${p.adjust_value}%` : `${p.adjust_value > 0 ? "+" : ""}${formatSatang(p.adjust_value)}/คืน`}</span>
              </summary>
              <div className="border-t border-cream-200 p-4"><PlanForm p={p} submit={submit} /></div>
            </details>
          ))}
          <details className="rounded-lg bg-ivory p-4">
            <summary className="cursor-pointer text-sm font-semibold">+ เพิ่มแพ็กเกจ</summary>
            <div className="mt-4"><PlanForm submit={submit} /></div>
          </details>
        </div>
      </Card>
    </>
  );
}

function PlanForm({ p, submit }: { p?: RatePlanRecord; submit: string }) {
  return (
    <ActionForm action={saveRatePlanAction} submitLabel={submit} submitClass={btnGhost} className="space-y-4">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="ชื่อแพ็กเกจ" className="sm:col-span-2"><input name="name_th" required defaultValue={p?.name_th} className={inputCls} /></Field>
        <Field label="รหัส"><input name="code" required defaultValue={p?.code} pattern="[A-Za-z0-9_-]{2,20}" className={`${inputCls} uppercase`} /></Field>
        <Field label="อาหาร">
          <select name="meal_plan" defaultValue={p?.meal_plan ?? "room_only"} className={inputCls}>{Object.entries(MEAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="ปรับราคา">
          <select name="adjust_type" defaultValue={p?.adjust_type ?? "none"} className={inputCls}>
            <option value="none">ไม่ปรับ</option><option value="percent">เปอร์เซ็นต์ (%)</option><option value="fixed">บาทต่อห้องต่อคืน</option>
          </select>
        </Field>
        <Field label="ค่าที่ปรับ" hint="% เช่น 15 หรือ -10 · บาท เช่น 300"><input name="adjust_value" defaultValue={p ? (p.adjust_type === "fixed" ? satangToBahtInput(p.adjust_value) : String(p.adjust_value)) : "0"} className={inputCls} /></Field>
        <Field label="พักขั้นต่ำ (คืน)"><input name="min_nights" type="number" min={1} defaultValue={p?.min_nights ?? 1} className={inputCls} /></Field>
        <Field label="ลำดับ"><input name="sort_order" type="number" min={0} defaultValue={p?.sort_order ?? 0} className={inputCls} /></Field>
      </div>
      <Field label="รายละเอียด"><input name="description_th" defaultValue={p?.description_th} className={inputCls} /></Field>
      <input type="hidden" name="name_en" value={p?.name_en ?? ""} />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={p?.is_active ?? true} className="size-4 accent-[#123c46]" /> เปิดใช้งาน</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_default" defaultChecked={p?.is_default ?? false} className="size-4 accent-[#123c46]" /> แพ็กเกจหลัก</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_refundable" defaultChecked={p?.is_refundable ?? true} className="size-4 accent-[#123c46]" /> คืนเงินได้</label>
      </div>
    </ActionForm>
  );
}
