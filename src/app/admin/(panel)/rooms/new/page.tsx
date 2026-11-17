import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, NoAccess, PageHeader } from "@/components/admin/ui";
import { requireStaff } from "@/server/context";
import { decide } from "@/server/rbac";
import RoomTypeForm from "../room-type-form";

export default async function NewRoomTypePage() {
  const { session } = await requireStaff("catalog.edit");
  if (decide(session.role, "rates.edit") !== "allow") return <NoAccess what="การสร้างประเภทห้องใหม่ (ทำได้เฉพาะเจ้าของ)" />;
  return (
    <>
      <Link href="/admin/rooms" className="mb-3 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"><ArrowLeft className="size-4" /> ห้องพัก</Link>
      <PageHeader title="เพิ่มประเภทห้อง" subtitle="หลังบันทึกแล้ว จะเพิ่มรูปภาพและห้องจริงได้ในหน้าถัดไป" />
      <Card><RoomTypeForm priceAccess="allow" /></Card>
    </>
  );
}
