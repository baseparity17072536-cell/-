import { getTenant } from "@/server/context";
import { readStoredFile } from "@/server/storage";

// Serves uploaded room images. A file is only served on its own hotel's domain.
export async function GET(_req: Request, ctx: RouteContext<"/media/[tenant]/[file]">) {
  const { tenant, file } = await ctx.params;
  const current = await getTenant();
  if (current.id !== tenant) return new Response("Not found", { status: 404 });
  const f = await readStoredFile(tenant, file);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.body), {
    headers: {
      "Content-Type": f.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
