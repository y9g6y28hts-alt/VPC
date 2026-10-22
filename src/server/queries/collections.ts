import "server-only";
import type { AppContext } from "@/server/auth/context";

export interface PortfolioRow {
  contract_id: string;
  number: string;
  customer: string;
  customer_id: string;
  customer_phone: string | null;
  vehicle: string;
  currency: "PYG" | "USD";
  total_due: string;
  total_applied: string;
  cash_collected: string;
  outstanding: string;
  overdue_amount: string;
  next_due_date: string | null;
  next_due_amount: string | null;
  max_days_overdue: number;
  last_payment_on: string | null;
  collector: string | null;
  collector_id: string | null;
  bucket: string;
  overdue_base: string | null;
  broken_promises: number;
  pending_promise_date: string | null;
  next_action_at: string | null;
  last_action_at: Date | null;
}

const SORTS: Record<string, string> = {
  vencido: "overdue_base",
  dias: "b.max_days_overdue",
  proximo: "b.next_due_date",
  saldo: "outstanding_base",
  cliente: "c.full_name",
};
export const PORTFOLIO_SORTS = Object.keys(SORTS);

export async function portfolio(ctx: AppContext, f: { sort: { field: string; dir: "asc" | "desc" }; bucket?: string; collector?: string; q?: string; onlyOverdue?: boolean }) {
  const base = ctx.org.baseCurrency;
  const order = SORTS[f.sort.field] ?? "overdue_base";
  return ctx.db((tx) => tx<PortfolioRow[]>`
    select b.contract_id, b.number, c.full_name as customer, c.id as customer_id, c.phone as customer_phone,
           br.name || ' ' || v.model || ' ' || v.year_model as vehicle, b.currency, b.total_due, b.total_applied, b.cash_collected,
           b.outstanding, b.overdue_amount, b.next_due_date, b.next_due_amount, b.max_days_overdue, b.last_payment_on,
           u.full_name as collector, coalesce(b.collector_id, c.collector_id) as collector_id,
           app.aging_bucket(b.org_id, b.max_days_overdue) as bucket,
           round(b.overdue_amount * app.fx_rate(b.org_id, b.currency, ${base}, app.org_today(b.org_id)), 0) as overdue_base,
           round(b.outstanding * app.fx_rate(b.org_id, b.currency, ${base}, app.org_today(b.org_id)), 0) as outstanding_base,
           (select count(*)::int from public.v_payment_promises p where p.contract_id = b.contract_id and p.promise_status = 'incumplida'
              and p.occurred_at > coalesce((select max(p2.received_on) from public.customer_payments p2 where p2.contract_id = b.contract_id and p2.status = 'confirmado'), '-infinity'::date)) as broken_promises,
           (select min(p.promise_date)::text from public.v_payment_promises p where p.contract_id = b.contract_id and p.promise_status = 'pendiente') as pending_promise_date,
           (select min(a.next_action_at)::text from public.collection_actions a where a.contract_id = b.contract_id and a.next_action_at is not null
              and a.occurred_at = (select max(a2.occurred_at) from public.collection_actions a2 where a2.contract_id = b.contract_id)) as next_action_at,
           (select max(a.occurred_at) from public.collection_actions a where a.contract_id = b.contract_id) as last_action_at
    from public.v_contract_balances b
    join public.customers c on c.id = b.customer_id
    join public.vehicles v on v.id = b.vehicle_id join public.brands br on br.id = v.brand_id
    left join public.user_profiles u on u.id = coalesce(b.collector_id, c.collector_id)
    where b.org_id = ${ctx.org.id} and b.status = 'vigente' and b.outstanding > 0
      ${f.onlyOverdue ? tx`and b.overdue_amount > 0` : tx``}
      ${f.bucket ? tx`and app.aging_bucket(b.org_id, b.max_days_overdue) = ${f.bucket}` : tx``}
      ${f.collector === "sin" ? tx`and coalesce(b.collector_id, c.collector_id) is null` : f.collector ? tx`and coalesce(b.collector_id, c.collector_id) = ${f.collector}` : tx``}
      ${f.q ? tx`and (c.full_name ilike ${"%" + f.q + "%"} or b.number ilike ${"%" + f.q + "%"})` : tx``}
    order by ${tx.unsafe(order)} ${tx.unsafe(f.sort.dir === "asc" ? "asc nulls last" : "desc nulls last")}, b.number
    limit 1000`);
}

export interface CollectionKpis {
  currency: "PYG" | "USD";
  contracts: number;
  outstanding: string;
  overdue: string;
  customers_overdue: number;
  collected_month: string;
}

/** Indicadores por moneda (sin mezclar). */
export async function collectionKpis(ctx: AppContext): Promise<CollectionKpis[]> {
  return ctx.db((tx) => tx<CollectionKpis[]>`
    with b as (select * from public.v_contract_balances where org_id = ${ctx.org.id} and status = 'vigente')
    select cur.code as currency,
           (select count(*)::int from b where b.currency = cur.code and b.outstanding > 0) as contracts,
           coalesce((select sum(outstanding) from b where b.currency = cur.code), 0) as outstanding,
           coalesce((select sum(overdue_amount) from b where b.currency = cur.code), 0) as overdue,
           (select count(distinct customer_id)::int from b where b.currency = cur.code and overdue_amount > 0) as customers_overdue,
           coalesce((select sum(p.amount_contract) from public.customer_payments p
                     where p.org_id = ${ctx.org.id} and p.contract_currency = cur.code and p.status = 'confirmado'
                       and p.method not in ('trade_in','nota_credito')
                       and p.received_on >= date_trunc('month', app.org_today(${ctx.org.id}))::date), 0) as collected_month
    from public.currencies cur
    order by cur.code = ${ctx.org.baseCurrency} desc`);
}

/** Distribución por tramo de mora (importe vencido por tramo, por moneda). */
export async function agingDistribution(ctx: AppContext) {
  return ctx.db((tx) => tx<{ label: string; sort_order: number; currency: string; contracts: number; overdue: string; outstanding: string }[]>`
    select ab.label, ab.sort_order, b.currency, count(b.contract_id)::int as contracts,
           coalesce(sum(b.overdue_amount), 0) as overdue, coalesce(sum(b.outstanding), 0) as outstanding
    from public.aging_buckets ab
    left join public.v_contract_balances b on b.org_id = ab.org_id and b.status = 'vigente' and b.outstanding > 0
      and b.max_days_overdue >= ab.min_days and (ab.max_days is null or b.max_days_overdue <= ab.max_days)
    where ab.org_id = ${ctx.org.id}
    group by ab.label, ab.sort_order, b.currency
    order by ab.sort_order`);
}

export async function promisesList(ctx: AppContext, status?: string) {
  return ctx.db((tx) => tx<{ id: string; customer: string; customer_id: string; contract: string | null; contract_id: string | null; promise_amount: string; promise_currency: string; promise_date: string; promise_status: string; paid_since_promise: string; user_name: string; occurred_at: Date }[]>`
    select p.id, c.full_name as customer, c.id as customer_id, k.number as contract, k.id as contract_id, p.promise_amount, p.promise_currency,
           p.promise_date::text, p.promise_status, p.paid_since_promise, u.full_name as user_name, p.occurred_at
    from public.v_payment_promises p
    join public.customers c on c.id = p.customer_id
    left join public.contracts k on k.id = p.contract_id
    join public.user_profiles u on u.id = p.user_id
    where p.org_id = ${ctx.org.id} ${status ? tx`and p.promise_status = ${status}` : tx``}
    order by case p.promise_status when 'incumplida' then 0 when 'pendiente' then 1 else 2 end, p.promise_date
    limit 300`);
}

export async function paymentsToConfirm(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; number: string; customer: string; customer_id: string; contract: string | null; contract_id: string | null; reservation: string | null; received_on: string; method: string; currency: string; amount: string; reference: string | null; account: string | null; registered_by: string | null; registered_at: Date }[]>`
    select p.id, p.number, c.full_name as customer, c.id as customer_id, k.number as contract, k.id as contract_id, r.number as reservation,
           p.received_on, p.method, p.currency, p.amount, p.reference, a.name as account, u.full_name as registered_by, p.registered_at
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.contracts k on k.id = p.contract_id
    left join public.reservations r on r.id = p.reservation_id
    left join public.cash_accounts a on a.id = p.cash_account_id
    left join public.user_profiles u on u.id = p.registered_by
    where p.org_id = ${ctx.org.id} and p.status = 'registrado'
    order by p.received_on, p.registered_at`);
}

/**
 * Morosidad histórica: importe vencido al cierre de cada mes, reconstruido desde
 * cuotas y aplicaciones (fecha efectiva = fecha de cobro del pago o de su
 * reversión). Las bajas por refinanciación se consideran desde su registro.
 * Convertido a moneda base con el tipo de cambio vigente en cada cierre.
 */
export async function overdueHistory(ctx: AppContext, months = 12) {
  const base = ctx.org.baseCurrency;
  return ctx.db((tx) => tx<{ month: string; overdue_base: string; outstanding_base: string }[]>`
    with months as (
      select (date_trunc('month', app.org_today(${ctx.org.id})) - make_interval(months => g))::date as m_start
      from generate_series(0, ${months - 1}) g
    ),
    cutoffs as (
      select m_start, least((m_start + interval '1 month - 1 day')::date, app.org_today(${ctx.org.id})) as cut from months
    )
    select to_char(co.m_start, 'YYYY-MM') as month,
           coalesce(round(sum(
             case when i.due_date < co.cut then
               (i.amount - case when i.status = 'reemplazada' then i.amount_cancelled else 0 end
                - coalesce((select sum(pa.amount) from public.payment_allocations pa
                            join public.customer_payments p on p.id = pa.payment_id
                            left join public.payment_reversals pr on pr.id = pa.reversal_id
                            where pa.installment_id = i.id and coalesce(pr.reversed_at::date, p.received_on) <= co.cut), 0))
             else 0 end * app.fx_rate(i.org_id, i.currency, ${base}, co.cut)
           ) filter (where k.signed_on <= co.cut), 0), 0) as overdue_base,
           coalesce(round(sum(
               (i.amount - case when i.status = 'reemplazada' then i.amount_cancelled else 0 end
                - coalesce((select sum(pa.amount) from public.payment_allocations pa
                            join public.customer_payments p on p.id = pa.payment_id
                            left join public.payment_reversals pr on pr.id = pa.reversal_id
                            where pa.installment_id = i.id and coalesce(pr.reversed_at::date, p.received_on) <= co.cut), 0))
               * app.fx_rate(i.org_id, i.currency, ${base}, co.cut)
           ) filter (where k.signed_on <= co.cut and i.created_at::date <= co.cut), 0), 0) as outstanding_base
    from cutoffs co
    cross join public.installments i
    join public.contracts k on k.id = i.contract_id and k.status <> 'anulado'
    where i.org_id = ${ctx.org.id}
    group by co.m_start
    order by co.m_start`);
}
