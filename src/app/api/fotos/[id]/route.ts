import { getContext } from "@/server/auth/context";
import { objectResponse } from "@/server/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const [p] = await ctx.db((tx) => tx<{ storage_path: string }[]>`select storage_path from public.vehicle_photos where id = ${id}`);
  if (!p) return new Response("No encontrado", { status: 404 });
  const ext = p.storage_path.split(".").pop();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return objectResponse("vehicle-photos", p.storage_path, mime, `foto.${ext}`);
}
