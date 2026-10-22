import { currentClaims } from "@/server/session";
import { withUser } from "@/server/db";
import { buildDocModel } from "@/server/documents";
import { renderPdf } from "@/server/pdf";
import { DomainError } from "@/server/errors";

// Descarga autorizada: se valida la sesión, el permiso y el acceso a la entidad
// (get_document en la base) y se verifica la integridad de la instantánea.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const claims = await currentClaims();
  if (!claims) return new Response("No autenticado", { status: 401 });
  try {
    const doc = await withUser(claims, (db) => db.rpc<Record<string, unknown>>("get_document", { p_document: id }));
    const model = buildDocModel(doc);
    if (!model.integrityOk) return new Response("La instantánea del documento no supera la verificación de integridad.", { status: 409 });
    const bytes = await renderPdf(model);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${model.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const code = e instanceof DomainError ? e.code : "INTERNAL";
    const status = code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 500;
    return new Response(e instanceof Error ? e.message : "Error", { status });
  }
}
