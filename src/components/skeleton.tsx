export default function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-cream-200" />
      ))}
    </div>
  );
}
