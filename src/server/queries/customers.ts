import "server-only";
import type { AppContext } from "@/server/auth/context";
import { DOC_TYPE } from "@/lib/labels";

/** Opciones de clientes visibles para el usuario (RLS aplica). */
export async function customerOptions(ctx: AppContext) {
  const rows = await ctx.db((tx) => tx<{ id: string; full_name: string; doc_type: string; doc_number: string }[]>`
    select id, full_name, doc_type, doc_number from public.customers where org_id = ${ctx.org.id} order by full_name limit 2000`);
  return rows.map((c) => ({ value: c.id, label: c.full_name, hint: `${DOC_TYPE[c.doc_type] ?? c.doc_type} ${c.doc_number}` }));
}

export interface CustomerRow {
  id: string;
  full_name: string;
  kind: string;
  doc_type: string;
  doc_number: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  customer_type: string;
  seller: string | null;
  collector: string | null;
  created_at: Date;
  deals: number;
  contracts: number;
  outstanding_base: string | null;
  overdue_base: string | null;
  max_days_overdue: number | null;
  next_action_at: string | null;
}

export async function listCustomers(ctx: AppContext, f: { q?: string; seller?: string; debt?: boolean; sort: { field: string; dir: "asc" | "desc" } }) {
  const order = { nombre: "c.full_name", alta: "c.created_at", saldo: "outstanding_base", vencido: "overdue_base" }[f.sort.field] ?? "c.full_name";
  const base = ctx.org.baseCurrency;
  return ctx.db((tx) => tx<CustomerRow[]>`
    with bal as (
      select b.customer_id,
             count(*) as contracts,
             sum(b.outstanding * coalesce(app.fx_rate(b.org_id, b.currency, ${base}, app.org_today(b.org_id)), 0)) as outstanding_base,
             sum(b.overdue_amount * coalesce(app.fx_rate(b.org_id, b.currency, ${base}, app.org_today(b.org_id)), 0)) as overdue_base,
             max(b.max_days_overdue) as max_days_overdue
      from public.v_contract_balances b
      where b.org_id = ${ctx.org.id} and b.status <> 'anulado'
      group by b.customer_id
    )
    select c.id, c.full_name, c.kind, c.doc_type, c.doc_number, c.phone, c.email, c.city, c.customer_type, c.created_at,
           s.full_name as seller, co.full_name as collector,
           (select count(*)::int from public.deals d where d.customer_id = c.id and d.status <> 'anulada') as deals,
           coalesce(bal.contracts, 0)::int as contracts,
           round(bal.outstanding_base, 0) as outstanding_base, round(bal.overdue_base, 0) as overdue_base, bal.max_days_overdue,
           (select min(x.d) from (
              select ci.next_action_at as d from public.customer_interactions ci where ci.customer_id = c.id and ci.next_action_at >= app.org_today(c.org_id)
              union all
              select o.next_action_at from public.opportunities o where o.customer_id = c.id and o.status = 'abierta'
           ) x)::text as next_action_at
    from public.customers c
    left join public.user_profiles s on s.id = c.assigned_seller_id
    left join public.user_profiles co on co.id = c.collector_id
    left join bal on bal.customer_id = c.id
    where c.org_id = ${ctx.org.id}
      ${f.q ? tx`and (c.full_name ilike ${"%" + f.q + "%"} or c.doc_normalized like ${"%" + f.q.replace(/[^0-9A-Za-z]/g, "").toUpperCase() + "%"}
                     or c.phone_normalized like ${"%" + f.q.replace(/\D/g, "") + "%"} or c.email ilike ${"%" + f.q + "%"})` : tx``}
      ${f.seller ? tx`and c.assigned_seller_id = ${f.seller}` : tx``}
      ${f.debt ? tx`and bal.overdue_base > 0` : tx``}
    order by ${tx.unsafe(order)} ${tx.unsafe(f.sort.dir === "asc" ? "asc nulls first" : "desc nulls last")}, c.full_name
    limit 500`);
}

export async function getCustomer(ctx: AppContext, id: string) {
  const [c] = await ctx.db((tx) => tx<{
    id: string; kind: string; full_name: string; doc_type: string; doc_number: string; phone: string | null; email: string | null;
    address: string | null; city: string | null; customer_type: string; source: string | null; notes: string | null;
    assigned_seller_id: string | null; seller: string | null; collector_id: string | null; collector: string | null; created_at: Date; created_by_name: string | null;
  }[]>`
    select c.*, s.full_name as seller, co.full_name as collector, cb.full_name as created_by_name
    from public.customers c
    left join public.user_profiles s on s.id = c.assigned_seller_id
    left join public.user_profiles co on co.id = c.collector_id
    left join public.user_profiles cb on cb.id = c.created_by
    where c.id = ${id} and c.org_id = ${ctx.org.id}`);
  return c ?? null;
}

export async function customerDeals(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; number: string; status: string; currency: string; sale_price: string; vehicle: string; vehicle_id: string; seller: string; created_at: Date; payment_type: string }[]>`
    select d.id, d.number, d.status, d.currency, d.sale_price, d.payment_type, b.name || ' ' || v.model || ' ' || v.year_model as vehicle, v.id as vehicle_id,
           u.full_name as seller, d.created_at
    from public.deals d join public.vehicles v on v.id = d.vehicle_id join public.brands b on b.id = v.brand_id
    join public.user_profiles u on u.id = d.seller_id
    where d.customer_id = ${id} order by d.created_at desc`);
}

export async function customerContracts(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{
    contract_id: string; number: string; currency: string; status: string; sale_price: string; outstanding: string; overdue_amount: string;
    max_days_overdue: number; next_due_date: string | null; next_due_amount: string | null; cash_collected: string; last_payment_on: string | null; unapplied_credit: string;
  }[]>`
    select b.contract_id, b.number, b.currency, b.status, b.sale_price, b.outstanding, b.overdue_amount, b.max_days_overdue,
           b.next_due_date, b.next_due_amount, b.cash_collected, b.last_payment_on, b.unapplied_credit
    from public.v_contract_balances b where b.customer_id = ${id} order by b.number desc`);
}

export async function customerPayments(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; number: string; received_on: string; method: string; currency: string; amount: string; status: string; reference: string | null; contract: string | null }[]>`
    select p.id, p.number, p.received_on, p.method, p.currency, p.amount, p.status, p.reference, c.number as contract
    from public.customer_payments p left join public.contracts c on c.id = p.contract_id
    where p.customer_id = ${id} order by p.received_on desc, p.registered_at desc limit 200`);
}

export async function customerInteractions(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; kind: "interaccion" | "cobranza"; channel: string; summary: string; result: string | null; occurred_at: Date; next_action: string | null; next_action_at: string | null; user_name: string; promise_amount: string | null; promise_currency: string | null; promise_date: string | null }[]>`
    select i.id, 'interaccion' as kind, i.channel, i.summary, null as result, i.occurred_at, i.next_action, i.next_action_at::text,
           u.full_name as user_name, null as promise_amount, null as promise_currency, null as promise_date
    from public.customer_interactions i join public.user_profiles u on u.id = i.user_id
    where i.customer_id = ${id}
    union all
    select a.id, 'cobranza', a.channel, coalesce(a.notes, ''), a.result, a.occurred_at, a.next_action, a.next_action_at::text,
           u.full_name, a.promise_amount::text, a.promise_currency, a.promise_date::text
    from public.collection_actions a join public.user_profiles u on u.id = a.user_id
    where a.customer_id = ${id}
    order by occurred_at desc limit 200`);
}

export async function customerOpportunities(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; title: string; stage: string; status: string; expected_value: string | null; currency: string; vehicle: string | null; next_action_at: string | null }[]>`
    select o.id, o.title, s.name as stage, o.status, o.expected_value, o.currency,
           case when v.id is not null then b.name || ' ' || v.model end as vehicle, o.next_action_at::text
    from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
    left join public.vehicles v on v.id = o.vehicle_id left join public.brands b on b.id = v.brand_id
    where o.customer_id = ${id} order by o.created_at desc`);
}

export async function customerDocuments(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; title: string; mime_type: string; size_bytes: string; is_restricted: boolean; uploaded_at: Date; uploaded_by: string | null }[]>`
    select d.id, d.title, d.mime_type, d.size_bytes, d.is_restricted, d.uploaded_at, u.full_name as uploaded_by
    from public.documents d left join public.user_profiles u on u.id = d.uploaded_by
    where d.entity_type = 'customer' and d.entity_id = ${id} order by d.uploaded_at desc`);
}

export async function pipelineStages(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; key: string; name: string; sort_order: number; is_won: boolean; is_lost: boolean }[]>`
    select id, key, name, sort_order, is_won, is_lost from public.pipeline_stages where org_id = ${ctx.org.id} order by sort_order`);
}

export async function listOpportunities(ctx: AppContext, sellerId?: string) {
  return ctx.db((tx) => tx<{
    id: string; title: string; stage_id: string; status: string; expected_value: string | null; currency: string; customer: string; customer_id: string;
    vehicle: string | null; vehicle_id: string | null; seller: string | null; next_action: string | null; next_action_at: string | null; updated_at: Date; days_in_stage: number;
  }[]>`
    select o.id, o.title, o.stage_id, o.status, o.expected_value, o.currency, c.full_name as customer, c.id as customer_id,
           case when v.id is not null then b.name || ' ' || v.model || ' ' || v.year_model end as vehicle, v.id as vehicle_id,
           u.full_name as seller, o.next_action, o.next_action_at::text, o.updated_at,
           (app.org_today(o.org_id) - coalesce((select max(e.occurred_at)::date from public.opportunity_stage_events e where e.opportunity_id = o.id), o.created_at::date)) as days_in_stage
    from public.opportunities o
    join public.customers c on c.id = o.customer_id
    left join public.vehicles v on v.id = o.vehicle_id left join public.brands b on b.id = v.brand_id
    left join public.user_profiles u on u.id = o.seller_id
    where o.org_id = ${ctx.org.id} and o.status = 'abierta'
      ${sellerId ? tx`and o.seller_id = ${sellerId}` : tx``}
    order by o.next_action_at nulls last, o.updated_at desc`);
}
