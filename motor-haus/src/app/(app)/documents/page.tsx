import Link from "next/link";
import { getContext, query } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge } from "@/components/ui/Badge";
import { SearchParams, sp } from "@/components/ui/Table";
import { DOC_KIND, label } from "@/lib/labels";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Documentos" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const kind = sp(params, "kind") ?? "";
  const rows = await query(ctx, (db) => db.rows<{ id: string; number: string; kind: string; status: string; issued_at: string; template_version: number; issuer: string; entity_type: string; entity_id: string }>(
    `select d.id, d.number, d.kind, d.status, d.issued_at, d.template_version, d.entity_type, d.entity_id, p.full_name issuer
       from public.documents d left join public.user_profiles p on p.id = d.issued_by
      where d.organization_id = $1 and ($2 = '' or d.kind = $2) order by d.issued_at desc limit 300`, [ctx.org.id, kind]));
  const entityHref = (t: string, id: string) => ({ deal: `/deals/${id}`, contract: `/contracts/${id}`, trade_in_appraisal: `/appraisals/${id}`, unit: `/inventory`, customer: `/customers/${id}` } as Record<string, string>)[t];
  return (
    <>
      <PageHeader title="Documentos emitidos" subtitle="Generados desde plantillas versionadas con instantánea de datos y verificación de integridad. Un PDF no implica validez jurídica ni firma electrónica." />
      <FilterBar base="/documents" filters={[{ name: "kind", label: "Tipo", value: kind, all: "Todos", options: Object.entries(DOC_KIND) }]} />
      <Panel>
        {rows.length === 0 ? <Empty title="Sin documentos visibles" /> : (
          <table className="mh-table">
            <thead><tr><th>Número</th><th>Tipo</th><th>Entidad</th><th>Plantilla</th><th>Emitido</th><th>Por</th><th>Estado</th><th></th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/documents/${d.id}`} className="text-text hover:text-accent">{d.number}</Link></td>
                <td className="text-text-2">{label(DOC_KIND, d.kind)}</td>
                <td>{entityHref(d.entity_type, d.entity_id) ? <Link href={entityHref(d.entity_type, d.entity_id)} className="text-xs text-muted hover:text-text">Ver origen →</Link> : "—"}</td>
                <td className="text-text-2">v{d.template_version}</td>
                <td className="num text-text-2">{dateTime(d.issued_at)}</td>
                <td className="text-text-2">{d.issuer}</td>
                <td><Badge tone={d.status === "issued" ? "good" : "neutral"}>{d.status === "issued" ? "Vigente" : d.status === "superseded" ? "Reemplazado" : "Anulado"}</Badge></td>
                <td><a href={`/api/documents/${d.id}/pdf`} className="text-xs text-accent">PDF</a></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
