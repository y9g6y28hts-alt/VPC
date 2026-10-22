import { notFound } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { getContext, query } from "@/server/context";
import { buildDocModel } from "@/server/documents";
import { PageHeader } from "@/components/ui/Layout";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { PrintButton } from "./PrintButton";
import { BrandMark } from "@/components/ui/Brand";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Documento" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const doc = await query(ctx, (db) => db.rpc<Record<string, unknown>>("get_document", { p_document: id })).catch(() => null);
  if (!doc) notFound();
  const m = buildDocModel(doc);
  return (
    <>
      <div className="no-print">
        <PageHeader crumbs={[["/documents", "Documentos"]]} title={`${m.title} · ${m.number}`}
          subtitle={<>Emitido {dateTime(m.issuedAt)} · plantilla v{String(doc.template_version)} · {m.integrityOk ? <Badge tone="good">Integridad verificada</Badge> : <Badge tone="risk">Integridad NO verificada</Badge>}</>}
          actions={<>
            <a href={`/api/documents/${id}/pdf`} className={buttonClass("primary")}><Download className="size-3.5" />Descargar PDF</a>
            <PrintButton className={buttonClass("secondary")}><Printer className="size-3.5" />Imprimir</PrintButton>
          </>} />
      </div>
      <article className="print-sheet mx-auto max-w-4xl rounded-md border border-line bg-surface p-8">
        <div className="mb-6 border-t-2 border-accent-deep pt-3">
          <div className="flex items-center justify-between"><BrandMark size={36} /><span className="text-[11px] uppercase tracking-[0.24em] text-muted">{m.number}</span></div>
          <h1 className="mt-3 text-xl font-semibold">{m.title}</h1>
          <p className="text-sm text-muted">{m.orgName}</p>
          <p className="text-xs text-faint">{m.orgLine}</p>
          {m.isDemo && <p className="mt-2 text-xs font-medium text-warn">DATOS DE DEMOSTRACIÓN · DOCUMENTO SIN VALIDEZ</p>}
          {m.status !== "issued" && <p className="mt-1 text-xs text-warn">Documento {m.status === "superseded" ? "reemplazado por una emisión posterior" : m.status}</p>}
        </div>
        {m.blocks.map((b, i) => (
          <section key={i} className="mb-5">
            {b.heading && <h2 className="mb-2 border-b border-line pb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">{b.heading}</h2>}
            {b.type === "kv" && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {b.pairs.map(([k, v]) => <div key={k}><dt className="text-[11px] text-muted">{k}</dt><dd className="num font-medium">{v}</dd></div>)}
              </dl>
            )}
            {b.type === "text" && <p className={`text-sm ${b.tone === "warning" ? "text-warn" : b.tone === "muted" ? "text-muted" : ""}`}>{b.text}</p>}
            {b.type === "table" && (
              <div className="overflow-x-auto">
                <table className="mh-table">
                  <thead><tr>{b.columns.map((c) => <th key={c.label} className={c.align === "right" ? "r" : undefined}>{c.label}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci} className={b.columns[ci]?.align === "right" ? "r num" : undefined}>{cell}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        ))}
        <footer className="mt-8 border-t border-line pt-3 text-xs text-muted">
          <p>{m.notice}</p>
          <p className="mt-2 break-all text-[10px] text-faint">Verificación de integridad (SHA-256 de la instantánea): {m.checksum}</p>
        </footer>
      </article>
    </>
  );
}
