import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FilterForm, SearchInput } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDate, formatMoneyCompact, formatNumber } from "@/lib/format";
import { INVOICE_CATEGORY, INVOICE_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getSettings, latestRate } from "@/server/queries/common";

export const metadata: Metadata = { title: "Compras y proveedores" };

const VIEWS = { pendientes: "Por pagar", vencidas: "Vencidas", proximas: "Por vencer", aprobacion: "Por aprobar", todas: "Todas" } as const;

export default async function PayablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("payables.view", "suppliers.view");
  const sp = await searchParams;
  const view = (param(sp, "vista") ?? "pendientes") as keyof typeof VIEWS;
  const settings = await getSettings(ctx);
  const q = param(sp, "q");
  const rows = ctx.perms.has("payables.view") ? await ctx.db((tx) => tx<{
    id: string; supplier: string; supplier_id: string; invoice_number: string; issue_date: string; due_date: string; currency: string; amount: string;
    concept: string; category: string; status: string; paid_confirmed: string; paid_registered_pending: string; paid_reconciled: string; outstanding: string;
    days_overdue: number; days_left: number; vehicle: string | null; vehicle_id: string | null;
  }[]>`
    select ib.*, s.name as supplier, ib.due_date - app.org_today(ib.org_id) as days_left,
           case when v.id is not null then v.stock_code || ' · ' || app.vehicle_name(b.name, v.model) end as vehicle
    from public.v_supplier_invoice_balances ib join public.suppliers s on s.id = ib.supplier_id
    left join public.vehicles v on v.id = ib.vehicle_id left join public.brands b on b.id = v.brand_id
    where ib.org_id = ${ctx.org.id}
      ${view === "pendientes" ? tx`and ib.status = 'aprobada' and ib.outstanding > 0`
        : view === "vencidas" ? tx`and ib.status = 'aprobada' and ib.outstanding > 0 and ib.days_overdue > 0`
        : view === "proximas" ? tx`and ib.status = 'aprobada' and ib.outstanding > 0 and ib.due_date between app.org_today(ib.org_id) and app.org_today(ib.org_id) + ${settings.payables_due_soon_days}::int`
        : view === "aprobacion" ? tx`and ib.status = 'pendiente_aprobacion'` : tx``}
      ${q ? tx`and (s.name ilike ${"%" + q + "%"} or ib.invoice_number ilike ${"%" + q + "%"} or ib.concept ilike ${"%" + q + "%"})` : tx``}
    order by ib.due_date limit 500`) : [];
  const [totals] = ctx.perms.has("payables.view") ? await ctx.db((tx) => tx<{ currency: string; outstanding: string; overdue: string; soon: string; registered: string }[]>`
    select ib.currency, sum(ib.outstanding) as outstanding, sum(ib.outstanding) filter (where ib.days_overdue > 0) as overdue,
           sum(ib.outstanding) filter (where ib.due_date between app.org_today(ib.org_id) and app.org_today(ib.org_id) + ${settings.payables_due_soon_days}::int) as soon,
           sum(ib.paid_registered_pending) as registered
    from public.v_supplier_invoice_balances ib where ib.org_id = ${ctx.org.id} and ib.status = 'aprobada'
    group by ib.currency`).then((r) => [r]) : [[]];
  const base = ctx.org.baseCurrency;
  const usd = await latestRate(ctx, "USD", base);
  const sum = (k: "outstanding" | "overdue" | "soon" | "registered") => (totals ?? []).reduce((a, t) => a + Number(t[k] ?? 0) * (t.currency === base ? 1 : usd?.rate ?? 0), 0);

  return (
    <>
      <PageHeader title="Compras y proveedores" description="Facturas de vehículos, transporte, reparaciones, documentación y gastos generales. Pagos registrados, confirmados y conciliados se distinguen."
        actions={ctx.perms.has("payables.create") ? <ButtonLink href="/compras/facturas/nueva" variant="primary"><Plus aria-hidden /> Registrar factura</ButtonLink> : null} />
      <Tabs active="facturas" items={[{ key: "facturas", label: "Facturas", href: "/compras" }, { key: "proveedores", label: "Proveedores", href: "/compras/proveedores" }]} />
      {ctx.perms.has("payables.view") ? (
        <>
          <StatGrid className="mb-6 xl:grid-cols-4">
            <Stat id="ap-out" label="Cuentas por pagar" value={formatMoneyCompact(sum("outstanding"), base)} definition={{ formula: "Σ (importe − pagos confirmados) de facturas aprobadas. USD al último tipo de cambio.", source: "Facturas y pagos a proveedores." }} />
            <Stat id="ap-over" label="Vencido" value={formatMoneyCompact(sum("overdue"), base)} tone={sum("overdue") > 0 ? "critical" : "neutral"} href="/compras?vista=vencidas" definition={{ formula: "Saldo de facturas aprobadas con vencimiento anterior a hoy.", source: "Facturas." }} />
            <Stat id="ap-soon" label={`Vence en ${settings.payables_due_soon_days} días`} value={formatMoneyCompact(sum("soon"), base)} tone={sum("soon") > 0 ? "warning" : "neutral"} href="/compras?vista=proximas" definition={{ formula: "Saldo de facturas aprobadas que vencen entre hoy y el plazo configurado.", source: "Facturas." }} />
            <Stat id="ap-reg" label="Pagos sin confirmar" value={formatMoneyCompact(sum("registered"), base)} definition={{ formula: "Pagos a proveedores registrados que aún no se confirmaron contra la cuenta (no generaron egreso de caja).", source: "Pagos a proveedores." }} />
          </StatGrid>
          <Tabs active={view} items={Object.entries(VIEWS).map(([k, v]) => ({ key: k, label: v, href: `/compras?vista=${k}` }))} />
          <FilterForm keep={[["vista", param(sp, "vista")]]}>
            <SearchInput defaultValue={q} placeholder="Proveedor, factura o concepto" />
          </FilterForm>
          {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin facturas en esta vista" /></div> : (
            <TableWrap>
              <Table>
                <THead><Th>Proveedor</Th><Th>Factura</Th><Th className="hidden lg:table-cell">Concepto</Th><Th>Vence</Th><Th numeric>Importe</Th><Th numeric>Pagado conf.</Th><Th numeric className="hidden xl:table-cell">Registrado s/conf.</Th><Th numeric>Saldo</Th><Th>Estado</Th></THead>
                <tbody>
                  {rows.map((i) => (
                    <Tr key={i.id}>
                      <Td className="text-ink">{i.supplier}</Td>
                      <Td><Link href={`/compras/facturas/${i.id}`} className="num text-ink hover:underline">{i.invoice_number}</Link><span className="block text-[11.5px] text-faint">{INVOICE_CATEGORY[i.category]}</span></Td>
                      <Td className="hidden max-w-64 lg:table-cell" muted><span className="block truncate">{i.concept}</span>{i.vehicle ? <span className="block truncate text-[11.5px]">{i.vehicle}</span> : null}</Td>
                      <Td className="num whitespace-nowrap">{formatDate(i.due_date)}
                        {i.status === "aprobada" && Number(i.outstanding) > 0 ? (i.days_overdue > 0 ? <span className="block text-[11.5px] text-critical">Vencida hace {i.days_overdue} d</span> : i.days_left <= settings.payables_due_soon_days ? <span className="block text-[11.5px] text-warning">En {i.days_left} d</span> : null) : null}
                      </Td>
                      <Td numeric><Money value={i.amount} currency={i.currency} /></Td>
                      <Td numeric><Money value={i.paid_confirmed} currency={i.currency} tone="muted" /></Td>
                      <Td numeric className="hidden xl:table-cell">{Number(i.paid_registered_pending) ? <Money value={i.paid_registered_pending} currency={i.currency} /> : <span className="text-faint">—</span>}</Td>
                      <Td numeric><Money value={i.outstanding} currency={i.currency} tone={i.days_overdue > 0 ? "critical" : undefined} /></Td>
                      <Td>{i.status === "aprobada" && Number(i.outstanding) === 0 ? <StatusPill tone="positive">Pagada</StatusPill> : <CatalogPill catalog={INVOICE_STATUS} value={i.status} />}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
          <p className="mt-3 text-[12px] text-faint">{formatNumber(rows.length)} factura(s).</p>
        </>
      ) : <EmptyState title="Su rol sólo consulta proveedores" action={<ButtonLink href="/compras/proveedores">Ver proveedores</ButtonLink>} />}
    </>
  );
}
