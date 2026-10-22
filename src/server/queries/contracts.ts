import "server-only";
import type { AppContext } from "@/server/auth/context";

export interface ContractListRow {
  contract_id: string;
  number: string;
  customer: string;
  customer_id: string;
  vehicle: string;
  currency: "PYG" | "USD";
  status: string;
  signed_on: string;
  sale_price: string;
  financed_amount: string;
  total_due: string;
  cash_collected: string;
  outstanding: string;
  overdue_amount: string;
  max_days_overdue: number;
  next_due_date: string | null;
  next_due_amount: string | null;
  last_payment_on: string | null;
  collector: string | null;
  bucket: string | null;
}

export async function listContracts(ctx: AppContext, f: { q?: string; status?: string; bucket?: string }) {
  return ctx.db((tx) => tx<ContractListRow[]>`
    select b.contract_id, b.number, c.full_name as customer, c.id as customer_id, app.vehicle_name(br.name, v.model) || ' ' || v.year_model as vehicle,
           b.currency, b.status, k.signed_on, b.sale_price, b.financed_amount, b.total_due, b.cash_collected, b.outstanding,
           b.overdue_amount, b.max_days_overdue, b.next_due_date, b.next_due_amount, b.last_payment_on,
           u.full_name as collector, app.aging_bucket(b.org_id, b.max_days_overdue) as bucket
    from public.v_contract_balances b
    join public.contracts k on k.id = b.contract_id
    join public.customers c on c.id = b.customer_id
    join public.vehicles v on v.id = b.vehicle_id join public.brands br on br.id = v.brand_id
    left join public.user_profiles u on u.id = coalesce(b.collector_id, c.collector_id)
    where b.org_id = ${ctx.org.id}
      ${f.status ? tx`and b.status = ${f.status}` : tx`and b.status <> 'anulado'`}
      ${f.q ? tx`and (b.number ilike ${"%" + f.q + "%"} or c.full_name ilike ${"%" + f.q + "%"})` : tx``}
      ${f.bucket ? tx`and app.aging_bucket(b.org_id, b.max_days_overdue) = ${f.bucket}` : tx``}
    order by k.signed_on desc, b.number desc
    limit 500`);
}

export async function getContract(ctx: AppContext, id: string) {
  const [c] = await ctx.db((tx) => tx<(ContractListRow & {
    org_id: string; deal_id: string; deal_number: string; vehicle_id: string; stock_code: string; trade_in_value: string; down_payment: string;
    current_version: number; collector_id: string | null; unapplied_credit: string; ledger_balance: string; total_interest: string;
    total_applied: string; overdue_installments: number; customer_phone: string | null; seller: string;
  })[]>`
    select b.*, k.signed_on, k.deal_id, d.number as deal_number, k.trade_in_value, k.down_payment, k.current_version, k.vehicle_id,
           c.full_name as customer, c.id as customer_id, c.phone as customer_phone, v.stock_code,
           app.vehicle_name(br.name, v.model) || ' ' || v.year_model as vehicle, u.full_name as collector, s.full_name as seller,
           app.aging_bucket(b.org_id, b.max_days_overdue) as bucket
    from public.v_contract_balances b
    join public.contracts k on k.id = b.contract_id
    left join public.deals d on d.id = k.deal_id
    left join public.user_profiles s on s.id = d.seller_id
    join public.customers c on c.id = b.customer_id
    join public.vehicles v on v.id = b.vehicle_id join public.brands br on br.id = v.brand_id
    left join public.user_profiles u on u.id = b.collector_id
    where b.contract_id = ${id} and b.org_id = ${ctx.org.id}`);
  return c ?? null;
}

export async function contractInstallments(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{
    id: string; seq: number; kind: string; description: string | null; due_date: string; principal: string; interest: string; fee: string;
    amount: string; amount_cancelled: string; amount_applied: string; outstanding: string; payment_state: string; days_overdue: number; status: string;
  }[]>`
    select id, seq, kind, description, due_date, principal, interest, fee, amount, amount_cancelled, amount_applied, outstanding,
           payment_state, days_overdue, status
    from public.v_installment_balances where contract_id = ${id} order by seq`);
}

export async function contractLedger(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: number; entry_date: string; kind: string; description: string; debit: string; credit: string; balance: string; created_by: string | null; created_at: Date }[]>`
    select e.id, e.entry_date, e.kind, e.description, e.debit, e.credit,
           sum(e.debit - e.credit) over (order by e.entry_date, e.id) as balance,
           u.full_name as created_by, e.created_at
    from public.contract_ledger_entries e left join public.user_profiles u on u.id = e.created_by
    where e.contract_id = ${id} order by e.entry_date, e.id`);
}

export async function contractPayments(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{
    id: string; number: string; received_on: string; method: string; currency: string; amount: string; amount_contract: string | null;
    fx_rate_to_contract: string | null; status: string; reference: string | null; notes: string | null; account: string | null;
    registered_by: string | null; confirmed_by: string | null; confirmed_at: Date | null; applied: string; reversal_reason: string | null;
  }[]>`
    select p.id, p.number, p.received_on, p.method, p.currency, p.amount, p.amount_contract, p.fx_rate_to_contract, p.status, p.reference, p.notes,
           a.name as account, r.full_name as registered_by, cf.full_name as confirmed_by, p.confirmed_at,
           coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0) as applied,
           (select pr.reason from public.payment_reversals pr where pr.payment_id = p.id) as reversal_reason
    from public.customer_payments p
    left join public.cash_accounts a on a.id = p.cash_account_id
    left join public.user_profiles r on r.id = p.registered_by
    left join public.user_profiles cf on cf.id = p.confirmed_by
    where p.contract_id = ${id}
    order by p.received_on desc, p.registered_at desc`);
}

export async function contractAllocations(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ installment_id: string; payment_number: string; amount: string; created_at: Date; reversal: boolean }[]>`
    select pa.installment_id, p.number as payment_number, pa.amount, pa.created_at, pa.reversal_id is not null as reversal
    from public.payment_allocations pa join public.customer_payments p on p.id = pa.payment_id
    join public.installments i on i.id = pa.installment_id
    where i.contract_id = ${id} order by pa.created_at`);
}

export async function contractVersions(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ version_no: number; reason: string; created_at: Date; created_by: string | null; method: string | null; principal: string | null; term_months: number | null; rate_input: string | null; rate_convention: string | null; total_interest: string | null }[]>`
    select cv.version_no, cv.reason, cv.created_at, u.full_name as created_by, fp.method, fp.principal, fp.term_months, fp.rate_input,
           fp.rate_convention, fp.total_interest
    from public.contract_versions cv left join public.financing_plans fp on fp.id = cv.financing_plan_id
    left join public.user_profiles u on u.id = cv.created_by
    where cv.contract_id = ${id} order by cv.version_no desc`);
}

export async function contractConsistency(ctx: AppContext, id: string) {
  const [r] = await ctx.db((tx) => tx<{ ledger_balance: string; installments_outstanding: string; unapplied_credit: string; consistent: boolean }[]>`
    select * from public.rpc_contract_consistency(${id})`);
  return r ?? null;
}

export async function contractPendingApprovals(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; kind: string; amount: string | null; currency: string | null; reason: string | null; requested_at: Date; requested_by: string | null }[]>`
    select a.id, a.kind, a.amount, a.currency, a.reason, a.requested_at, u.full_name as requested_by
    from public.approvals a left join public.user_profiles u on u.id = a.requested_by
    where a.entity_id = ${id} and a.status = 'pendiente' order by a.requested_at`);
}
