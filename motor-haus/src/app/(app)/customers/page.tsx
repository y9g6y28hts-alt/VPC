import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { orderBy, SearchParams, SortTh, sp } from "@/components/ui/Table";
import { CUSTOMER_KIND, label } from "@/lib/labels";
import { date } from "@/lib/format";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const q = sp(params, "q")?.trim() ?? "";
  const kind = sp(params, "kind") ?? "";
  const order = orderBy(params, { name: "c.display_name", created: "c.created_at", last: "last_interaction" }, "c.display_name asc");
  const rows = await query(ctx, async (db) => {
    let docMatches: string[] = [];
    if (q && can(ctx, "customer.pii.read") && /\d/.test(q)) {
      docMatches = (await db.rows<{ id: string }>("select id from public.find_customer_by_document($1, $2)", [ctx.org.id, q])).map((r) => r.id);
    }
    return db.rows<{ id: string; display_name: string; kind: string; email: string | null; phone: string | null; city: string | null; status: string; owner: string | null; created_at: string; last_interaction: string | null; contracts: string; open_deals: string }>(
      `select c.id, c.display_name, c.kind, c.email, c.phone, c.city, c.status, c.created_at, p.full_name owner,
              (select max(occurred_at) from public.customer_interactions i where i.customer_id = c.id) last_interaction,
              (select count(*) from public.sales_contracts s where s.customer_id = c.id) contracts,
              (select count(*) from public.deals d where d.customer_id = c.id and d.status in ('draft','pending_approval','approved')) open_deals
         from public.customers c left join public.user_profiles p on p.id = c.owner_user_id
        where c.organization_id = $1 and ($2 = '' or c.kind = $2)
          and ($3 = '' or c.display_name ilike '%' || $3 || '%' or coalesce(c.email, '') ilike '%' || $3 || '%' or coalesce(c.phone, '') ilike '%' || $3 || '%' or c.id = any($4::uuid[]))
        order by ${order} limit 500`, [ctx.org.id, kind, q, docMatches]);
  });
  return (
    <>
      <PageHeader title="Clientes" subtitle="Expediente único por cliente. Los documentos de identidad solo son visibles con permiso y cada consulta queda auditada."
        actions={can(ctx, "customer.write") && <LinkButton href="/customers/new" variant="primary">Nuevo cliente</LinkButton>} />
      <FilterBar base="/customers" filters={[
        { name: "q", label: "Buscar", type: "search", value: q, placeholder: can(ctx, "customer.pii.read") ? "Nombre, correo, teléfono o documento" : "Nombre, correo o teléfono" },
        { name: "kind", label: "Tipo", value: kind, all: "Todos", options: Object.entries(CUSTOMER_KIND) },
      ]} />
      <Panel>
        {rows.length === 0 ? <Empty title="Sin clientes con estos filtros" /> : (
          <table className="mh-table">
            <thead><tr><SortTh label="Cliente" field="name" base="/customers" params={params} defaultDir="asc" /><th>Tipo</th><th>Contacto</th><th>Ciudad</th><th>Ejecutivo</th><th className="r">Contratos</th><th className="r">Negociaciones</th><SortTh label="Última interacción" field="last" base="/customers" params={params} /><th>Estado</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/customers/${c.id}`} className="text-text hover:text-accent">{c.display_name}</Link></td>
                <td className="text-text-2">{label(CUSTOMER_KIND, c.kind)}</td>
                <td className="text-xs text-text-2">{c.email ?? "—"}<div>{c.phone ?? ""}</div></td>
                <td className="text-text-2">{c.city ?? "—"}</td><td className="text-text-2">{c.owner ?? "—"}</td>
                <td className="r num">{c.contracts}</td><td className="r num">{c.open_deals}</td>
                <td className="num text-text-2">{date(c.last_interaction)}</td>
                <td><Badge tone={c.status === "active" ? "good" : c.status === "prospect" ? "info" : "neutral"}>{{ active: "Activo", prospect: "Prospecto", inactive: "Inactivo" }[c.status]}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
