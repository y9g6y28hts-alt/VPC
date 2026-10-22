import { getContext } from "@/server/auth/context";
import { objectResponse } from "@/server/storage";

/** Descarga de documentos: sólo si RLS permite ver el registro. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const [doc] = await ctx.db((tx) => tx<{ storage_bucket: string; storage_path: string; mime_type: string; title: string }[]>`
    select storage_bucket, storage_path, mime_type, title from public.documents where id = ${id}`);
  if (!doc) return new Response("No encontrado", { status: 404 });
  const download = new URL(request.url).searchParams.get("descargar") === "1";
  return objectResponse(doc.storage_bucket as "documents", doc.storage_path, doc.mime_type, doc.title, !download);
}
