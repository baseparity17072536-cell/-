import { Skeleton } from "./ui";

// Shown instantly while an admin page loads its data (each page folder re-exports this as loading.tsx).
export default function PageLoading() {
  return (
    <div>
      <div className="mb-6 h-8 w-56 animate-pulse rounded bg-white/70" />
      <Skeleton rows={4} />
    </div>
  );
}
