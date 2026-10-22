import "server-only";
import type { Permission } from "@/domain/permissions";
import type { AppContext } from "@/server/auth/context";
import type { Tx } from "@/server/db/client";
import { isIsoDate, startOfMonth } from "@/domain/dates";
import { COMMERCIAL_STATUS, DEAL_STATUS, DOC_STATUS, TRADEIN_STATUS } from "@/lib/labels";

export type ColType = "text" | "money" | "base" | "number" | "date" | "pct";

export interface Column {
  key: string;
  label: string;
  type: ColType;
  /** Para type "money": columna con la moneda de la fila */
  currencyKey?: string;
  /** Etiquetas legibles para valores de catálogo */
  labels?: Record<string, string>;
}

const L = (c: Record<string, { label: string }>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.label]));
const CONDITION = { nuevo: "0 km", usado: "Usado" };
const PAYMENT_TYPE = { contado: "Contado", financiado: "Financiado" };

export interface ReportFilters {
  from: string;
  to: string;
  brand?: string;
  seller?: string;
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  group: "Inventario" | "Ventas" | "Cartera y caja" | "Compras";
  anyOf: Permission[];
  usesPeriod: boolean;
  projected?: boolean;
  /** Sin fila de totales (p. ej. filas heterogéneas) */
  noTotals?: boolean;
  columns: Column[];
  run: (ctx: AppContext, f: ReportFilters) => Promise<Record<string, unknown>[]>;
}

const brandFilter = (tx: Tx, f: ReportFilters) => (f.brand ? tx`and v.brand_id = ${f.brand}` : tx``);
const sellerFilter = (tx: Tx, f: ReportFilters) => (f.seller ? tx`and d.seller_id = ${f.seller}` : tx``);

export const REPORTS: ReportDef[] = [
  {
    key: "inventario", title: "Inventario valorizado", group: "Inventario", anyOf: ["inventory.costs.view"], usesPeriod: false,
    description: "Unidades en stock y vendidas sin entregar, con coste, precio y margen estimado en moneda base.",
    columns: [
      { key: "stock_code", label: "Código", type: "text" }, { key: "unidad", label: "Unidad", type: "text" }, { key: "condicion", label: "Condición", type: "text", labels: CONDITION },
      { key: "estado", label: "Disponibilidad", type: "text", labels: L(COMMERCIAL_STATUS) }, { key: "dias", label: "Días", type: "number" },
      { key: "precio", label: "Precio de lista", type: "money", currencyKey: "moneda" }, { key: "coste", label: "Coste total", type: "base" },
      { key: "estimados", label: "de ello estimado", type: "base" }, { key: "margen", label: "Margen estimado", type: "base" },
    ],
    run: (ctx, f) => ctx.db((tx) => tx`
      select v.stock_code, app.vehicle_name(b.name, v.model) || coalesce(' ' || v.version, '') || ' ' || v.year_model as unidad, v.condition as condicion,
             v.commercial_status as estado, e.days_in_stock as dias, v.list_price as precio, v.price_currency as moneda,
             e.total_cost_base as coste, e.estimated_cost_base as estimados, e.estimated_margin_base as margen
      from public.vehicles v join public.brands b on b.id = v.brand_id join public.v_vehicle_economics e on e.vehicle_id = v.id
      where v.org_id = ${ctx.org.id} and v.commercial_status in ('disponible','reservado','vendido_pendiente_entrega') ${brandFilter(tx, f)}
      order by e.days_in_stock desc`),
  },
  {
    key: "antiguedad", title: "Antigüedad de stock", group: "Inventario", anyOf: ["inventory.view"], usesPeriod: false,
    description: "Unidades en stock agrupadas por días desde la adquisición.",
    columns: [{ key: "tramo", label: "Tramo", type: "text" }, { key: "unidades", label: "Unidades", type: "number" }, { key: "capital", label: "Capital (costes)", type: "base" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      with s as (select e.days_in_stock, e.total_cost_base from public.vehicles v join public.v_vehicle_economics e on e.vehicle_id = v.id
                 where v.org_id = ${ctx.org.id} and v.commercial_status in ('disponible','reservado') ${brandFilter(tx, f)}),
      b(tramo, ord, lo, hi) as (values ('0–30 días',1,0,30),('31–60 días',2,31,60),('61–90 días',3,61,90),('91–180 días',4,91,180),('Más de 180 días',5,181,100000))
      select b.tramo, count(s.*)::int as unidades, sum(s.total_cost_base) as capital from b left join s on s.days_in_stock between b.lo and b.hi group by b.tramo, b.ord order by b.ord`),
  },
  {
    key: "capital", title: "Capital invertido", group: "Inventario", anyOf: ["inventory.costs.view"], usesPeriod: false,
    description: "Capital inmovilizado en inventario por marca y condición (costes registrados y estimados).",
    columns: [{ key: "marca", label: "Marca", type: "text" }, { key: "condicion", label: "Condición", type: "text", labels: CONDITION }, { key: "unidades", label: "Unidades", type: "number" },
      { key: "registrado", label: "Coste registrado", type: "base" }, { key: "estimado", label: "Coste estimado", type: "base" }, { key: "total", label: "Total", type: "base" }],
    run: (ctx) => ctx.db((tx) => tx`
      select b.name as marca, v.condition as condicion, count(*)::int as unidades, sum(e.registered_cost_base) as registrado, sum(e.estimated_cost_base) as estimado, sum(e.total_cost_base) as total
      from public.vehicles v join public.brands b on b.id = v.brand_id join public.v_vehicle_economics e on e.vehicle_id = v.id
      where v.org_id = ${ctx.org.id} and v.commercial_status in ('disponible','reservado') group by b.name, v.condition order by b.name, v.condition`),
  },
  {
    key: "ventas", title: "Ventas por período", group: "Ventas", anyOf: ["deals.view_all"], usesPeriod: true,
    description: "Contratos firmados en el período: precio, descuento, modalidad, vendedor. Es facturación comprometida, no cobro.",
    columns: [{ key: "fecha", label: "Firma", type: "date" }, { key: "numero", label: "Operación", type: "text" }, { key: "cliente", label: "Cliente", type: "text" },
      { key: "unidad", label: "Unidad", type: "text" }, { key: "marca", label: "Marca", type: "text" }, { key: "vendedor", label: "Vendedor", type: "text" },
      { key: "modalidad", label: "Modalidad", type: "text", labels: PAYMENT_TYPE }, { key: "lista", label: "Precio lista", type: "money", currencyKey: "moneda" },
      { key: "descuento", label: "Descuento", type: "money", currencyKey: "moneda" }, { key: "venta", label: "Precio venta", type: "money", currencyKey: "moneda" },
      { key: "venta_base", label: "Venta (base)", type: "base" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      select k.signed_on as fecha, d.number as numero, c.full_name as cliente, app.vehicle_name(b.name, v.model) || ' ' || v.year_model as unidad, b.name as marca,
             u.full_name as vendedor, d.payment_type as modalidad, d.currency as moneda, d.list_price as lista, d.discount_amount as descuento, d.sale_price as venta,
             round(d.sale_price * coalesce(d.fx_rate_to_base, 1)) as venta_base
      from public.deals d join public.contracts k on k.deal_id = d.id join public.customers c on c.id = d.customer_id
      join public.vehicles v on v.id = d.vehicle_id join public.brands b on b.id = v.brand_id join public.user_profiles u on u.id = d.seller_id
      where d.org_id = ${ctx.org.id} and k.status <> 'anulado' and k.signed_on between ${f.from} and ${f.to} ${brandFilter(tx, f)} ${sellerFilter(tx, f)}
      order by k.signed_on`),
  },
  {
    key: "ventas_marca", title: "Ventas por marca", group: "Ventas", anyOf: ["deals.view_all"], usesPeriod: true,
    description: "Unidades y facturación por marca en el período (moneda base al tipo de cambio de cada operación).",
    columns: [{ key: "marca", label: "Marca", type: "text" }, { key: "unidades", label: "Unidades", type: "number" }, { key: "venta_base", label: "Ventas", type: "base" }, { key: "descuento_base", label: "Descuentos", type: "base" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      select b.name as marca, count(*)::int as unidades, round(sum(d.sale_price * coalesce(d.fx_rate_to_base, 1))) as venta_base,
             round(sum(d.discount_amount * coalesce(d.fx_rate_to_base, 1))) as descuento_base
      from public.deals d join public.contracts k on k.deal_id = d.id join public.vehicles v on v.id = d.vehicle_id join public.brands b on b.id = v.brand_id
      where d.org_id = ${ctx.org.id} and k.status <> 'anulado' and k.signed_on between ${f.from} and ${f.to} ${sellerFilter(tx, f)}
      group by b.name order by venta_base desc`),
  },
  {
    key: "ventas_vendedor", title: "Ventas por vendedor", group: "Ventas", anyOf: ["deals.view_all"], usesPeriod: true,
    description: "Desempeño comercial: operaciones, facturación y descuento promedio por vendedor.",
    columns: [{ key: "vendedor", label: "Vendedor", type: "text" }, { key: "unidades", label: "Operaciones", type: "number" }, { key: "venta_base", label: "Ventas", type: "base" }, { key: "descuento_pct", label: "Descuento promedio", type: "pct" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      select u.full_name as vendedor, count(*)::int as unidades, round(sum(d.sale_price * coalesce(d.fx_rate_to_base, 1))) as venta_base,
             round(avg(case when d.list_price > 0 then d.discount_amount * 100 / d.list_price end), 2) as descuento_pct
      from public.deals d join public.contracts k on k.deal_id = d.id join public.user_profiles u on u.id = d.seller_id join public.vehicles v on v.id = d.vehicle_id
      where d.org_id = ${ctx.org.id} and k.status <> 'anulado' and k.signed_on between ${f.from} and ${f.to} ${brandFilter(tx, f)}
      group by u.full_name order by venta_base desc`),
  },
  {
    key: "margen", title: "Margen por unidad vendida", group: "Ventas", anyOf: ["inventory.costs.view"], usesPeriod: true,
    description: "Precio de venta menos costes por operación. «Realizado» sólo si está entregada y sin costes estimados pendientes.",
    columns: [{ key: "numero", label: "Operación", type: "text" }, { key: "unidad", label: "Unidad", type: "text" }, { key: "estado", label: "Estado", type: "text", labels: L(DEAL_STATUS) },
      { key: "venta_base", label: "Venta", type: "base" }, { key: "coste_registrado", label: "Coste registrado", type: "base" }, { key: "coste_estimado", label: "Coste estimado", type: "base" },
      { key: "margen", label: "Margen", type: "base" }, { key: "margen_pct", label: "Margen %", type: "pct" }, { key: "tipo", label: "Tipo de margen", type: "text" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      select d.number as numero, app.vehicle_name(b.name, v.model) || ' ' || v.year_model as unidad, d.status as estado,
             round(d.sale_price * coalesce(d.fx_rate_to_base, 1)) as venta_base,
             coalesce(e.registered_cost_base, 0) as coste_registrado, coalesce(e.estimated_cost_base, 0) as coste_estimado,
             round(d.sale_price * coalesce(d.fx_rate_to_base, 1)) - coalesce(e.total_cost_base, 0) as margen,
             round((round(d.sale_price * coalesce(d.fx_rate_to_base, 1)) - coalesce(e.total_cost_base, 0)) * 100 / nullif(round(d.sale_price * coalesce(d.fx_rate_to_base, 1)), 0), 2) as margen_pct,
             case when d.status = 'entregada' and coalesce(e.estimated_cost_base, 0) = 0 then 'Realizado' else 'Estimado' end as tipo
      from public.deals d join public.contracts k on k.deal_id = d.id join public.vehicles v on v.id = d.vehicle_id join public.brands b on b.id = v.brand_id
      join public.v_vehicle_economics e on e.vehicle_id = v.id
      where d.org_id = ${ctx.org.id} and d.status in ('formalizada','entregada') and k.signed_on between ${f.from} and ${f.to} ${brandFilter(tx, f)} ${sellerFilter(tx, f)}
      order by margen desc`),
  },
  {
    key: "descuentos", title: "Descuentos otorgados", group: "Ventas", anyOf: ["deals.view_all"], usesPeriod: true,
    description: "Operaciones con descuento, porcentaje sobre lista y quién lo aprobó cuando requirió autorización.",
    columns: [{ key: "numero", label: "Operación", type: "text" }, { key: "vendedor", label: "Vendedor", type: "text" }, { key: "descuento", label: "Descuento", type: "money", currencyKey: "moneda" },
      { key: "pct", label: "% sobre lista", type: "pct" }, { key: "estado", label: "Estado", type: "text", labels: L(DEAL_STATUS) }, { key: "aprobo", label: "Aprobado por", type: "text" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      select d.number as numero, u.full_name as vendedor, d.discount_amount as descuento, d.currency as moneda,
             round(d.discount_amount * 100 / nullif(d.list_price, 0), 2) as pct, d.status as estado,
             (select du.full_name from public.approvals a join public.user_profiles du on du.id = a.decided_by where a.entity_id = d.id and a.status = 'aprobada' order by a.decided_at desc limit 1) as aprobo
      from public.deals d join public.user_profiles u on u.id = d.seller_id join public.vehicles v on v.id = d.vehicle_id
      where d.org_id = ${ctx.org.id} and d.discount_amount > 0 and d.created_at::date between ${f.from} and ${f.to} ${brandFilter(tx, f)} ${sellerFilter(tx, f)}
      order by pct desc nulls last`),
  },
  {
    key: "entregas", title: "Operaciones pendientes de entrega", group: "Ventas", anyOf: ["deals.view_all"], usesPeriod: false,
    description: "Ventas formalizadas sin entrega física registrada, con estado de cobro de la entrega inicial y documentación.",
    columns: [{ key: "numero", label: "Operación", type: "text" }, { key: "cliente", label: "Cliente", type: "text" }, { key: "unidad", label: "Unidad", type: "text" },
      { key: "formalizada", label: "Formalizada", type: "date" }, { key: "dias", label: "Días", type: "number" }, { key: "entrega_pendiente", label: "Entrega inicial pendiente", type: "money", currencyKey: "moneda" },
      { key: "documentacion", label: "Documentación", type: "text", labels: L(DOC_STATUS) }],
    run: (ctx) => ctx.db((tx) => tx`
      select d.number as numero, c.full_name as cliente, v.stock_code || ' · ' || app.vehicle_name(b.name, v.model) as unidad, d.formalized_at::date as formalizada,
             app.org_today(d.org_id) - d.formalized_at::date as dias, d.currency as moneda,
             coalesce((select sum(ib.outstanding) from public.v_installment_balances ib where ib.contract_id = k.id and ib.kind in ('entrega_inicial','entrega_usado')), 0) as entrega_pendiente,
             v.doc_status as documentacion
      from public.deals d join public.contracts k on k.deal_id = d.id join public.customers c on c.id = d.customer_id join public.vehicles v on v.id = d.vehicle_id join public.brands b on b.id = v.brand_id
      where d.org_id = ${ctx.org.id} and d.status = 'formalizada' order by d.formalized_at`),
  },
  {
    key: "deudas", title: "Deudas por antigüedad", group: "Cartera y caja", anyOf: ["collections.view"], usesPeriod: false,
    description: "Contratos vigentes con saldo: vencido, días de atraso y tramo de mora.",
    columns: [{ key: "contrato", label: "Contrato", type: "text" }, { key: "cliente", label: "Cliente", type: "text" }, { key: "tramo", label: "Tramo", type: "text" },
      { key: "dias", label: "Días de atraso", type: "number" }, { key: "saldo", label: "Saldo", type: "money", currencyKey: "moneda" }, { key: "vencido", label: "Vencido", type: "money", currencyKey: "moneda" },
      { key: "ultimo_pago", label: "Último pago", type: "date" }, { key: "responsable", label: "Responsable", type: "text" }],
    run: (ctx) => ctx.db((tx) => tx`
      select b.number as contrato, c.full_name as cliente, app.aging_bucket(b.org_id, b.max_days_overdue) as tramo, b.max_days_overdue as dias, b.currency as moneda,
             b.outstanding as saldo, b.overdue_amount as vencido, b.last_payment_on as ultimo_pago, u.full_name as responsable
      from public.v_contract_balances b join public.customers c on c.id = b.customer_id left join public.user_profiles u on u.id = coalesce(b.collector_id, c.collector_id)
      where b.org_id = ${ctx.org.id} and b.status = 'vigente' and b.outstanding > 0 order by b.max_days_overdue desc, b.overdue_amount desc`),
  },
  {
    key: "flujo", title: "Flujo de caja proyectado", group: "Cartera y caja", anyOf: ["cash.view"], usesPeriod: false, projected: true, noTotals: true,
    description: "Próximos 6 meses: cobros esperados (cuotas pendientes por vencimiento) y pagos comprometidos (facturas aprobadas por vencimiento). Es una PROYECCIÓN: supone que todo se cobra y paga en fecha. El vencido acumulado se muestra aparte.",
    columns: [{ key: "mes", label: "Mes", type: "text" }, { key: "ingresos", label: "Cobros esperados", type: "base" }, { key: "egresos", label: "Pagos comprometidos", type: "base" }, { key: "neto", label: "Neto proyectado", type: "base" }],
    run: (ctx) => ctx.db((tx) => tx`
      with m as (select (date_trunc('month', app.org_today(${ctx.org.id})) + make_interval(months => g))::date as d from generate_series(0, 5) g),
      inst as (select to_char(ib.due_date, 'YYYY-MM') as mes, ib.outstanding * coalesce(app.fx_rate(ib.org_id, ib.currency, ${ctx.org.baseCurrency}, app.org_today(ib.org_id)), 0) as v
               from public.v_installment_balances ib join public.contracts k on k.id = ib.contract_id
               where ib.org_id = ${ctx.org.id} and ib.outstanding > 0 and ib.status = 'vigente' and k.status = 'vigente' and ib.due_date >= app.org_today(ib.org_id)),
      pay as (select to_char(greatest(ib.due_date, app.org_today(ib.org_id)), 'YYYY-MM') as mes, ib.outstanding * coalesce(app.fx_rate(ib.org_id, ib.currency, ${ctx.org.baseCurrency}, app.org_today(ib.org_id)), 0) as v
              from public.v_supplier_invoice_balances ib where ib.org_id = ${ctx.org.id} and ib.status = 'aprobada' and ib.outstanding > 0)
      select 'Vencido acumulado (no incluido)' as mes,
             (select round(sum(ib.overdue_amount * coalesce(app.fx_rate(ib.org_id, ib.currency, ${ctx.org.baseCurrency}, app.org_today(ib.org_id)), 0))) from public.v_contract_balances ib where ib.org_id = ${ctx.org.id} and ib.status = 'vigente') as ingresos,
             null::numeric as egresos, null::numeric as neto, 0 as ord, null::date as d
      union all
      select to_char(m.d, 'MM/YYYY'), round(coalesce((select sum(v) from inst where inst.mes = to_char(m.d, 'YYYY-MM')), 0)),
             round(coalesce((select sum(v) from pay where pay.mes = to_char(m.d, 'YYYY-MM')), 0)),
             round(coalesce((select sum(v) from inst where inst.mes = to_char(m.d, 'YYYY-MM')), 0) - coalesce((select sum(v) from pay where pay.mes = to_char(m.d, 'YYYY-MM')), 0)), 1, m.d
      from m order by ord, d nulls first`),
  },
  {
    key: "cxp", title: "Cuentas por pagar", group: "Compras", anyOf: ["payables.view"], usesPeriod: false,
    description: "Facturas aprobadas con saldo, por vencimiento.",
    columns: [{ key: "proveedor", label: "Proveedor", type: "text" }, { key: "factura", label: "Factura", type: "text" }, { key: "vence", label: "Vence", type: "date" },
      { key: "dias_atraso", label: "Días de atraso", type: "number" }, { key: "saldo", label: "Saldo", type: "money", currencyKey: "moneda" }, { key: "registrado", label: "Pagos sin confirmar", type: "money", currencyKey: "moneda" }],
    run: (ctx) => ctx.db((tx) => tx`
      select s.name as proveedor, ib.invoice_number as factura, ib.due_date as vence, ib.days_overdue as dias_atraso, ib.currency as moneda, ib.outstanding as saldo, ib.paid_registered_pending as registrado
      from public.v_supplier_invoice_balances ib join public.suppliers s on s.id = ib.supplier_id
      where ib.org_id = ${ctx.org.id} and ib.status = 'aprobada' and ib.outstanding > 0 order by ib.due_date`),
  },
  {
    key: "tradein", title: "Trade-in", group: "Compras", anyOf: ["tradein.view"], usesPeriod: true,
    description: "Tasaciones del período: valores ofrecido/aceptado, reventa esperada y margen estimado.",
    columns: [{ key: "numero", label: "Tasación", type: "text" }, { key: "vehiculo", label: "Vehículo", type: "text" }, { key: "estado", label: "Estado", type: "text", labels: L(TRADEIN_STATUS) },
      { key: "ofrecido", label: "Ofrecido", type: "money", currencyKey: "moneda" }, { key: "aceptado", label: "Aceptado", type: "money", currencyKey: "moneda" },
      { key: "reventa", label: "Reventa esperada", type: "money", currencyKey: "moneda" }, { key: "margen", label: "Margen estimado", type: "money", currencyKey: "moneda" }],
    run: (ctx, f) => ctx.db((tx) => tx`
      select t.number as numero, t.brand_name || ' ' || t.model || ' ' || t.year_model as vehiculo, t.status as estado, t.currency as moneda,
             t.offered_value as ofrecido, t.accepted_value as aceptado, t.expected_resale_price as reventa,
             t.expected_resale_price - coalesce(t.accepted_value, t.offered_value) - t.estimated_repair_costs as margen
      from public.trade_in_appraisals t where t.org_id = ${ctx.org.id} and t.created_at::date between ${f.from} and ${f.to} order by t.created_at`),
  },
];

export function reportByKey(key: string | undefined): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Período por defecto: mes en curso. Valores inválidos se descartan. */
export function parseReportFilters(get: (k: string) => string | undefined, today: string): ReportFilters {
  const date = (v: string | undefined) => (v && isIsoDate(v) ? v : undefined);
  let from = date(get("desde")) ?? startOfMonth(today);
  let to = date(get("hasta")) ?? today;
  if (from > to) [from, to] = [to, from];
  const brand = get("marca");
  const seller = get("vendedor");
  return { from, to, brand: brand && UUID.test(brand) ? brand : undefined, seller: seller && UUID.test(seller) ? seller : undefined };
}

/** Un usuario accede al reporte si tiene reports.view y al menos un permiso del reporte. */
export function canRunReport(ctx: AppContext, r: ReportDef): boolean {
  return ctx.perms.has("reports.view") && r.anyOf.some((p) => ctx.perms.has(p));
}
