import "server-only";
import type { AppContext } from "@/server/auth/context";

export interface DashboardFilters {
  from: string;
  to: string;
  brand?: string;
  seller?: string;
}

/**
 * Todas las cifras se consolidan en la moneda base con el tipo de cambio:
 *   - fijado en la operación (ventas formalizadas: deals.fx_rate_to_base),
 *   - de cada coste (vehicle_costs.fx_rate_to_base),
 *   - o el último registrado a la fecha del cálculo (saldos), marcado referencial.
 */
export async function dashboardKpis(ctx: AppContext, f: DashboardFilters) {
  const base = ctx.org.baseCurrency;
  const org = ctx.org.id;
  const [r] = await ctx.db((tx) => tx<{
    stock_units: number; stock_available: number; stock_reserved: number; pending_delivery: number;
    stock_acquisition_base: string; stock_total_cost_base: string; stock_margin_base: string | null; stock_missing_price: number;
    sales_count: number; sales_amount_base: string;
    collected_base: string; receivable_base: string; overdue_base: string; overdue_contracts: number;
    payables_base: string; payables_overdue_base: string;
    closed_count: number; closed_sales_base: string; closed_margin_base: string; closed_pending_costs: number;
    missing_rate: boolean;
  }[]>`
    with today as (select app.org_today(${org}) as d),
    stock as (
      select v.*, e.total_cost_base, e.acquisition_cost_base, e.estimated_margin_base
      from public.vehicles v join public.v_vehicle_economics e on e.vehicle_id = v.id
      where v.org_id = ${org} ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``}
    ),
    sales as (
      select d.*, k.signed_on, coalesce(d.fx_rate_to_base, 1) as fx
      from public.deals d join public.contracts k on k.deal_id = d.id join public.vehicles v on v.id = d.vehicle_id
      where d.org_id = ${org} and d.status in ('formalizada','entregada')
        ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}
    ),
    balances as (
      select b.*, app.fx_rate(b.org_id, b.currency, ${base}, (select d from today)) as fx
      from public.v_contract_balances b join public.deals d on d.id = (select deal_id from public.contracts where id = b.contract_id)
      join public.vehicles v on v.id = b.vehicle_id
      where b.org_id = ${org} and b.status = 'vigente'
        ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}
    ),
    closed as (
      select s.id, s.sale_price * s.fx as sale_base,
             coalesce((select sum(vc.amount_base) from public.vehicle_costs vc where vc.vehicle_id = s.vehicle_id), 0) as cost_base,
             exists (select 1 from public.vehicle_costs vc where vc.vehicle_id = s.vehicle_id and vc.is_estimate) as pending
      from sales s
      where s.status = 'entregada' and s.delivered_at::date between ${f.from} and ${f.to}
    ),
    payables as (
      select ib.outstanding * coalesce(app.fx_rate(ib.org_id, ib.currency, ${base}, (select d from today)), 0) as out_base, ib.days_overdue
      from public.v_supplier_invoice_balances ib where ib.org_id = ${org} and ib.status = 'aprobada' and ib.outstanding > 0
      union all
      select e.amount * coalesce(app.fx_rate(e.org_id, e.currency, ${base}, (select d from today)), 0), 0
      from public.expenses e where e.org_id = ${org} and e.status = 'aprobado'
    )
    select
      (select count(*)::int from stock where commercial_status in ('disponible','reservado')) as stock_units,
      (select count(*)::int from stock where commercial_status = 'disponible') as stock_available,
      (select count(*)::int from stock where commercial_status = 'reservado') as stock_reserved,
      (select count(*)::int from stock where commercial_status = 'vendido_pendiente_entrega') as pending_delivery,
      (select coalesce(sum(acquisition_cost_base), 0) from stock where commercial_status in ('disponible','reservado')) as stock_acquisition_base,
      (select coalesce(sum(total_cost_base), 0) from stock where commercial_status in ('disponible','reservado')) as stock_total_cost_base,
      (select sum(estimated_margin_base) from stock where commercial_status in ('disponible','reservado')) as stock_margin_base,
      (select count(*)::int from stock where commercial_status in ('disponible','reservado') and estimated_margin_base is null) as stock_missing_price,
      (select count(*)::int from sales where signed_on between ${f.from} and ${f.to}) as sales_count,
      (select coalesce(sum(sale_price * fx), 0) from sales where signed_on between ${f.from} and ${f.to}) as sales_amount_base,
      (select coalesce(sum(p.amount * coalesce(app.fx_rate(p.org_id, p.currency, ${base}, p.received_on), 0)), 0)
         from public.customer_payments p
         left join public.contracts k on k.id = p.contract_id left join public.deals d on d.id = k.deal_id left join public.vehicles v on v.id = k.vehicle_id
         where p.org_id = ${org} and p.status = 'confirmado' and p.method not in ('trade_in','nota_credito')
           and p.received_on between ${f.from} and ${f.to}
           ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}) as collected_base,
      (select coalesce(sum(outstanding * coalesce(fx, 0)), 0) from balances) as receivable_base,
      (select coalesce(sum(overdue_amount * coalesce(fx, 0)), 0) from balances) as overdue_base,
      (select count(*)::int from balances where overdue_amount > 0) as overdue_contracts,
      (select coalesce(sum(out_base), 0) from payables) as payables_base,
      (select coalesce(sum(out_base) filter (where days_overdue > 0), 0) from payables) as payables_overdue_base,
      (select count(*)::int from closed) as closed_count,
      (select coalesce(sum(sale_base), 0) from closed) as closed_sales_base,
      (select coalesce(sum(sale_base - cost_base), 0) from closed) as closed_margin_base,
      (select count(*)::int from closed where pending) as closed_pending_costs,
      exists (select 1 from balances where fx is null) as missing_rate`);
  return r!;
}

export async function monthlySeries(ctx: AppContext, f: DashboardFilters, months = 12) {
  const base = ctx.org.baseCurrency;
  return ctx.db((tx) => tx<{ month: string; sales_count: number; sales_base: string; collected_base: string }[]>`
    with m as (
      select to_char((date_trunc('month', app.org_today(${ctx.org.id})) - make_interval(months => g)), 'YYYY-MM') as month
      from generate_series(0, ${months - 1}::int) g
    )
    select m.month,
      (select count(*)::int from public.contracts k join public.deals d on d.id = k.deal_id join public.vehicles v on v.id = k.vehicle_id
        where k.org_id = ${ctx.org.id} and k.status <> 'anulado' and to_char(k.signed_on, 'YYYY-MM') = m.month
          ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}) as sales_count,
      (select coalesce(round(sum(k.sale_price * coalesce(d.fx_rate_to_base, 1))), 0) from public.contracts k join public.deals d on d.id = k.deal_id join public.vehicles v on v.id = k.vehicle_id
        where k.org_id = ${ctx.org.id} and k.status <> 'anulado' and to_char(k.signed_on, 'YYYY-MM') = m.month
          ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}) as sales_base,
      (select coalesce(round(sum(p.amount * coalesce(app.fx_rate(p.org_id, p.currency, ${base}, p.received_on), 0))), 0)
        from public.customer_payments p left join public.contracts k on k.id = p.contract_id left join public.deals d on d.id = k.deal_id left join public.vehicles v on v.id = k.vehicle_id
        where p.org_id = ${ctx.org.id} and p.status = 'confirmado' and p.method not in ('trade_in','nota_credito') and to_char(p.received_on, 'YYYY-MM') = m.month
          ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}) as collected_base
    from m order by m.month`);
}

export async function inventoryByBrand(ctx: AppContext) {
  return ctx.db((tx) => tx<{ brand: string; units: number; cost_base: string }[]>`
    select b.name as brand, count(v.id)::int as units, coalesce(sum(e.total_cost_base), 0) as cost_base
    from public.brands b
    left join public.vehicles v on v.brand_id = b.id and v.commercial_status in ('disponible','reservado')
    left join public.v_vehicle_economics e on e.vehicle_id = v.id
    where b.org_id = ${ctx.org.id} and b.is_active
    group by b.name, b.sort_order order by b.sort_order, b.name`);
}

export async function inventoryAging(ctx: AppContext, brand?: string) {
  return ctx.db((tx) => tx<{ bucket: string; ord: number; units: number; cost_base: string }[]>`
    with s as (
      select e.days_in_stock, e.total_cost_base from public.vehicles v join public.v_vehicle_economics e on e.vehicle_id = v.id
      where v.org_id = ${ctx.org.id} and v.commercial_status in ('disponible','reservado') ${brand ? tx`and v.brand_id = ${brand}` : tx``}
    ), b(bucket, ord, lo, hi) as (values ('0–30 días', 1, 0, 30), ('31–60 días', 2, 31, 60), ('61–90 días', 3, 61, 90), ('91–180 días', 4, 91, 180), ('Más de 180 días', 5, 181, 100000))
    select b.bucket, b.ord, count(s.*)::int as units, coalesce(sum(s.total_cost_base), 0) as cost_base
    from b left join s on s.days_in_stock between b.lo and b.hi
    group by b.bucket, b.ord order by b.ord`);
}

/** Margen por operación (formalizadas o entregadas en el período). */
export async function marginByDeal(ctx: AppContext, f: DashboardFilters) {
  return ctx.db((tx) => tx<{ id: string; number: string; label: string; status: string; sale_base: string; cost_base: string; margin_base: string; pending: boolean }[]>`
    select d.id, d.number, app.vehicle_name(b.name, v.model) || ' · ' || c.full_name as label, d.status,
           round(d.sale_price * coalesce(d.fx_rate_to_base, 1)) as sale_base,
           coalesce((select sum(vc.amount_base) from public.vehicle_costs vc where vc.vehicle_id = d.vehicle_id), 0) as cost_base,
           round(d.sale_price * coalesce(d.fx_rate_to_base, 1)) - coalesce((select sum(vc.amount_base) from public.vehicle_costs vc where vc.vehicle_id = d.vehicle_id), 0) as margin_base,
           exists (select 1 from public.vehicle_costs vc where vc.vehicle_id = d.vehicle_id and vc.is_estimate) as pending
    from public.deals d join public.contracts k on k.deal_id = d.id
    join public.vehicles v on v.id = d.vehicle_id join public.brands b on b.id = v.brand_id join public.customers c on c.id = d.customer_id
    where d.org_id = ${ctx.org.id} and d.status in ('formalizada','entregada') and k.signed_on between ${f.from} and ${f.to}
      ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``} ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}
    order by margin_base desc limit 12`);
}

export interface AttentionItem {
  key: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  reason: string;
  amount: string | null;
  currency: string | null;
  owner: string | null;
  href: string;
  sortValue: number;
}

/** Lista priorizada de situaciones que requieren decisión. */
export async function attentionItems(ctx: AppContext, settings: { aging_alert_days: number; payables_due_soon_days: number }): Promise<AttentionItem[]> {
  const org = ctx.org.id;
  const base = ctx.org.baseCurrency;
  const items: AttentionItem[] = [];
  const has = (p: Parameters<typeof ctx.perms.has>[0]) => ctx.perms.has(p);

  if (has("collections.view")) {
    const rows = await ctx.db((tx) => tx<{ contract_id: string; number: string; customer: string; overdue_amount: string; currency: string; max_days_overdue: number; collector: string | null; overdue_base: string | null }[]>`
      select b.contract_id, b.number, c.full_name as customer, b.overdue_amount, b.currency, b.max_days_overdue, u.full_name as collector,
             b.overdue_amount * app.fx_rate(b.org_id, b.currency, ${base}, app.org_today(b.org_id)) as overdue_base
      from public.v_contract_balances b join public.customers c on c.id = b.customer_id
      left join public.user_profiles u on u.id = coalesce(b.collector_id, c.collector_id)
      where b.org_id = ${org} and b.status = 'vigente' and b.overdue_amount > 0 order by b.max_days_overdue desc`);
    for (const r of rows) {
      items.push({
        key: `mora-${r.contract_id}`, severity: r.max_days_overdue > 30 ? "critical" : "warning", category: "Cuotas vencidas",
        title: `${r.customer} · ${r.number}`, reason: `${r.max_days_overdue} días de atraso`, amount: r.overdue_amount, currency: r.currency,
        owner: r.collector ?? "Sin responsable", href: `/financiaciones/${r.contract_id}`, sortValue: Number(r.overdue_base ?? 0),
      });
    }
    const broken = await ctx.db((tx) => tx<{ id: string; customer: string; contract_id: string | null; promise_amount: string; promise_currency: string; promise_date: string; user_name: string }[]>`
      select p.id, c.full_name as customer, p.contract_id, p.promise_amount, p.promise_currency, p.promise_date::text, u.full_name as user_name
      from public.v_payment_promises p join public.customers c on c.id = p.customer_id join public.user_profiles u on u.id = p.user_id
      where p.org_id = ${org} and p.promise_status = 'incumplida' and p.promise_date >= app.org_today(${org}) - 30`);
    for (const r of broken) {
      items.push({ key: `prom-${r.id}`, severity: "critical", category: "Promesa incumplida", title: r.customer, reason: `Prometió pagar el ${r.promise_date.split("-").reverse().join("/")}`,
        amount: r.promise_amount, currency: r.promise_currency, owner: r.user_name, href: r.contract_id ? `/financiaciones/${r.contract_id}?tab=gestiones` : "/cobranzas?vista=promesas", sortValue: 1e15 });
    }
  }

  if (has("payments.confirm")) {
    const rows = await ctx.db((tx) => tx<{ n: number; total_base: string }[]>`
      select count(*)::int as n, coalesce(sum(amount * coalesce(app.fx_rate(org_id, currency, ${base}, received_on), 0)), 0) as total_base
      from public.customer_payments where org_id = ${org} and status = 'registrado'`);
    if (rows[0]!.n > 0) {
      items.push({ key: "pagos-por-confirmar", severity: "warning", category: "Pagos sin confirmar", title: `${rows[0]!.n} pago(s) informados`,
        reason: "No cuentan como cobro hasta verificarse", amount: rows[0]!.total_base, currency: base, owner: "Administración", href: "/cobranzas?vista=confirmar", sortValue: Number(rows[0]!.total_base) });
    }
  }

  const approvals = await ctx.db((tx) => tx<{ id: string; kind: string; title: string; amount: string | null; currency: string | null; requested_by: string | null; entity_type: string; entity_id: string }[]>`
    select a.id, a.kind, a.title, a.amount, a.currency, u.full_name as requested_by, a.entity_type, a.entity_id
    from public.approvals a left join public.user_profiles u on u.id = a.requested_by
    where a.org_id = ${org} and a.status = 'pendiente' and app.has_perm(a.org_id, app.approval_permission(a.kind))`);
  for (const a of approvals) {
    items.push({ key: `apr-${a.id}`, severity: "warning", category: a.kind === "descuento" || a.kind === "precio_bajo_minimo" ? "Descuento por autorizar" : "Pendiente de aprobación",
      title: a.title, reason: "Requiere su decisión", amount: a.amount, currency: a.currency, owner: a.requested_by, href: "/aprobaciones", sortValue: 5e14 });
  }

  if (has("inventory.view")) {
    const res = await ctx.db((tx) => tx<{ id: string; vehicle_id: string; label: string; customer: string; expires_at: Date; deposit_amount: string; currency: string; owner: string | null; hours: number }[]>`
      select r.id, r.vehicle_id, app.vehicle_name(b.name, v.model) || ' ' || v.stock_code as label, c.full_name as customer, r.expires_at,
             r.deposit_amount, r.currency, u.full_name as owner, extract(epoch from (r.expires_at - now())) / 3600 as hours
      from public.reservations r join public.vehicles v on v.id = r.vehicle_id join public.brands b on b.id = v.brand_id
      join public.customers c on c.id = r.customer_id left join public.user_profiles u on u.id = r.created_by
      where r.org_id = ${org} and r.status = 'activa' and r.expires_at < now() + interval '48 hours'`);
    for (const r of res) {
      items.push({ key: `res-${r.id}`, severity: "warning", category: "Reserva por expirar", title: `${r.label} · ${r.customer}`,
        reason: `Vence en ${Math.max(0, Math.round(r.hours))} h`, amount: Number(r.deposit_amount) ? r.deposit_amount : null, currency: r.currency, owner: r.owner, href: `/inventario/${r.vehicle_id}?tab=comercial`, sortValue: 1e14 });
    }
    const veh = await ctx.db((tx) => tx<{ id: string; label: string; commercial_status: string; doc_status: string; prep_status: string; days: number; owner: string | null; estimates: number; estimate_base: string; deal_days: number | null }[]>`
      select v.id, app.vehicle_name(b.name, v.model) || ' ' || v.year_model || ' · ' || v.stock_code as label, v.commercial_status, v.doc_status, v.prep_status,
             e.days_in_stock as days, u.full_name as owner,
             (select count(*)::int from public.vehicle_costs vc where vc.vehicle_id = v.id and vc.is_estimate) as estimates,
             coalesce((select sum(vc.amount_base) from public.vehicle_costs vc where vc.vehicle_id = v.id and vc.is_estimate), 0) as estimate_base,
             (select app.org_today(v.org_id) - d.formalized_at::date from public.deals d where d.vehicle_id = v.id and d.status = 'formalizada') as deal_days
      from public.vehicles v join public.brands b on b.id = v.brand_id join public.v_vehicle_economics e on e.vehicle_id = v.id
      left join public.user_profiles u on u.id = v.responsible_id
      where v.org_id = ${org} and v.commercial_status in ('disponible','reservado','vendido_pendiente_entrega')`);
    for (const v of veh) {
      if (v.commercial_status === "vendido_pendiente_entrega") {
        items.push({ key: `ent-${v.id}`, severity: (v.deal_days ?? 0) > 7 ? "warning" : "info", category: "Venta pendiente de entrega", title: v.label,
          reason: `Formalizada hace ${v.deal_days ?? 0} día(s)${v.doc_status !== "completa" ? " · documentación incompleta" : ""}`, amount: null, currency: null, owner: v.owner, href: `/inventario/${v.id}`, sortValue: 1e13 + (v.deal_days ?? 0) });
      }
      if (v.doc_status !== "completa" && v.commercial_status !== "vendido_pendiente_entrega") {
        items.push({ key: `doc-${v.id}`, severity: "info", category: "Documentación incompleta", title: v.label, reason: v.doc_status === "incompleta" ? "Faltan documentos" : "Documentación en trámite",
          amount: null, currency: null, owner: v.owner, href: `/inventario/${v.id}?tab=documentos`, sortValue: 1e12 });
      }
      if (v.days > settings.aging_alert_days && v.commercial_status !== "vendido_pendiente_entrega") {
        items.push({ key: `age-${v.id}`, severity: v.days > settings.aging_alert_days * 2 ? "critical" : "warning", category: "Inventario envejecido", title: v.label,
          reason: `${v.days} días en stock`, amount: null, currency: null, owner: v.owner, href: `/inventario/${v.id}`, sortValue: 1e12 + v.days });
      }
      if (v.estimates > 0 && has("inventory.costs.view")) {
        items.push({ key: `est-${v.id}`, severity: "info", category: "Gastos sin completar", title: v.label, reason: `${v.estimates} coste(s) estimado(s) sin factura`,
          amount: v.estimate_base, currency: base, owner: v.owner, href: `/inventario/${v.id}?tab=costes`, sortValue: Number(v.estimate_base) });
      }
    }
  }

  if (has("payables.view")) {
    const inv = await ctx.db((tx) => tx<{ id: string; supplier: string; invoice_number: string; due_date: string; outstanding: string; currency: string; days_overdue: number; days_left: number }[]>`
      select ib.id, s.name as supplier, ib.invoice_number, ib.due_date, ib.outstanding, ib.currency, ib.days_overdue, ib.due_date - app.org_today(ib.org_id) as days_left
      from public.v_supplier_invoice_balances ib join public.suppliers s on s.id = ib.supplier_id
      where ib.org_id = ${org} and ib.status = 'aprobada' and ib.outstanding > 0 and ib.due_date <= app.org_today(ib.org_id) + ${settings.payables_due_soon_days}::int`);
    for (const i of inv) {
      items.push({ key: `fac-${i.id}`, severity: i.days_overdue > 0 ? "critical" : "warning", category: i.days_overdue > 0 ? "Factura vencida" : "Factura por vencer",
        title: `${i.supplier} · ${i.invoice_number}`, reason: i.days_overdue > 0 ? `Vencida hace ${i.days_overdue} días` : i.days_left === 0 ? "Vence hoy" : `Vence en ${i.days_left} días`,
        amount: i.outstanding, currency: i.currency, owner: "Finanzas", href: `/compras/facturas/${i.id}`, sortValue: Number(i.outstanding) });
    }
  }

  if (has("cash.view")) {
    const rec = await ctx.db((tx) => tx<{ id: string; account: string; period_end: string; difference: string; currency: string; created_by: string | null }[]>`
      select r.id, a.name as account, r.period_end, r.difference, a.currency, u.full_name as created_by
      from public.reconciliations r join public.cash_accounts a on a.id = r.account_id left join public.user_profiles u on u.id = r.created_by
      where r.org_id = ${org} and r.status = 'abierta' and r.difference <> 0`);
    for (const r of rec) {
      items.push({ key: `rec-${r.id}`, severity: "critical", category: "Diferencia de conciliación", title: r.account, reason: `Al ${r.period_end.split("-").reverse().join("/")}: extracto vs sistema`,
        amount: r.difference, currency: r.currency, owner: r.created_by, href: "/caja?vista=conciliaciones", sortValue: Math.abs(Number(r.difference)) * 10 });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.sortValue - a.sortValue);
}
