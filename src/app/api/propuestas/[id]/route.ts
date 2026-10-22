import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { getContext } from "@/server/auth/context";
import { ProposalDocument, type ProposalSnapshot } from "@/server/pdf/proposal";

export const runtime = "nodejs";

/** PDF de una propuesta. Sólo para usuarios con acceso al registro (RLS). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });
  const [p] = await ctx.db((tx) => tx<{ number: string; valid_until: string; terms: ProposalSnapshot }[]>`
    select number, valid_until, terms from public.proposals where id = ${id}`);
  if (!p) return new Response("No encontrado", { status: 404 });
  const buffer = await renderToBuffer(createElement(ProposalDocument, { number: p.number, validUntil: p.valid_until, data: p.terms }) as never);
  const download = new URL(request.url).searchParams.get("descargar") === "1";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="propuesta-${p.number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
