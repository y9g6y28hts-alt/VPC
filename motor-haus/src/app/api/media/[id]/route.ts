import { currentClaims } from "@/server/session";
import { withUser } from "@/server/db";
import { getObject } from "@/server/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Entrega autorizada: RLS de unit_media (inventory.read) decide si el usuario puede ver la imagen.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const claims = await currentClaims();
  if (!claims) return new Response("No autenticado", { status: 401 });
  const row = await withUser(claims, (db) => db.maybe<{ storage_path: string }>("select storage_path from public.unit_media where id = $1", [id])).catch(() => null);
  if (!row) return new Response("No encontrado", { status: 404 });
  try {
    const data = await getObject(row.storage_path);
    return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[row.storage_path.split(".").pop()!] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Archivo no disponible", { status: 404 });
  }
}
