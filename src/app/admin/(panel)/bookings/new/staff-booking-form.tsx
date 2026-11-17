"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { btnGold, btnGhost, Field, inputCls } from "@/components/admin/ui";
import { createStaffBookingAction } from "../../../actions";

type Opt = { id: string; name: string };
type TypeOpt = Opt & { maxAdults: number; maxChildren: number; maxExtraBeds: number };

export default function StaffBookingForm({
  types, plans, checkIn, checkOut, canConfirm,
}: { types: TypeOpt[]; plans: Opt[]; checkIn: string; checkOut: string; canConfirm: boolean }) {
  const [rows, setRows] = useState([{ key: 0, type: types[0]?.id ?? "" }]);
  const [idem] = useState(() => crypto.randomUUID());
  const add = () => setRows((r) => [...r, { key: Math.max(...r.map((x) => x.key)) + 1, type: types[0]?.id ?? "" }]);

  return (
    <ActionForm action={createStaffBookingAction} submitLabel="บันทึกการจอง" submitClass={btnGold} className="space-y-5">
      <input type="hidden" name="idempotency_key" value={idem} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="วันเช็คอิน"><input type="date" name="check_in" required defaultValue={checkIn} className={inputCls} /></Field>
        <Field label="วันเช็คเอาท์"><input type="date" name="check_out" required defaultValue={checkOut} className={inputCls} /></Field>
        <Field label="ช่องทางการจอง">
          <select name="source" defaultValue="phone" className={inputCls}>
            <option value="phone">โทรศัพท์</option>
            <option value="walk_in">Walk-in (มาที่รีสอร์ท)</option>
            <option value="facebook">Facebook</option>
            <option value="line">LINE</option>
          </select>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">ห้องพัก</legend>
        {rows.map((r, i) => {
          const t = types.find((x) => x.id === r.type);
          return (
            <div key={r.key} className="grid items-end gap-3 rounded-lg bg-ivory p-3 sm:grid-cols-[2fr_1.5fr_repeat(3,1fr)_auto]">
              <Field label={`ห้องที่ ${i + 1}`}>
                <select name="room_type" value={r.type} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, type: e.target.value } : x)))} className={inputCls}>
                  {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label="แพ็กเกจ">
                <select name={`rate_plan_${i}`} className={inputCls}>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="ผู้ใหญ่"><input type="number" name="adults" min={1} max={t?.maxAdults ?? 10} defaultValue={Math.min(2, t?.maxAdults ?? 2)} required className={inputCls} /></Field>
              <Field label="เด็ก"><input type="number" name="children" min={0} max={t?.maxChildren ?? 0} defaultValue={0} className={inputCls} /></Field>
              <Field label="เตียงเสริม"><input type="number" name="extra_beds" min={0} max={t?.maxExtraBeds ?? 0} defaultValue={0} className={inputCls} /></Field>
              <button type="button" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className={btnGhost} aria-label={`ลบห้องที่ ${i + 1}`}>
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
        <button type="button" onClick={add} disabled={rows.length >= 10} className={btnGhost}><Plus className="size-4" /> เพิ่มห้อง</button>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">ข้อมูลผู้ติดต่อ</legend>
        <Field label="ชื่อ-นามสกุล"><input name="name" required minLength={2} className={inputCls} /></Field>
        <Field label="เบอร์โทรศัพท์"><input name="phone" type="tel" required className={inputCls} /></Field>
        <Field label="อีเมล (ถ้ามี)"><input name="email" type="email" className={inputCls} /></Field>
        <Field label="คำขอพิเศษจากลูกค้า"><input name="note" className={inputCls} /></Field>
        <Field label="บันทึกภายใน (ลูกค้าไม่เห็น)" className="sm:col-span-2"><textarea name="internal_note" rows={2} className={inputCls} /></Field>
      </fieldset>

      {canConfirm && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm_now" className="mt-1 size-4 accent-[#123c46]" />
          <span>
            <b>ยืนยันการจองทันที</b> — ลูกค้าชำระเงินแล้ว (เงินสด/โอนที่เคาน์เตอร์)
            <span className="block text-xs text-ink/60">ถ้าไม่เลือก ระบบจะกันห้องไว้และตั้งสถานะ “รอชำระเงิน” ตามเวลาที่ตั้งไว้</span>
          </span>
        </label>
      )}
    </ActionForm>
  );
}
