import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, Empty, PageHeader, Table } from "@/components/admin/ui";
import { formatThaiDateTime } from "@/lib/dates";
import { listRooms, roomHistory } from "@/server/catalog";
import { requireStaff } from "@/server/context";

export default async function RoomUnitPage({ params }: PageProps<"/admin/rooms/units/[id]">) {
  const { tenant, propertyId } = await requireStaff("catalog.view");
  const { id } = await params;
  const room = (await listRooms(tenant.id, propertyId)).find((r) => r.id === id);
  if (!room) notFound();
  const h = await roomHistory(tenant.id, id);
  return (
    <>
      <Link href={`/admin/rooms/${room.room_type_id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"><ArrowLeft className="size-4" /> {room.type_name}</Link>
      <PageHeader title={`ห้อง ${room.room_number}`} subtitle={`${room.type_name} · ประวัติการเข้าพักและการแก้ไข`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="การเข้าพัก">
          {h.stays.length === 0 ? <Empty title="ยังไม่เคยจัดผู้เข้าพักให้ห้องนี้" /> : (
            <Table head={["การจอง", "ผู้เข้าพัก", "ช่วงวันที่", "สถานะ"]} minWidth={480}>
              {h.stays.map((s, i) => (
                <tr key={i} className={s.active ? "" : "text-ink/40"}>
                  <td className="px-4 py-2"><Link href={`/admin/bookings/${s.code}`} className="text-gold-600 underline">{s.code}</Link></td>
                  <td className="px-4 py-2">{s.guest}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.stay}</td>
                  <td className="px-4 py-2 text-xs">{s.active ? "ใช้งาน" : "ยกเลิกการจัดห้อง"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="การแก้ไข">
          {h.changes.length === 0 ? <Empty title="ยังไม่มีการแก้ไข" /> : (
            <ul className="space-y-2 text-sm">
              {h.changes.map((c, i) => (
                <li key={i} className="border-l-2 border-gold-300 pl-3">
                  <p className="font-medium">{c.action}</p>
                  <p className="text-xs text-ink/60">{formatThaiDateTime(c.created_at.toISOString())} · {c.user_name ?? "ระบบ"} · {JSON.stringify(c.data)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
