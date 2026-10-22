import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, CircleAlert, Info } from "lucide-react";
import { ChartCard, Columns, HBars, Line } from "@/components/charts/charts";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState, Notice } from "@/components/ui/states";
import { cn } from "@/components/ui/cn";
import { addMonths, endOfMonth, startOfMonth } from "@/domain/dates";
import { formatDate, formatMoneyCompact, formatMonth, formatMonthShort, formatNumber, formatPercent } from "@/lib/format";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getSettings, getToday, listBrands, listMembers } from "@/server/queries/common";
import { overdueHistory } from "@/server/queries/collections";
import { attentionItems, dashboardKpis, inventoryAging, inventoryByBrand, marginByDeal, monthlySeries, type AttentionItem } from "@/server/queries/dashboard";

export const metadata: Metadata = { title: "Dirección" };

const PERIODS = {
  mes: "Mes actual",
  mes_anterior: "Mes anterior",
  "3m": "Últimos 3 meses",
  "6m": "Últimos 6 meses",
  "12m": "Últimos 12 meses",
  anio: "Año en curso",
} as const;

function periodRange(key: keyof typeof PERIODS, today: string): { from: string; to: string } {
  const som = startOfMonth(today);
  switch (key) {
    case "mes": return { from: som, to: today };
    case "mes_anterior": { const p = addMonths(som, -1); return { from: p, to: endOfMonth(p) }; }
    case "3m": return { from: addMonths(som, -2), to: today };
    case "6m": return { from: addMonths(som, -5), to: today };
    case "12m": return { from: addMonths(som, -11), to: today };
    case "anio": return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("dashboard.view");
  const sp = await searchParams;
  const [today, settings] = await Promise.all([getToday(ctx), getSettings(ctx)]);
  const periodKey = (param(sp, "periodo") ?? "mes") as keyof typeof PERIODS;
  const pk = periodKey in PERIODS ? periodKey : "mes";
  const range = periodRange(pk, today);
  const filters = { ...range, brand: param(sp, "marca"), seller: param(sp, "vendedor") };
  const base = ctx.org.baseCurrency;
  const p = ctx.perms;
  const canCosts = p.has("inventory.costs.view");
  const canReceivables = p.any("contracts.view", "collections.view");
  const canPayments = p.has("payments.view");
  const canPayables = p.has("payables.view");

  const [k, series, byBrand, aging, margins, attention, brands, sellers, history] = await Promise.all([
    dashboardKpis(ctx, filters),
    monthlySeries(ctx, filters),
    p.has("inventory.view") ? inventoryByBrand(ctx) : Promise.resolve([]),
    p.has("inventory.view") ? inventoryAging(ctx, filters.brand) : Promise.resolve([]),
    canCosts ? marginByDeal(ctx, filters) : Promise.resolve([]),
    attentionItems(ctx, settings),
    listBrands(ctx),
    listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]),
    canReceivables ? overdueHistory(ctx, 12) : Promise.resolve([]),
  ]);
  const periodLabel = pk === "mes" ? formatMonth(today.slice(0, 7)) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
  const mBase = (n: number | string | null) => formatMoneyCompact(n, base);
  const axis = (n: number) => (n >= 1_000_000 ? `${formatNumber(n / 1_000_000, n >= 10_000_000 ? 0 : 1)} M` : formatNumber(n));

  return (
    <>
      <PageHeader
        title="Dirección"
        description={`Situación de la empresa · ${periodLabel}. Las cifras de flujo usan el período seleccionado; los saldos e inventario, el estado a hoy (${formatDate(today)}).`}
      />
      <FilterForm>
        <FilterSelect name="periodo" label="Período" defaultValue={pk === "mes" ? "" : pk} allLabel="Mes actual" options={Object.entries(PERIODS).filter(([key]) => key !== "mes").map(([value, label]) => ({ value, label }))} />
        <FilterSelect name="marca" label="Marca" defaultValue={filters.brand} allLabel="Todas" options={brands.map((b) => ({ value: b.id, label: b.name }))} />
        <FilterSelect name="vendedor" label="Vendedor" defaultValue={filters.seller} options={sellers.map((s) => ({ value: s.id, label: s.full_name }))} />
      </FilterForm>
      {k.missing_rate ? <div className="mb-4"><Notice tone="warning">Hay contratos en moneda extranjera sin tipo de cambio registrado: quedan fuera de los totales consolidados. Regístrelo en Caja › Tipos de cambio.</Notice></div> : null}

      <StatGrid className="mb-3">
        {p.has("inventory.view") ? (
          <Stat id="d-stock" label="Unidades en inventario" value={formatNumber(k.stock_units)} href="/inventario?estado=stock"
            sub={`${k.stock_available} disponibles · ${k.stock_reserved} reservadas`}
            definition={{ formula: "Unidades con disponibilidad «Disponible» o «Reservado». No incluye vendidas pendientes de entrega.", source: "Inventario." }} />
        ) : null}
        {canCosts ? (
          <Stat id="d-acq" label="Valor de adquisición" value={mBase(k.stock_acquisition_base)} sub={`Coste total registrado: ${mBase(k.stock_total_cost_base)}`}
            definition={{ formula: "Σ coste de adquisición registrado de las unidades en inventario, en moneda base al tipo de cambio de cada registro. El coste total suma transporte, reparaciones y demás costes (incluidos estimados).", source: "Costes por unidad." }} />
        ) : null}
        <Stat id="d-sales" label="Ventas del período" value={mBase(k.sales_amount_base)} sub={`${k.sales_count} operación(es) formalizada(s)`} href="/ventas?estado=formalizada"
          definition={{ formula: "Σ precio de venta de contratos firmados en el período, al tipo de cambio fijado al formalizar. Es facturación comprometida, no cobro.", source: "Contratos y operaciones." }} />
        {canPayments ? (
          <Stat id="d-coll" label="Cobros confirmados" value={mBase(k.collected_base)} tone="positive" sub="Efectivo, transferencias, cheques"
            definition={{ formula: "Σ pagos de clientes CONFIRMADOS con fecha de cobro en el período (excluye usados y notas de crédito). Pagos sólo registrados no se cuentan.", source: "Pagos de clientes." }} />
        ) : null}
        {canReceivables ? (
          <Stat id="d-rec" label="Cuentas por cobrar" value={mBase(k.receivable_base)} href="/cobranzas" sub="Saldo de contratos vigentes"
            definition={{ formula: "Σ saldo pendiente de contratos vigentes = cuotas − pagos confirmados aplicados. Moneda extranjera convertida al último tipo de cambio (referencial).", source: "Cuotas y aplicaciones." }} />
        ) : null}
        {canReceivables ? (
          <Stat id="d-over" label="Deuda vencida" value={mBase(k.overdue_base)} tone={Number(k.overdue_base) > 0 ? "critical" : "neutral"} href="/cobranzas?vista=bandeja"
            sub={`${k.overdue_contracts} contrato(s) · ${Number(k.receivable_base) > 0 ? formatPercent((Number(k.overdue_base) / Number(k.receivable_base)) * 100) : "0 %"} de la cartera`}
            definition={{ formula: "Σ saldo de cuotas vencidas (vencimiento anterior a hoy) de contratos vigentes.", source: "Cuotas y aplicaciones." }} />
        ) : null}
        {canPayables ? (
          <Stat id="d-pay" label="Cuentas por pagar" value={mBase(k.payables_base)} href="/compras" tone={Number(k.payables_overdue_base) > 0 ? "warning" : "neutral"}
            sub={Number(k.payables_overdue_base) > 0 ? `Vencido: ${mBase(k.payables_overdue_base)}` : "Sin facturas vencidas"}
            definition={{ formula: "Σ saldo de facturas de proveedores aprobadas (importe − pagos confirmados) + gastos aprobados sin pagar.", source: "Facturas de proveedores y gastos." }} />
        ) : null}
        {canCosts ? (
          <Stat id="d-invm" label="Margen estimado del inventario" kind="estimado" value={mBase(k.stock_margin_base)}
            sub={k.stock_missing_price ? `${k.stock_missing_price} unidad(es) sin precio o tipo de cambio` : "Precio de lista − costes"}
            definition={{ formula: "Σ (precio de lista convertido a moneda base − costes registrados y estimados) de las unidades en inventario. Supone venta a precio de lista: es una estimación.", source: "Inventario y costes." }} />
        ) : null}
        {canCosts ? (
          <Stat id="d-closed" label="Margen bruto de cerradas" value={mBase(k.closed_margin_base)} kind={k.closed_pending_costs ? "estimado" : "registrado"}
            sub={`${k.closed_count} entregada(s) en el período${k.closed_pending_costs ? ` · ${k.closed_pending_costs} con costes estimados` : ""}`}
            definition={{ formula: "Σ (precio de venta − costes de la unidad) de operaciones ENTREGADAS en el período. Si alguna tiene costes estimados sin factura, el valor se marca estimado. No incluye intereses de financiación.", source: "Operaciones y costes." }} />
        ) : null}
        {p.has("inventory.view") ? (
          <Stat id="d-pend" label="Pendientes de entrega" value={formatNumber(k.pending_delivery)} href="/ventas?estado=formalizada" tone={k.pending_delivery ? "warning" : "neutral"}
            sub="Vendidas, sin entrega física"
            definition={{ formula: "Unidades con venta formalizada cuya entrega aún no se registró.", source: "Inventario y ventas." }} />
        ) : null}
      </StatGrid>
      <p className="mb-6 text-[12px] text-faint">Los importes de caja del sistema son registros internos; no reemplazan un saldo bancario verificado. Ver Caja › Conciliaciones.</p>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[1.1fr_1fr]">
        <AttentionPanel items={attention} />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-1">
          <ChartCard title="Ventas mensuales" subtitle={`Precio de venta de contratos firmados, en ${base}`}>
            <Columns data={series.map((s) => ({ key: s.month, label: formatMonthShort(s.month), value: Number(s.sales_base), display: formatMoneyCompact(s.sales_base, base), detail: `${s.sales_count} operación(es)` }))} valueLabel={`Ventas (${base})`} axisFormat={axis} />
          </ChartCard>
          {canPayments ? (
            <ChartCard title="Cobros mensuales" subtitle={`Pagos confirmados por fecha de cobro, en ${base}`}>
              <Columns color="var(--color-series-3)" data={series.map((s) => ({ key: s.month, label: formatMonthShort(s.month), value: Number(s.collected_base), display: formatMoneyCompact(s.collected_base, base) }))} valueLabel={`Cobros (${base})`} axisFormat={axis} />
            </ChartCard>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {canReceivables ? (
          <ChartCard title="Evolución de la deuda vencida" subtitle={`Al cierre de cada mes, en ${base}`} className="xl:col-span-2">
            <Line data={history.map((h) => ({ key: h.month, label: formatMonthShort(h.month), value: Number(h.overdue_base), display: formatMoneyCompact(h.overdue_base, base), detail: Number(h.outstanding_base) > 0 ? `${formatPercent((Number(h.overdue_base) / Number(h.outstanding_base)) * 100)} de la cartera` : undefined }))} valueLabel={`Vencido (${base})`} axisFormat={axis} />
          </ChartCard>
        ) : null}
        {byBrand.length ? (
          <ChartCard title="Inventario por marca" subtitle="Unidades en stock">
            <HBars data={byBrand.map((b) => ({ key: b.brand, label: b.brand, value: b.units, display: `${b.units} u.`, detail: canCosts ? `capital ${formatMoneyCompact(b.cost_base, base)}` : undefined }))} valueLabel="Unidades" />
          </ChartCard>
        ) : null}
        {aging.length ? (
          <ChartCard title="Antigüedad del inventario" subtitle="Unidades por días en stock">
            <HBars data={aging.map((a) => ({ key: a.bucket, label: a.bucket, value: a.units, display: `${a.units} u.`, detail: canCosts ? `capital ${formatMoneyCompact(a.cost_base, base)}` : undefined }))} valueLabel="Unidades" />
          </ChartCard>
        ) : null}
        {canCosts ? (
          <ChartCard title="Margen por operación" subtitle={`Formalizadas en el período, en ${base} (estimado si hay costes sin factura)`} className="md:col-span-2 xl:col-span-4">
            {margins.length ? (
              <HBars data={margins.map((m) => ({ key: m.id, label: `${m.number} · ${m.label}`, value: Math.max(0, Number(m.margin_base)), display: `${formatMoneyCompact(m.margin_base, base)}${m.pending ? " (est.)" : ""}`, detail: Number(m.sale_base) ? `${formatPercent((Number(m.margin_base) / Number(m.sale_base)) * 100)} del precio` : undefined }))} valueLabel={`Margen (${base})`} />
            ) : <EmptyState title="Sin operaciones formalizadas en el período" />}
          </ChartCard>
        ) : null}
      </div>
    </>
  );
}

const SEVERITY = {
  critical: { icon: CircleAlert, cls: "text-critical", label: "Crítico" },
  warning: { icon: AlertTriangle, cls: "text-warning", label: "Atención" },
  info: { icon: Info, cls: "text-info", label: "Seguimiento" },
} as const;

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const counts = { critical: items.filter((i) => i.severity === "critical").length, warning: items.filter((i) => i.severity === "warning").length };
  return (
    <section className="rounded-lg border border-line-soft bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Atención requerida</h2>
          <p className="text-[12.5px] text-faint">Ordenado por gravedad e importe. Cada ítem abre la operación.</p>
        </div>
        <p className="text-[12.5px] text-muted"><span className="text-critical">{counts.critical} críticos</span> · <span className="text-warning">{counts.warning} de atención</span> · {items.length} en total</p>
      </header>
      {items.length === 0 ? <EmptyState title="Nada requiere su atención" description="No hay mora, aprobaciones, vencimientos ni diferencias pendientes." /> : (
        <ul className="scrollbar-thin max-h-[640px] divide-y divide-line-soft overflow-y-auto">
          {items.slice(0, 60).map((i) => {
            const S = SEVERITY[i.severity];
            return (
              <li key={i.key}>
                <Link href={i.href} className="group flex items-start gap-3 px-4 py-3 hover:bg-elevated/50">
                  <S.icon className={cn("mt-0.5 size-4 shrink-0", S.cls)} aria-label={S.label} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium uppercase tracking-wide text-faint">{i.category}</p>
                    <p className="truncate text-[13.5px] text-ink">{i.title}</p>
                    <p className="text-[12.5px] text-muted">{i.reason}{i.owner ? <span className="text-faint"> · Responsable: {i.owner}</span> : null}</p>
                  </div>
                  {i.amount !== null && i.currency ? <Money value={i.amount} currency={i.currency} compact={Math.abs(Number(i.amount)) >= 10_000_000} className="mt-4 text-[13px] text-ink-2" /> : null}
                  <ArrowRight className="mt-4 size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 60 ? <p className="border-t border-line-soft px-4 py-2 text-[12px] text-faint">Se muestran los 60 más prioritarios de {items.length}.</p> : null}
    </section>
  );
}

