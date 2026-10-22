import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getContext, query, can } from "@/server/context";
import { PERIOD_OPTIONS, resolveCurrency, resolvePeriod, uuidOrNull } from "@/server/filters";
import { PageHeader, Panel, Figure, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, Basis } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { BarChart, Meter } from "@/components/ui/Chart";
import { SearchParams, sp } from "@/components/ui/Table";
import { CATEGORY, label, Tone } from "@/lib/labels";
import { date, monthLabel, money, num } from "@/lib/format";

export const metadata = { title: "Centro de control" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Snap = Record<string, any>;

interface Alert {
  alert_key: string; kind: string; severity: string; entity_type: string; title: string; detail: string;
  impact_amount: string | null; currency: string | null; age_days: number | null; owner_name: string | null; action: string; href: string;
}

const SEVERITY: Record<string, [string, Tone]> = { critical: ["Crítica", "risk"], warning: ["Atención", "warn"], info: ["Seguimiento", "info"] };

export default async function ExecutivePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const period = resolvePeriod(params, ctx.today);
  const currency = resolveCurrency(params, ctx.org.currency);
  const category = sp(params, "cat") && CATEGORY[sp(params, "cat")!] ? sp(params, "cat")! : null;
  const salesperson = uuidOrNull(sp(params, "sp"));
  const severity = sp(params, "sev");

  const data = await query(ctx, async (db) => {
    const snap = await db.one<{ s: Snap }>("select public.executive_snapshot($1, $2, $3, $4, $5, $6) s",
      [ctx.org.id, currency, period.from, period.to, category, salesperson]);
    const alerts = await db.rows<Alert>("select * from public.management_alerts($1)", [ctx.org.id]);
    const aging = can(ctx, "receivable.read", "receivable.read_own")
      ? await db.rows<{ bucket_order: number; bucket_label: string; amount: string; installments: string; contracts: string }>(
          "select * from public.receivables_aging($1, $2, $3)", [ctx.org.id, currency, salesperson]) : [];
    const projection = can(ctx, "receivable.read") && can(ctx, "payable.read")
      ? await db.rows<{ month: string; expected_inflows: string; expected_outflows: string; pending_movements: string; net: string }>(
          "select * from public.cash_projection($1, $2, 6)", [ctx.org.id, currency]) : [];
    const sellers = await db.rows<{ id: string; full_name: string }>(
      `select p.id, p.full_name from public.memberships m join public.user_profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.active and m.role_code in ('sales_advisor','sales_manager') order by p.full_name`, [ctx.org.id]);
    return { snap: snap.s, alerts, aging, projection, sellers };
  });

  const s = data.snap;
  const alerts = data.alerts.filter((a) => !severity || a.severity === severity);
  const sevCount = (k: string) => data.alerts.filter((a) => a.severity === k).length;
  const agingMax = Math.max(1, ...data.aging.map((a) => Number(a.amount)));
  const sales = s.sales;
  const revenueDelta = sales && Number(sales.previous_revenue) > 0
    ? ((Number(sales.revenue) - Number(sales.previous_revenue)) / Number(sales.previous_revenue)) * 100 : null;

  return (
    <>
      <PageHeader title="Centro de control" subtitle={<>Situación al {date(s.as_of)} · {period.label} · cifras en {currency}, sin conversión entre monedas</>} />
      <FilterBar base="/" filters={[
        { name: "p", label: "Período", options: PERIOD_OPTIONS.filter(([k]) => k !== "custom"), value: period.preset },
        { name: "ccy", label: "Moneda", options: [["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]], value: currency },
        { name: "cat", label: "Categoría", options: Object.entries(CATEGORY), value: category ?? "", all: "Todas" },
        { name: "sp", label: "Vendedor", options: data.sellers.map((x) => [x.id, x.full_name]), value: salesperson ?? "", all: "Todos" },
      ]} />

      {/* A. Posición financiera */}
      <Panel title="Posición financiera" subtitle="Caja, deuda de clientes, deuda con proveedores, capital y rentabilidad se presentan por separado" className="mb-4">
        <div className="grid grid-cols-1 divide-line-soft sm:grid-cols-2 sm:divide-x lg:grid-cols-5 [&>*]:border-b [&>*]:border-line-soft">
          <Figure label="Caja disponible" basis={<Basis kind="manual" />}
            value={s.cash ? <Money value={s.cash.available} currency={currency} /> : "Sin acceso"}
            note={s.cash ? <>Movimientos pendientes <Money value={s.cash.pending} currency={currency} /> · saldos registrados manualmente, sin integración bancaria</> : s.cash_reason}
            href={can(ctx, "treasury.read") ? "/treasury" : undefined} />
          <Figure label="Cuentas por cobrar" basis={<Basis kind="contractual" />}
            value={s.receivables ? <Money value={s.receivables.outstanding} currency={currency} /> : "Sin acceso"}
            note={s.receivables && <>Vencido <span className="text-risk"><Money value={s.receivables.overdue} currency={currency} /></span> · {pct(s.receivables.overdue_ratio_pct)} de la cartera</>}
            tone={undefined} href="/receivables" />
          <Figure label="Cuentas por pagar" basis={<Basis kind="contractual" />}
            value={s.payables ? <Money value={s.payables.outstanding} currency={currency} /> : "Sin acceso"}
            note={s.payables && <>Vence en 30 días <Money value={s.payables.due_next_30} currency={currency} /> · vencido <Money value={s.payables.overdue} currency={currency} /></>}
            href={can(ctx, "payable.read") ? "/payables" : undefined} />
          <Figure label="Cobranza del período" basis={<Basis kind="confirmado" />}
            value={s.collections ? <Money value={s.collections.collected_confirmed} currency={currency} /> : "Sin acceso"}
            note={s.collections && <>Sin conciliar <Money value={s.collections.collected_pending_reconciliation} currency={currency} /> · efectividad {pct(s.collection_effectiveness?.effectiveness_pct)}</>}
            href="/payments" />
          <Figure label="Resultado operativo" basis={<Basis kind="estimado" />}
            value={s.operating_result ? <Money value={s.operating_result.value} currency={currency} /> : "No calculable"}
            note={s.operating_result ? s.operating_result.basis : s.operating_result_reason ?? "Requiere report.read y treasury.read"} />
          <Figure label="Capital invertido en inventario" basis={<Basis kind="real" />}
            value={s.inventory.capital_invested !== null ? <Money value={s.inventory.capital_invested} currency={currency} /> : "Sin acceso a costes"}
            note={s.inventory.capital_invested !== null && <>+ <Money value={s.inventory.cost_estimated_pending} currency={currency} /> en costes estimados sin liquidar</>}
            href="/inventory?view=table" />
          <Figure label="Stock a precio de lista" basis={<Basis kind="estimado" />}
            value={<Money value={s.inventory.stock_value_list} currency={currency} />}
            note={<>{num(s.inventory.units_in_stock)} unidades en stock · {num(s.inventory.units_without_list_price)} sin precio aún</>} />
          <Figure label="Margen bruto potencial" basis={<Basis kind="estimado" />}
            value={s.inventory.potential_margin !== null ? <Money value={s.inventory.potential_margin} currency={currency} /> : "Sin acceso a costes"}
            note="Precio de lista − costes reales − estimados, unidades con precio" />
          <Figure label="Ventas formalizadas" basis={<Basis kind="real" />}
            value={sales ? <Money value={sales.revenue} currency={currency} /> : "Sin acceso"}
            note={sales && <>{num(sales.contracts)} contratos · período anterior <Money value={sales.previous_revenue} currency={currency} />{revenueDelta !== null && <> ({revenueDelta >= 0 ? "+" : ""}{num(revenueDelta, 1)} %)</>}</>}
            href="/contracts" />
          <Figure label="Margen bruto realizado" basis={<Basis kind="real" />}
            value={sales?.gross_margin_realized != null ? <Money value={sales.gross_margin_realized} currency={currency} /> : "Sin acceso"}
            note={sales?.gross_margin_realized != null && <>Costes reales al formalizar · estimados entonces <Money value={sales.cost_estimated_at_sale} currency={currency} /></>}
            href={can(ctx, "report.read") ? "/reports" : undefined} />
        </div>
      </Panel>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
        {/* B. Alertas de gestión */}
        <Panel title="Atención prioritaria" subtitle="Ordenado por severidad, impacto y antigüedad · umbrales en Administración"
          actions={
            <div className="flex gap-1 text-xs">
              {[["", `Todas ${data.alerts.length}`], ["critical", `Críticas ${sevCount("critical")}`], ["warning", `Atención ${sevCount("warning")}`], ["info", `Seguimiento ${sevCount("info")}`]].map(([k, l]) => (
                <Link key={k} href={k ? `/?${new URLSearchParams({ ...flat(params), sev: k })}` : `/?${new URLSearchParams(withoutSev(params))}`}
                  className={`rounded-sm px-2 py-1 ${(severity ?? "") === k ? "bg-raised text-text" : "text-muted hover:text-text"}`}>{l}</Link>
              ))}
            </div>
          }>
          {alerts.length === 0 ? (
            <Empty title="No hay alertas con los criterios actuales" hint="Las alertas se generan con reglas explícitas configuradas en Administración." />
          ) : (
            <ul className="max-h-[520px] divide-y divide-line-soft overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.alert_key}>
                  <Link href={a.href} className="group flex items-start gap-3 px-4 py-2.5 hover:bg-raised">
                    <div className="w-[92px] shrink-0 pt-0.5"><Badge tone={SEVERITY[a.severity][1]}>{SEVERITY[a.severity][0]}</Badge></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-text">{a.title}</div>
                      <div className="truncate text-xs text-muted">{a.detail}</div>
                      <div className="mt-0.5 text-xs text-faint">
                        {a.owner_name ? `Responsable: ${a.owner_name}` : "Sin responsable asignado"} · <span className="text-text-2">{a.action}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[13px]">{a.impact_amount ? <Money value={a.impact_amount} currency={a.currency ?? currency} /> : <span className="text-faint">—</span>}</div>
                      <div className="text-xs text-faint">{a.age_days !== null ? `${a.age_days} d` : ""}</div>
                    </div>
                    <ArrowRight className="mt-1 size-3.5 shrink-0 text-faint group-hover:text-accent" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid gap-4">
          <Panel title="Antigüedad de la deuda" subtitle={`Saldo pendiente por tramo de atraso · ${currency}`}
            actions={<Link href="/receivables" className="text-xs text-muted hover:text-text">Cartera →</Link>}>
            {data.aging.length === 0 ? <Empty title="Sin acceso a cuentas por cobrar" /> : (
              <table className="mh-table">
                <tbody>
                  {data.aging.map((b) => (
                    <tr key={b.bucket_order}>
                      <td className="w-36 text-text-2">{b.bucket_label}</td>
                      <td><Meter value={Number(b.amount)} max={agingMax} tone={b.bucket_order === 0 ? "muted" : b.bucket_order >= 3 ? "risk" : "warn"} /></td>
                      <td className="r w-32"><Money value={b.amount} currency={currency} /></td>
                      <td className="r w-20 text-xs text-muted">{num(b.installments)} cuotas</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Proyección de caja contractual" subtitle="Cuotas por cobrar y facturas por pagar a vencer. No es flujo realizado; lo vencido se excluye.">
            <div className="px-4 py-3">
              {data.projection.length === 0 ? <Empty title="Requiere acceso a cobranzas y cuentas por pagar" /> : (
                <>
                  <BarChart currency={currency} ariaLabel="Proyección de entradas y salidas por mes" height={190} width={440}
                    series={["Entradas previstas", "Salidas previstas"]}
                    data={data.projection.map((p) => ({ label: monthLabel(p.month.slice(0, 7)), values: [Number(p.expected_inflows), Number(p.expected_outflows)],
                      note: `Neto ${money(p.net, currency)}${Number(p.pending_movements) ? ` · incluye movimientos pendientes ${money(p.pending_movements, currency)}` : ""}` }))} />
                  <p className="mt-2 text-xs text-faint">Neto 6 meses: <Money value={data.projection.reduce((a, p) => a + Number(p.net), 0)} currency={currency} /> · <Basis kind="proyección" /></p>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* C. Actividad comercial */}
      {sales && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Panel title="Ventas formalizadas por mes" subtitle={`Últimos 12 meses · ${currency}${s.targets ? " · objetivo mensual configurado" : ""}`}>
            <div className="px-4 py-3">
              {sales.monthly.length === 0 ? <Empty title="Sin ventas formalizadas en los últimos 12 meses" /> : (
                <BarChart currency={currency} ariaLabel="Ventas formalizadas por mes" series={["Ventas formalizadas"]}
                  target={s.targets ? Number(s.targets.revenue) / Math.max(1, Number(s.targets.rows)) : undefined} targetLabel="Objetivo mensual"
                  data={sales.monthly.map((m: Snap) => ({ label: monthLabel(m.month), values: [Number(m.revenue)], note: `${m.units} unidad(es)` }))} />
              )}
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line-soft pt-3 text-xs sm:grid-cols-4">
                <Mini label="Ticket medio" value={<Money value={sales.avg_deal_value} currency={currency} />} />
                <Mini label="Descuentos otorgados" value={<Money value={sales.discounts} currency={currency} />} />
                <Mini label="Conversión" value={s.conversion?.conversion_pct != null ? <Pct value={s.conversion.conversion_pct} /> : "—"}
                  hint={`${num(s.conversion?.deals_formalized)} de ${num(s.conversion?.deals_created)} operaciones creadas`} />
                <Mini label="Vendidas / disponibles" value={`${num(sales.units)} / ${num(s.inventory.units_available)}`} hint="Unidades del período / hoy" />
              </div>
              {s.targets && (
                <p className="mt-2 text-xs text-muted">Objetivo del período: <Money value={s.targets.revenue} currency={currency} /> · cumplimiento {pct(Number(s.targets.revenue) > 0 ? (Number(sales.revenue) / Number(s.targets.revenue)) * 100 : null)}</p>
              )}
            </div>
          </Panel>
          <div className="grid gap-4">
            <Panel title="Por vendedor" subtitle={period.label}>
              <SimpleTable currency={currency} rows={sales.by_salesperson} first={(r) => r.name ?? "—"} showMargin={can(ctx, "report.read")} />
            </Panel>
            <Panel title="Por categoría" subtitle={period.label}>
              <SimpleTable currency={currency} rows={sales.by_category} first={(r) => label(CATEGORY, r.category)} showMargin={can(ctx, "report.read")} />
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function pct(v: unknown) {
  return v === null || v === undefined ? "—" : `${num(v as number, 1)} %`;
}

function Mini({ label: l, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-faint">{l}</div>
      <div className="mt-0.5 text-[13px] text-text">{value}</div>
      {hint && <div className="text-faint">{hint}</div>}
    </div>
  );
}

function SimpleTable({ rows, first, currency, showMargin }: { rows: Snap[]; first: (r: Snap) => string; currency: string; showMargin: boolean }) {
  if (!rows.length) return <Empty title="Sin ventas en el período" />;
  return (
    <table className="mh-table">
      <thead><tr><th></th><th className="r">Unid.</th><th className="r">Ventas</th>{showMargin && <th className="r">Margen bruto</th>}{showMargin && <th className="r">%</th>}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{first(r)}</td>
            <td className="r num">{num(r.units)}</td>
            <td className="r"><Money value={r.revenue} currency={currency} /></td>
            {showMargin && <td className="r"><Money value={r.margin} currency={currency} /></td>}
            {showMargin && <td className="r num text-muted">{Number(r.revenue) > 0 ? `${num((Number(r.margin) / Number(r.revenue)) * 100, 1)} %` : "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function flat(params: SearchParams): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) { const x = Array.isArray(v) ? v[0] : v; if (x) o[k] = x; }
  return o;
}
function withoutSev(params: SearchParams) {
  const o = flat(params);
  delete o.sev;
  return o;
}
