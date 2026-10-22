import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { SearchParams, sp } from "@/components/ui/Table";
import { APPRAISAL_STATUS } from "@/lib/labels";
import { date } from "@/lib/format";

export const metadata = { title: "Tasaciones" };

export default async function AppraisalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const status = sp(params, "status") ?? "";
  const rows = await query(ctx, (db) => db.rows<Record<string, any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
    `select a.id, a.number, a.make, a.model, a.version, a.year_built, a.currency, a.status, a.created_at, a.proposed_acquisition_price,
            a.expected_resale_price, a.max_authorized_price, a.accepted_value, a.uncertainty, c.display_name customer, p.full_name appraiser, d.number deal_number,
            coalesce((select sum(amount) from public.appraisal_costs x where x.appraisal_id = a.id), 0) recon
       from public.trade_in_appraisals a join public.customers c on c.id = a.customer_id left join public.user_profiles p on p.id = a.appraiser_id
       left join public.deals d on d.id = a.deal_id
      where a.organization_id = $1 and ($2 = '' or a.status = $2) order by a.created_at desc limit 300`, [ctx.org.id, status]));
  return (
    <>
      <PageHeader title="Tasaciones" subtitle="Vehículos ofrecidos como parte de pago. Una tasación no crea inventario hasta la adquisición formal."
        actions={can(ctx, "tradein.write") && <LinkButton href="/appraisals/new" variant="primary">Nueva tasación</LinkButton>} />
      <FilterBar base="/appraisals" filters={[{ name: "status", label: "Estado", value: status, all: "Todos", options: Object.entries(APPRAISAL_STATUS).map(([k, [l]]) => [k, l]) }]} />
      <Panel>
        {rows.length === 0 ? <Empty title="Sin tasaciones" /> : (
          <table className="mh-table">
            <thead><tr><th>Tasación</th><th>Unidad</th><th>Cliente</th><th>Tasador</th><th className="r">Propuesto</th><th className="r">Reacond.</th><th className="r">Reventa esp.</th><th className="r">Margen est.</th><th className="r">Máx. autorizado</th><th>Operación</th><th>Estado</th></tr></thead>
            <tbody>{rows.map((a) => {
              const cost = Number(a.proposed_acquisition_price ?? 0) + Number(a.recon);
              const margin = a.expected_resale_price !== null && a.proposed_acquisition_price !== null ? Number(a.expected_resale_price) - cost : null;
              return (
                <tr key={a.id}>
                  <td><Link href={`/appraisals/${a.id}`} className="text-text hover:text-accent">{a.number}</Link><div className="text-xs text-faint">{date(a.created_at)}</div></td>
                  <td className="text-text-2">{a.make} {a.model} {a.version ?? ""} {a.year_built ?? ""}</td>
                  <td className="text-text-2">{a.customer}</td><td className="text-text-2">{a.appraiser}</td>
                  <td className="r"><Money value={a.proposed_acquisition_price} currency={a.currency} /></td>
                  <td className="r"><Money value={a.recon} currency={a.currency} muted /></td>
                  <td className="r"><Money value={a.expected_resale_price} currency={a.currency} /></td>
                  <td className="r">{margin !== null ? <><Money value={margin} currency={a.currency} /><div className="text-xs"><Pct value={Number(a.expected_resale_price) > 0 ? (margin / Number(a.expected_resale_price)) * 100 : null} /></div></> : "—"}</td>
                  <td className="r"><Money value={a.max_authorized_price} currency={a.currency} /></td>
                  <td className="text-text-2">{a.deal_number ?? "—"}</td>
                  <td><StatusBadge map={APPRAISAL_STATUS} value={a.status} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
