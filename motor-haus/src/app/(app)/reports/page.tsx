import Link from "next/link";
import { Download } from "lucide-react";
import { getContext, query, can } from "@/server/context";
import { PERIOD_OPTIONS, resolveCurrency, resolvePeriod } from "@/server/filters";
import { profitabilityRows } from "@/server/reports";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Money, Pct } from "@/components/ui/Money";
import { Meter } from "@/components/ui/Chart";
import { buttonClass } from "@/components/ui/Button";
import { SearchParams } from "@/components/ui/Table";
import { CATEGORY, label } from "@/lib/labels";
import { date, num } from "@/lib/format";

export const metadata = { title: "Rentabilidad y reportes" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

function group(rows: R[], key: string) {
  const m = new Map<string, { n: number; revenue: number; margin: number; discount: number; days: number }>();
  rows.forEach((r) => {
    const g = m.get(r[key]) ?? { n: 0, revenue: 0, margin: 0, discount: 0, days: 0 };
    g.n++; g.revenue += Number(r.precio_venta); g.margin += Number(r.margen_bruto_real); g.discount += Number(r.descuento); g.days += Number(r.dias_en_stock ?? 0);
    m.set(r[key], g);
  });
  return [...m.entries()].sort((a, b) => b[1].margin - a[1].margin);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "report.read")) return <Panel><Empty title="Se requiere el permiso report.read" /></Panel>;
  const period = resolvePeriod(params, ctx.today, "365");
  const ccy = resolveCurrency(params, ctx.org.currency);
  const d = await query(ctx, async (db) => ({
    rows: await profitabilityRows(db, { orgId: ctx.org.id, currency: ccy, from: period.from, to: period.to }),
    aging: await db.rows<R>(
      `select case when days_in_stock is null then 'No recibida' when days_in_stock <= 30 then '0–30 días' when days_in_stock <= 90 then '31–90 días'
                   when days_in_stock <= 180 then '91–180 días' else 'Más de 180 días' end bucket,
              min(coalesce(days_in_stock, -1)) ord, count(*) units, sum(cost_actual) capital, sum(list_price) list_value
         from public.unit_overview where organization_id = $1 and currency = $2 and in_stock group by 1 order by ord`, [ctx.org.id, ccy]),
  }));
  const total = d.rows.reduce((a, r) => ({ revenue: a.revenue + Number(r.precio_venta), margin: a.margin + Number(r.margen_bruto_real), discount: a.discount + Number(r.descuento) }), { revenue: 0, margin: 0, discount: 0 });
  const maxCap = Math.max(1, ...d.aging.map((a) => Number(a.capital ?? 0)));
  return (
    <>
      <PageHeader title="Rentabilidad y reportes" subtitle="Margen bruto por operación con los costes reales registrados al formalizar. Los costes posteriores a la venta se informan aparte."
        actions={can(ctx, "report.export") && <a href={`/api/export/profitability?from=${period.from}&to=${period.to}&ccy=${ccy}`} className={buttonClass("secondary")}><Download className="size-3.5" />Exportar CSV (auditado)</a>} />
      <FilterBar base="/reports" filters={[
        { name: "p", label: "Período", value: period.preset, options: PERIOD_OPTIONS.filter(([k]) => k !== "custom") },
        { name: "ccy", label: "Moneda", value: ccy, options: [["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]] },
      ]} />
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[["Por vendedor", "vendedor"], ["Por categoría", "categoria"]].map(([title, key]) => (
          <Panel key={key} title={title} subtitle={`${period.label} · ${ccy}`}>
            {d.rows.length === 0 ? <Empty title="Sin ventas" /> : (
              <table className="mh-table"><thead><tr><th></th><th className="r">Unid.</th><th className="r">Ventas</th><th className="r">Margen</th><th className="r">%</th><th className="r">Días stock</th></tr></thead>
                <tbody>{group(d.rows, key).map(([k, g]) => (
                  <tr key={k}><td>{key === "categoria" ? label(CATEGORY, k) : k}</td><td className="r num">{g.n}</td><td className="r"><Money value={g.revenue} currency={ccy} compact /></td>
                    <td className="r"><Money value={g.margin} currency={ccy} compact /></td><td className="r"><Pct value={g.revenue ? (g.margin / g.revenue) * 100 : null} /></td><td className="r num">{num(g.days / g.n)}</td></tr>
                ))}</tbody></table>
            )}
          </Panel>
        ))}
        <Panel title="Antigüedad del inventario" subtitle={`Capital invertido por tramo · ${ccy}`}>
          <table className="mh-table"><tbody>{d.aging.map((a) => (
            <tr key={a.bucket}><td className="w-32">{a.bucket}</td><td><Meter value={Number(a.capital ?? 0)} max={maxCap} tone={a.bucket.startsWith("Más") ? "risk" : a.bucket.startsWith("91") ? "warn" : "accent"} /></td>
              <td className="r"><Money value={a.capital} currency={ccy} compact /></td><td className="r text-xs text-muted">{a.units} u.</td></tr>
          ))}</tbody></table>
        </Panel>
      </div>
      <Panel title="Rentabilidad por operación" subtitle={`${d.rows.length} unidades vendidas · ventas ${num(total.revenue, 2)} · margen ${num(total.margin, 2)} · descuentos ${num(total.discount, 2)} (${ccy})`}>
        {d.rows.length === 0 ? <Empty title="Sin ventas formalizadas en el período" /> : (
          <div className="overflow-x-auto"><table className="mh-table">
            <thead><tr><th>Contrato</th><th>Fecha</th><th>Cliente</th><th>Unidad</th><th>Vendedor</th><th className="r">Lista</th><th className="r">Venta</th><th className="r">Descuento</th><th className="r">Coste real</th><th className="r">Margen</th><th className="r">%</th><th className="r">Costes post-venta</th><th className="r">Días</th></tr></thead>
            <tbody>{d.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.contrato}</td><td className="num">{date(r.fecha)}</td><td className="text-text-2">{r.cliente}</td><td className="text-text-2">{r.unidad}<div className="text-xs text-faint">{r.stock}</div></td>
                <td className="text-text-2">{r.vendedor}</td><td className="r"><Money value={r.precio_lista} currency={ccy} muted /></td><td className="r"><Money value={r.precio_venta} currency={ccy} /></td>
                <td className="r"><Money value={r.descuento} currency={ccy} /></td><td className="r"><Money value={r.coste_real_al_formalizar} currency={ccy} /></td>
                <td className="r"><Money value={r.margen_bruto_real} currency={ccy} /></td><td className="r"><Pct value={r.margen_pct} /></td>
                <td className="r">{Number(r.costes_posteriores_a_la_venta) ? <Money value={r.costes_posteriores_a_la_venta} currency={ccy} className="text-warn" /> : "—"}</td>
                <td className="r num">{r.dias_en_stock ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-faint">Margen bruto real = precio de venta − coste real reconocido al formalizar (conceptos incluidos según la política de costes). No incluye gastos operativos ni el margen futuro de unidades recibidas como parte de pago. <Link href="/admin" className="text-accent">Política de costes</Link></p>
    </>
  );
}
