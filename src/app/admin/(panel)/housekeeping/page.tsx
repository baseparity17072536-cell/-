import Link from "next/link";
import { ActionButton } from "@/components/admin/action-form";
import { HK_LABEL } from "@/components/admin/labels";
import { btnGhost, btnPrimary, Empty, NoAccess, PageHeader, Stat } from "@/components/admin/ui";
import { formatThaiDate } from "@/lib/dates";
import { requireStaff } from "@/server/context";
import { cleaningPriority, getHousekeepingBoard, type BoardRoom } from "@/server/operations";
import { can } from "@/server/rbac";
import { housekeepingAction } from "../../actions";

const FILTERS = {
  all: "ทั้งหมด",
  dirty: "รอทำความสะอาด",
  ready: "ว่าง พร้อมขาย",
  occupied: "มีผู้เข้าพัก",
  blocked: "ปิดซ่อม / งดใช้",
} as const;
type Filter = keyof typeof FILTERS;

const HK_TONE: Record<BoardRoom["housekeeping_status"], string> = {
  dirty: "bg-orange-100 text-orange-800 ring-orange-200",
  clean: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  inspected: "bg-teal-50 text-teal-800 ring-teal-200",
  out_of_service: "bg-gray-100 text-gray-600 ring-gray-200",
};

const btnSm = "!px-2.5 !py-1.5 text-xs";

function matches(r: BoardRoom, f: Filter) {
  const blocked = r.status !== "active" || r.housekeeping_status === "out_of_service";
  switch (f) {
    case "dirty": return !blocked && r.housekeeping_status === "dirty";
    case "ready": return !blocked && !r.stay_code && r.housekeeping_status !== "dirty";
    case "occupied": return !!r.stay_code;
    case "blocked": return blocked;
    default: return true;
  }
}

export default async function HousekeepingPage({ searchParams }: PageProps<"/admin/housekeeping">) {
  const { tenant, propertyId, session } = await requireStaff("booking.view");
  if (!can(session.role, "housekeeping.update")) return <NoAccess what="หน้าแม่บ้าน" />;
  const sp = await searchParams;
  const f: Filter = typeof sp.f === "string" && sp.f in FILTERS ? (sp.f as Filter) : "all";
  const { today, rooms } = await getHousekeepingBoard(tenant.id, propertyId);
  const count = (x: Filter) => rooms.filter((r) => matches(r, x)).length;
  const urgent = rooms.filter((r) => cleaningPriority(r) === 3).length;
  const shown = rooms.filter((r) => matches(r, f)).sort((a, b) => (f === "dirty" ? cleaningPriority(b) - cleaningPriority(a) : 0));

  return (
    <>
      <PageHeader title="แม่บ้าน" subtitle={`สถานะห้องวันนี้ ${formatThaiDate(today, { weekday: "long" })}`} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="รอทำความสะอาด" value={count("dirty")} tone={count("dirty") ? "warn" : "ok"} href="?f=dirty" />
        <Stat label="ต้องทำก่อน" value={urgent} hint="ห้องสกปรกที่มีแขกเข้าวันนี้" tone={urgent ? "warn" : "ok"} href="?f=dirty" />
        <Stat label="ว่าง พร้อมขาย" value={count("ready")} href="?f=ready" />
        <Stat label="ปิดซ่อม / งดใช้" value={count("blocked")} href="?f=blocked" />
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="กรองห้อง">
        {(Object.keys(FILTERS) as Filter[]).map((k) => (
          <Link key={k} href={k === "all" ? "/admin/housekeeping" : `?f=${k}`} aria-current={f === k ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm ring-1 ${f === k ? "bg-teal-deep font-semibold text-white ring-teal-deep" : "bg-white text-ink/70 ring-cream-200 hover:bg-cream"}`}>
            {FILTERS[k]} <span className="tabular-nums opacity-70">{count(k)}</span>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <div className="mt-4"><Empty title="ไม่มีห้องในหมวดนี้" /></div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((r) => <RoomCard key={r.id} r={r} today={today} />)}
        </ul>
      )}
    </>
  );
}

function RoomCard({ r, today }: { r: BoardRoom; today: string }) {
  const prio = cleaningPriority(r);
  const where = [r.building, r.floor && `ชั้น ${r.floor}`].filter(Boolean).join(" · ");
  return (
    <li className={`flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm ring-1 ${prio === 3 ? "ring-2 ring-orange-400" : "ring-cream-200"}`} aria-label={`ห้อง ${r.room_number}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xl font-bold tabular-nums">{r.room_number}</p>
          <p className="truncate text-xs text-ink/60">{r.type_name}{where && ` · ${where}`}</p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${HK_TONE[r.housekeeping_status]}`}>
          {HK_LABEL[r.housekeeping_status]}
        </span>
      </div>

      <div className="space-y-0.5 text-sm">
        {r.status === "maintenance" && <p className="font-semibold text-red-700">ปิดซ่อม (งดขาย)</p>}
        {r.stay_code ? (
          <p>
            <Link href={`/admin/bookings/${r.stay_code}`} className="font-medium hover:underline">{r.stay_guest}</Link>
            <span className="text-ink/60">{r.stay_out && r.stay_out <= today ? " · ออกวันนี้" : r.stay_out ? ` · ออก ${formatThaiDate(r.stay_out, { day: "numeric", month: "short", year: undefined })}` : ""}</span>
          </p>
        ) : r.status === "active" && <p className="text-ink/60">ห้องว่าง</p>}
        {r.arrival_code && (
          <p className={prio === 3 ? "font-semibold text-orange-700" : "text-ink/70"}>
            แขกเข้าวันนี้: <Link href={`/admin/bookings/${r.arrival_code}`} className="hover:underline">{r.arrival_guest}</Link>
            {prio === 3 && " — ทำก่อน"}
          </p>
        )}
        {r.open_tickets > 0 && <Link href="/admin/maintenance" className="block text-xs font-medium text-red-700 hover:underline">แจ้งซ่อมค้าง {r.open_tickets} งาน</Link>}
      </div>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {r.housekeeping_status === "dirty" && (
          <ActionButton action={housekeepingAction} fields={{ room_id: r.id, status: "clean" }} label="ทำความสะอาดเสร็จ" className={`${btnPrimary} ${btnSm}`} />
        )}
        {r.housekeeping_status === "clean" && (
          <ActionButton action={housekeepingAction} fields={{ room_id: r.id, status: "inspected" }} label="ตรวจแล้ว" className={`${btnGhost} ${btnSm}`} />
        )}
        {r.housekeeping_status !== "dirty" && (
          <ActionButton action={housekeepingAction} fields={{ room_id: r.id, status: "dirty" }} label="รอทำความสะอาด" className={`${btnGhost} ${btnSm}`} />
        )}
        <Link href={`/admin/maintenance?room=${r.id}#new`} className={`${btnGhost} ${btnSm}`}>แจ้งซ่อม</Link>
      </div>
    </li>
  );
}
