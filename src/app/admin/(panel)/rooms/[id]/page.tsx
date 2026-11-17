import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Trash2 } from "lucide-react";
import { ActionButton, ActionForm } from "@/components/admin/action-form";
import { HK_LABEL, ROOM_STATUS_LABEL } from "@/components/admin/labels";
import { btnGhost, btnPrimary, Card, Empty, Field, inputCls, PageHeader } from "@/components/admin/ui";
import { getRoomType } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { can, decide } from "@/server/rbac";
import { bulkRoomsAction, imageAction, saveRoomAction, uploadImageAction } from "../../../actions";
import RoomTypeForm from "../room-type-form";

export default async function RoomTypePage({ params, searchParams }: PageProps<"/admin/rooms/[id]">) {
  const { tenant, session } = await requireStaff("catalog.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getRoomType(tenant.id, id);
  if (!t) notFound();
  const sp = await searchParams;
  const edit = can(session.role, "catalog.edit");
  const { images, rooms, ...fields } = t;

  return (
    <>
      <Link href="/admin/rooms" className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"><ArrowLeft className="size-4" /> ห้องพัก</Link>
      <PageHeader title={t.name_th} subtitle={`${t.code} · ${rooms.filter((r) => r.status === "active").length} ห้องเปิดขาย`} />
      {sp.created && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">สร้างประเภทห้องแล้ว เพิ่มรูปและห้องจริงด้านล่างได้เลย</p>}

      <div className="grid gap-6 2xl:grid-cols-[1fr_440px]">
        <Card title="ข้อมูลประเภทห้อง">
          {edit ? <RoomTypeForm t={fields} priceAccess={decide(session.role, "rates.edit")} /> : <p className="text-sm text-ink/60">บทบาทของคุณดูข้อมูลได้อย่างเดียว</p>}
        </Card>

        <div className="space-y-6">
          <Card title={`รูปภาพ (${images.length})`}>
            {images.length === 0 ? <Empty title="ยังไม่มีรูป" /> : (
              <ul className="grid grid-cols-2 gap-3">
                {images.map((img, i) => (
                  <li key={img.id} className="overflow-hidden rounded-lg ring-1 ring-cream-200">
                    <div className="relative aspect-[4/3] bg-ivory">
                      <Image src={img.url} alt={img.alt || t.name_th} fill sizes="220px" className="object-cover" />
                      {i === 0 && <span className="absolute left-1 top-1 rounded bg-teal-deep/85 px-1.5 text-[10px] text-white">รูปหลัก</span>}
                    </div>
                    {edit && (
                      <div className="flex justify-between gap-1 p-1">
                        <ActionButton action={imageAction} fields={{ image_id: img.id, op: "up" }} label={<ArrowUp className="size-3.5" />} className={`${btnGhost} px-2 py-1`} />
                        <ActionButton action={imageAction} fields={{ image_id: img.id, op: "down" }} label={<ArrowDown className="size-3.5" />} className={`${btnGhost} px-2 py-1`} />
                        <ActionButton action={imageAction} fields={{ image_id: img.id, op: "delete" }} label={<Trash2 className="size-3.5" />} className={`${btnGhost} px-2 py-1 text-red-700`} confirm="ลบรูปนี้?" />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {edit && (
              <ActionForm action={uploadImageAction} submitLabel="อัปโหลด" submitClass={btnPrimary} className="mt-4 space-y-3" resetOnSuccess>
                <input type="hidden" name="room_type_id" value={t.id} />
                <Field label="เพิ่มรูป (JPG/PNG/WebP ไม่เกิน 5 MB, สูงสุด 10 รูป)">
                  <input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple required className={inputCls} />
                </Field>
                <Field label="คำอธิบายรูป (alt)"><input name="alt" className={inputCls} placeholder={t.name_th} /></Field>
              </ActionForm>
            )}
            {t.video_url && <p className="mt-3 text-sm">วิดีโอ: <a href={t.video_url} target="_blank" rel="noopener noreferrer" className="text-gold-600 underline">{t.video_url}</a></p>}
          </Card>

          <Card title={`ห้องจริง (${rooms.length})`}>
            {rooms.length === 0 ? <Empty title="ยังไม่มีห้องจริง">เพิ่มห้องด้านล่าง ห้องที่ “เปิดขาย” จะถูกนับเป็นจำนวนห้องที่ขายได้</Empty> : (
              <ul className="divide-y divide-cream-200">
                {rooms.map((r) => (
                  <li key={r.id} className="py-3">
                    {edit ? (
                      <ActionForm action={saveRoomAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6" submitLabel="บันทึก" submitClass={`${btnGhost} sm:col-span-1`} inlineSubmit>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="room_type_id" value={t.id} />
                        <Field label="เลขห้อง"><input name="room_number" defaultValue={r.room_number} required className={inputCls} /></Field>
                        <Field label="อาคาร"><input name="building" defaultValue={r.building ?? ""} className={inputCls} /></Field>
                        <Field label="ชั้น"><input name="floor" defaultValue={r.floor ?? ""} className={inputCls} /></Field>
                        <Field label="โซน"><input name="zone" defaultValue={r.zone ?? ""} className={inputCls} /></Field>
                        <Field label="สถานะ">
                          <select name="status" defaultValue={r.status} className={inputCls}>
                            {Object.entries(ROOM_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </Field>
                        <input type="hidden" name="note" value={r.note ?? ""} />
                      </ActionForm>
                    ) : (
                      <p className="text-sm"><b>{r.room_number}</b> · {ROOM_STATUS_LABEL[r.status]} · {HK_LABEL[r.housekeeping_status]}</p>
                    )}
                    <Link href={`/admin/rooms/units/${r.id}`} className="mt-1 inline-block text-xs text-gold-600 underline">ประวัติห้อง {r.room_number}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {edit && (
            <Card title="เพิ่มห้อง">
              <ActionForm action={saveRoomAction} className="grid grid-cols-2 gap-3" submitLabel="เพิ่ม 1 ห้อง" submitClass={btnGhost} resetOnSuccess>
                <input type="hidden" name="room_type_id" value={t.id} />
                <input type="hidden" name="status" value="active" />
                <Field label="เลขห้อง"><input name="room_number" required className={inputCls} /></Field>
                <Field label="อาคาร"><input name="building" className={inputCls} /></Field>
                <Field label="ชั้น"><input name="floor" className={inputCls} /></Field>
                <Field label="โซน"><input name="zone" className={inputCls} /></Field>
              </ActionForm>
              <hr className="my-5 border-cream-200" />
              <h3 className="mb-2 text-sm font-semibold">เพิ่มหลายห้องพร้อมกัน</h3>
              <ActionForm action={bulkRoomsAction} className="grid grid-cols-2 gap-3" submitLabel="สร้างห้อง" submitClass={btnPrimary} resetOnSuccess>
                <input type="hidden" name="room_type_id" value={t.id} />
                <Field label="หมายเลขเริ่มต้น" hint="เช่น A101, 101, V01, ROOM001"><input name="start" required className={inputCls} /></Field>
                <Field label="จำนวนห้อง"><input name="count" type="number" min={1} max={200} required defaultValue={5} className={inputCls} /></Field>
                <Field label="อาคาร"><input name="building" className={inputCls} /></Field>
                <Field label="ชั้น"><input name="floor" className={inputCls} /></Field>
                <Field label="โซน" className="col-span-2"><input name="zone" className={inputCls} /></Field>
              </ActionForm>
              <p className="mt-2 text-xs text-ink/60">ระบบตรวจเลขห้องซ้ำก่อนบันทึก ถ้ามีเลขซ้ำจะไม่สร้างห้องใดเลย</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
