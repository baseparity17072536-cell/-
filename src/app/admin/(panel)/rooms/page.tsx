import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionForm } from "@/components/admin/action-form";
import { btnGhost, btnGold, Card, Empty, PageHeader, Table } from "@/components/admin/ui";
import { formatSatang } from "@/lib/money";
import { listRooms, listRoomTypes } from "@/server/catalog";
import { requireStaff } from "@/server/context";
import { can } from "@/server/rbac";
import { HK_LABEL, ROOM_STATUS_LABEL } from "@/components/admin/labels";
import { housekeepingAction } from "../../actions";

export default async function RoomsPage() {
  const { tenant, propertyId, session } = await requireStaff("catalog.view");
  const [types, rooms] = await Promise.all([listRoomTypes(tenant.id, propertyId, { includeInactive: true }), listRooms(tenant.id, propertyId)]);
  const owner = session.role === "owner";
  const canHk = can(session.role, "booking.status");

  return (
    <>
      <PageHeader
        title="ห้องพัก"
        subtitle={`${types.length} ประเภทห้อง · ${rooms.filter((r) => r.status === "active").length} ห้องเปิดขาย · ${rooms.filter((r) => r.status === "maintenance").length} ห้องปิดซ่อม`}
        actions={owner && <Link href="/admin/rooms/new" className={btnGold}><Plus className="size-4" /> เพิ่มประเภทห้อง</Link>}
      />
      {types.length === 0 ? (
        <Empty title="ยังไม่มีประเภทห้อง">{owner ? "กด “เพิ่มประเภทห้อง” เพื่อเริ่มต้น" : "ให้เจ้าของเพิ่มประเภทห้องก่อน"}</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((t) => (
            <Link key={t.id} href={`/admin/rooms/${t.id}`} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-cream-200 transition hover:-translate-y-0.5 hover:shadow">
              <div className="relative h-36 bg-ivory">
                {t.cover && <Image src={t.cover} alt={t.name_th} fill sizes="(min-width:1280px) 33vw, (min-width:640px) 50vw, 100vw" className="object-cover" />}
                {!t.is_active && <span className="absolute left-2 top-2 rounded-full bg-gray-800/80 px-2 py-0.5 text-xs text-white">ปิดขาย</span>}
              </div>
              <div className="p-4">
                <p className="font-bold">{t.name_th} <span className="text-xs font-normal text-ink/50">{t.code}</span></p>
                <p className="text-sm text-ink/60">{t.active_rooms} ห้องเปิดขาย / {t.room_count} ห้อง · ผู้ใหญ่ {t.max_adults} · รวม {t.max_occupancy}</p>
                <p className="mt-1 font-semibold tabular-nums">{formatSatang(t.base_price_satang)} <span className="text-xs font-normal text-ink/50">/ คืน (ราคาพื้นฐาน)</span></p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Card title="ห้องจริงทั้งหมด" className="mt-8" actions={<span className="text-xs text-ink/50">แก้ไขห้องได้ในหน้าประเภทห้องแต่ละประเภท</span>}>
        <div id="units" className="scroll-mt-6" />
        {rooms.length === 0 ? <Empty title="ยังไม่มีห้อง" /> : (
          <Table head={["ห้อง", "ประเภท", "อาคาร / ชั้น / โซน", "สถานะห้อง", "แม่บ้าน", ""]} minWidth={760}>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-semibold">{r.room_number}</td>
                <td className="px-4 py-2">{r.type_name}</td>
                <td className="px-4 py-2 text-xs text-ink/70">{[r.building, r.floor && `ชั้น ${r.floor}`, r.zone].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-4 py-2 text-xs">{ROOM_STATUS_LABEL[r.status]}</td>
                <td className="px-4 py-2">
                  {canHk ? (
                    <ActionForm action={housekeepingAction} className="flex items-center gap-2" submitLabel="บันทึก" submitClass={btnGhost} inlineSubmit>
                      <input type="hidden" name="room_id" value={r.id} />
                      <select name="status" defaultValue={r.housekeeping_status} className="rounded border border-cream-200 bg-white px-2 py-1 text-xs" aria-label={`สถานะแม่บ้านห้อง ${r.room_number}`}>
                        {Object.entries(HK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </ActionForm>
                  ) : <span className="text-xs">{HK_LABEL[r.housekeeping_status]}</span>}
                </td>
                <td className="px-4 py-2 text-right"><Link href={`/admin/rooms/units/${r.id}`} className="text-xs text-gold-600 underline">ประวัติ</Link></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
