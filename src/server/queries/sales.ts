import "server-only";
import type { AppContext } from "@/server/auth/context";
import type { FinancingTerms } from "@/domain/financing/deal-schedule";

export interface DealRow {
  id: string;
  number: string;
  status: string;
  payment_type: string;
  currency: "PYG" | "USD";
  list_price: string;
  discount_amount: string;
  sale_price: string;
  trade_in_value: string;
  down_payment: string;
  customer: string;
  customer_id: string;
  vehicle: string;
  vehicle_id: string;
  stock_code: string;
  seller: string;
  created_at: Date;
  formalized_at: Date | null;
  delivered_at: Date | null;
  requires_approval: boolean;
  contract_id: string | null;
}

export const DEAL_TABS = {
  activas: ["borrador", "pendiente_aprobacion", "aprobada", "formalizada"],
  borrador: ["borrador"],
  pendiente_aprobacion: ["pendiente_aprobacion"],
  aprobada: ["aprobada"],
  formalizada: ["formalizada"],
  entregada: ["entregada"],
  anulada: ["anulada"],
} as const;

export async function listDeals(ctx: AppContext, f: { tab: keyof typeof DEAL_TABS; q?: string; seller?: string }) {
  return ctx.db((tx) => tx<DealRow[]>`
    select d.id, d.number, d.status, d.payment_type, d.currency, d.list_price, d.discount_amount, d.sale_price, d.trade_in_value,
           d.down_payment, c.full_name as customer, c.id as customer_id, app.vehicle_name(b.name, v.model) || ' ' || v.year_model as vehicle,
           v.id as vehicle_id, v.stock_code, u.full_name as seller, d.created_at, d.formalized_at, d.delivered_at, d.requires_approval,
           k.id as contract_id
    from public.deals d
    join public.customers c on c.id = d.customer_id
    join public.vehicles v on v.id = d.vehicle_id
    join public.brands b on b.id = v.brand_id
    join public.user_profiles u on u.id = d.seller_id
    left join public.contracts k on k.deal_id = d.id
    where d.org_id = ${ctx.org.id} and d.status = any(${[...DEAL_TABS[f.tab]]})
      ${f.q ? tx`and (d.number ilike ${"%" + f.q + "%"} or c.full_name ilike ${"%" + f.q + "%"} or v.model ilike ${"%" + f.q + "%"} or v.stock_code ilike ${"%" + f.q + "%"})` : tx``}
      ${f.seller ? tx`and d.seller_id = ${f.seller}` : tx``}
    order by d.created_at desc
    limit 300`);
}

export async function dealCounts(ctx: AppContext) {
  const rows = await ctx.db((tx) => tx<{ status: string; n: number }[]>`
    select status, count(*)::int as n from public.deals where org_id = ${ctx.org.id} group by status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function getDeal(ctx: AppContext, id: string) {
  const [d] = await ctx.db((tx) => tx<(DealRow & {
    seller_id: string; opportunity_id: string | null; trade_in_appraisal_id: string | null; financing_terms: FinancingTerms | null;
    approval_reason: string | null; fx_rate_to_base: string | null; notes: string | null; cancel_reason: string | null; cancelled_at: Date | null;
    delivery_scheduled_on: string | null; customer_phone: string | null; customer_doc: string; customer_doc_type: string; customer_email: string | null;
    vehicle_version: string | null; vehicle_year: number; vehicle_km: number; vehicle_color: string | null; vehicle_vin: string | null;
    vehicle_condition: string; brand: string; model: string; vehicle_min_price: string | null; vehicle_price_currency: string; vehicle_list_price: string | null;
    vehicle_commercial_status: string; appraisal_number: string | null; appraisal_label: string | null; contract_number: string | null; contract_status: string | null;
  })[]>`
    select d.*, c.full_name as customer, c.id as customer_id, c.phone as customer_phone, c.doc_number as customer_doc,
           c.doc_type as customer_doc_type, c.email as customer_email,
           app.vehicle_name(b.name, v.model) || ' ' || v.year_model as vehicle, b.name as brand, v.model, v.version as vehicle_version,
           v.year_model as vehicle_year, v.mileage_km as vehicle_km, v.color as vehicle_color, v.vin as vehicle_vin, v.condition as vehicle_condition,
           v.stock_code, v.min_price as vehicle_min_price, v.price_currency as vehicle_price_currency, v.list_price as vehicle_list_price,
           v.commercial_status as vehicle_commercial_status,
           u.full_name as seller, k.id as contract_id, k.number as contract_number, k.status as contract_status,
           t.number as appraisal_number, t.brand_name || ' ' || t.model || ' ' || t.year_model as appraisal_label
    from public.deals d
    join public.customers c on c.id = d.customer_id
    join public.vehicles v on v.id = d.vehicle_id
    join public.brands b on b.id = v.brand_id
    join public.user_profiles u on u.id = d.seller_id
    left join public.contracts k on k.deal_id = d.id
    left join public.trade_in_appraisals t on t.id = d.trade_in_appraisal_id
    where d.id = ${id} and d.org_id = ${ctx.org.id}`);
  return d ?? null;
}

export async function dealEvents(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: number; event: string; details: Record<string, unknown>; actor: string | null; occurred_at: Date }[]>`
    select e.id, e.event, e.details, u.full_name as actor, e.occurred_at
    from public.deal_events e left join public.user_profiles u on u.id = e.actor_id
    where e.deal_id = ${id} order by e.occurred_at, e.id`);
}

export async function dealApprovals(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; kind: string; status: string; reason: string | null; requested_by: string | null; requested_at: Date; decided_by: string | null; decided_at: Date | null; decision_note: string | null }[]>`
    select a.id, a.kind, a.status, a.reason, r.full_name as requested_by, a.requested_at, d.full_name as decided_by, a.decided_at, a.decision_note
    from public.approvals a left join public.user_profiles r on r.id = a.requested_by left join public.user_profiles d on d.id = a.decided_by
    where a.entity_id = ${id} order by a.requested_at desc`);
}

/** Tasaciones utilizables como trade-in (aprobadas, aceptadas o adquiridas y no usadas en otra venta activa). */
export async function tradeInOptions(ctx: AppContext, excludeDealId?: string) {
  return ctx.db((tx) => tx<{ id: string; customer_id: string; number: string; label: string; currency: "PYG" | "USD"; offered_value: string; accepted_value: string | null; status: string }[]>`
    select t.id, t.customer_id, t.number, t.brand_name || ' ' || t.model || ' ' || t.year_model as label, t.currency,
           t.offered_value, t.accepted_value, t.status
    from public.trade_in_appraisals t
    where t.org_id = ${ctx.org.id} and t.status in ('aprobada','aceptada_cliente','adquirida')
      and not exists (select 1 from public.deals d where d.trade_in_appraisal_id = t.id and d.status <> 'anulada'
                      ${excludeDealId ? tx`and d.id <> ${excludeDealId}` : tx``})
    order by t.created_at desc`);
}

export async function vehicleCostLines(ctx: AppContext, vehicleId: string) {
  return ctx.db((tx) => tx<{ amount_base: string; is_estimate: boolean }[]>`
    select amount_base, is_estimate from public.vehicle_costs where vehicle_id = ${vehicleId}`);
}
