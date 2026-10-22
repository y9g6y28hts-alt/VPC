import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Tabs } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { SearchParams, sp } from "@/components/ui/Table";
import { ACCOUNT_STATUS } from "@/lib/labels";
import { date, dateTime, money } from "@/lib/format";

export const metadata = { title: "Contratos y reservas" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const tab = sp(params, "tab") === "reservations" ? "reservations" : "contracts";
  const q = sp(params, "q")?.trim() ?? "";
  const d = await query(ctx, async (db) => ({
    contracts: tab === "contracts" ? await db.rows<R>(
      `select c.id, c.number, c.contract_date, c.currency, c.total_price, c.upfront_total, c.financed_principal, c.status,
              cu.display_name customer, p.full_name salesperson, cb.outstanding, cb.overdue_amount, cb.account_status,
              (select string_agg(u.make || ' ' || u.model, ', ') from public.deal_items di join public.units u on u.id = di.unit_id where di.deal_id = c.deal_id) units,
              (select bool_and(u.commercial_status = 'delivered') from public.deal_items di join public.units u on u.id = di.unit_id where di.deal_id = c.deal_id) delivered
         from public.sales_contracts c join public.customers cu on cu.id = c.customer_id join public.user_profiles p on p.id = c.salesperson_id
         left join public.contract_balances cb on cb.contract_id = c.id
        where c.organization_id = $1 and ($2 = '' or c.number ilike '%' || $2 || '%' or cu.display_name ilike '%' || $2 || '%')
        order by c.contract_date desc, c.number desc`, [ctx.org.id, q]) : [],
    reservations: tab === "reservations" ? await db.rows<R>(
      `select r.*, u.stock_number, u.make, u.model, cu.display_name customer, p.full_name responsible
         from public.reservations r join public.units u on u.id = r.unit_id join public.customers cu on cu.id = r.customer_id
         join public.user_profiles p on p.id = r.responsible_user_id
        where r.organization_id = $1 and ($2 = '' or cu.display_name ilike '%' || $2 || '%' or u.model ilike '%' || $2 || '%')
        order by r.status = 'active' desc, r.expires_at`, [ctx.org.id, q]) : [],
  }));
  return (
    <>
      <PageHeader title="Contratos y reservas" subtitle="Operaciones formalizadas con sus obligaciones, y reservas con vencimiento" />
      <Tabs current={tab} tabs={[{ key: "contracts", label: "Contratos", href: "/contracts" }, { key: "reservations", label: "Reservas", href: "/contracts?tab=reservations" }]} />
      <FilterBar base="/contracts" hidden={tab === "reservations" ? { tab } : {}} filters={[{ name: "q", label: "Buscar", type: "search", value: q, placeholder: "Número, cliente, unidad" }]} />
      <Panel>
        {tab === "contracts" ? (d.contracts.length === 0 ? <Empty title="Sin contratos" /> : (
          <div className="overflow-x-auto"><table className="mh-table">
            <thead><tr><th>Contrato</th><th>Fecha</th><th>Cliente</th><th>Unidades</th><th>Vendedor</th><th className="r">Precio</th><th className="r">Entregas</th><th className="r">Financiado</th><th className="r">Pendiente</th><th>Cuenta</th><th>Entrega</th></tr></thead>
            <tbody>{d.contracts.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/contracts/${c.id}`} className="text-text hover:text-accent">{c.number}</Link></td>
                <td className="num text-text-2">{date(c.contract_date)}</td>
                <td className="text-text-2">{c.customer}</td>
                <td className="max-w-56 truncate text-text-2">{c.units}</td>
                <td className="text-text-2">{c.salesperson}</td>
                <td className="r"><Money value={c.total_price} currency={c.currency} /></td>
                <td className="r"><Money value={c.upfront_total} currency={c.currency} muted /></td>
                <td className="r"><Money value={c.financed_principal} currency={c.currency} muted /></td>
                <td className="r">{c.outstanding !== null && can(ctx, "receivable.read", "receivable.read_own") ? <Money value={c.outstanding} currency={c.currency} /> : "—"}</td>
                <td>{c.account_status ? <StatusBadge map={ACCOUNT_STATUS} value={c.account_status} /> : "—"}</td>
                <td>{c.delivered ? <Badge tone="neutral">Entregado</Badge> : <Badge tone="accent">Pendiente</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )) : (d.reservations.length === 0 ? <Empty title="Sin reservas" /> : (
          <div className="overflow-x-auto"><table className="mh-table">
            <thead><tr><th>Unidad</th><th>Cliente</th><th>Responsable</th><th>Creada</th><th>Vence</th><th className="r">Seña</th><th>Condiciones</th><th>Estado</th></tr></thead>
            <tbody>{d.reservations.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/inventory/${r.unit_id}`} className="text-text hover:text-accent">{r.stock_number}</Link><div className="text-xs text-muted">{r.make} {r.model}</div></td>
                <td className="text-text-2">{r.customer}</td><td className="text-text-2">{r.responsible}</td>
                <td className="num text-text-2">{dateTime(r.created_at)}</td><td className="num text-text-2">{dateTime(r.expires_at)}</td>
                <td className="r">{Number(r.deposit_amount) ? money(r.deposit_amount, r.deposit_currency) : "—"}</td>
                <td className="max-w-64 truncate text-xs text-text-2" title={r.conditions}>{r.conditions}</td>
                <td><Badge tone={r.status === "active" ? "accent" : r.status === "converted" ? "good" : "neutral"}>{{ active: "Activa", released: "Liberada", expired: "Vencida", converted: "Convertida en venta" }[r.status as string]}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </Panel>
    </>
  );
}
