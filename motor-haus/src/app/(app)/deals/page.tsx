import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { orderBy, SearchParams, SortTh, sp } from "@/components/ui/Table";
import { DEAL_STATUS } from "@/lib/labels";
import { date } from "@/lib/format";

export const metadata = { title: "Mesa de negociación" };

export default async function DealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const status = sp(params, "status") ?? "open";
  const q = sp(params, "q")?.trim() ?? "";
  const order = orderBy(params, { number: "d.number", created: "d.created_at", price: "total", customer: "c.display_name" }, "d.created_at desc");
  const rows = await query(ctx, (db) => db.rows<{
    id: string; number: string; status: string; currency: string; created_at: string; customer: string; salesperson: string; units: string;
    total: string; list: string; pending: string; proposal_valid_until: string | null;
  }>(`select d.id, d.number, d.status, d.currency, d.created_at, d.proposal_valid_until, c.display_name customer, p.full_name salesperson,
            string_agg(u.make || ' ' || u.model, ', ') units, sum(i.negotiated_price) total, sum(i.list_price) list,
            (select count(*) from public.approvals a where a.entity_type = 'deal' and a.entity_id = d.id and a.status = 'pending') pending
       from public.deals d join public.customers c on c.id = d.customer_id join public.user_profiles p on p.id = d.salesperson_id
       left join public.deal_items i on i.deal_id = d.id left join public.units u on u.id = i.unit_id
      where d.organization_id = $1
        and ($2 = 'all' or ($2 = 'open' and d.status in ('draft','pending_approval','approved','rejected')) or d.status = $2)
        and ($3 = '' or d.number ilike '%' || $3 || '%' or c.display_name ilike '%' || $3 || '%' or u.model ilike '%' || $3 || '%')
      group by d.id, c.display_name, p.full_name order by ${order} limit 300`, [ctx.org.id, status, q]));
  return (
    <>
      <PageHeader title="Mesa de negociación" subtitle="Operaciones en curso, aprobaciones y formalización"
        actions={can(ctx, "deal.write") && <LinkButton href="/deals/new" variant="primary">Nueva operación</LinkButton>} />
      <FilterBar base="/deals" filters={[
        { name: "q", label: "Buscar", type: "search", value: q, placeholder: "Número, cliente, modelo" },
        { name: "status", label: "Estado", value: status, options: [["open", "En curso"], ["all", "Todas"], ...Object.entries(DEAL_STATUS).map(([k, [l]]) => [k, l] as [string, string])] },
      ]} />
      <Panel>
        {rows.length === 0 ? <Empty title="No hay operaciones con estos filtros" /> : (
          <div className="overflow-x-auto">
            <table className="mh-table">
              <thead><tr>
                <SortTh label="Número" field="number" base="/deals" params={params} />
                <SortTh label="Cliente" field="customer" base="/deals" params={params} defaultDir="asc" />
                <th>Unidades</th><th>Vendedor</th>
                <SortTh label="Negociado" field="price" base="/deals" params={params} right />
                <th className="r">Descuento</th><th>Estado</th><th>Vigencia</th>
                <SortTh label="Creada" field="created" base="/deals" params={params} />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/deals/${r.id}`} className="text-text hover:text-accent">{r.number}</Link></td>
                    <td className="text-text-2">{r.customer}</td>
                    <td className="max-w-64 truncate text-text-2">{r.units}</td>
                    <td className="text-text-2">{r.salesperson}</td>
                    <td className="r"><Money value={r.total} currency={r.currency} /></td>
                    <td className="r"><Pct value={Number(r.list) > 0 ? ((Number(r.list) - Number(r.total)) / Number(r.list)) * 100 : 0} /></td>
                    <td><StatusBadge map={DEAL_STATUS} value={r.status} />{Number(r.pending) > 0 && <span className="ml-1 text-xs text-warn">{r.pending} pend.</span>}</td>
                    <td className="num text-text-2">{date(r.proposal_valid_until)}</td>
                    <td className="num text-text-2">{date(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
