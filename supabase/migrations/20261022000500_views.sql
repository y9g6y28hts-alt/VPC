-- =============================================================================
-- Da Silva OS — Numeración automática y vistas de saldos
-- Todas las vistas usan security_invoker: respetan el RLS de las tablas base.
-- Los saldos se calculan siempre desde cuotas y aplicaciones; no se almacenan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numeración automática: before insert, si number/stock_code viene vacío.
-- TG_ARGV[0] = columna, [1] = tipo de secuencia, [2] = prefijo
-- -----------------------------------------------------------------------------
create or replace function app.assign_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_col text := tg_argv[0];
  v_cur text := to_jsonb(new) ->> v_col;
begin
  if v_cur is null or btrim(v_cur) = '' then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, app.next_number(new.org_id, tg_argv[1], tg_argv[2])));
  end if;
  return new;
end $$;

create trigger vehicles_number            before insert on public.vehicles            for each row execute function app.assign_number('stock_code', 'vehicle', 'U');
create trigger deals_number               before insert on public.deals               for each row execute function app.assign_number('number', 'deal', 'V');
create trigger reservations_number        before insert on public.reservations        for each row execute function app.assign_number('number', 'reservation', 'R');
create trigger contracts_number           before insert on public.contracts           for each row execute function app.assign_number('number', 'contract', 'C');
create trigger customer_payments_number   before insert on public.customer_payments   for each row execute function app.assign_number('number', 'payment', 'P');
create trigger trade_in_number            before insert on public.trade_in_appraisals for each row execute function app.assign_number('number', 'trade_in', 'T');
create trigger proposals_number           before insert on public.proposals           for each row execute function app.assign_number('number', 'proposal', 'PR');
create trigger expenses_number            before insert on public.expenses            for each row execute function app.assign_number('number', 'expense', 'G');

-- Las columnas number son NOT NULL; el trigger las completa. Se admite NULL en
-- el INSERT quitando el NOT NULL de la verificación inicial: los triggers BEFORE
-- se ejecutan antes de comprobar NOT NULL, así que no hace falta cambiar nada.

-- -----------------------------------------------------------------------------
-- Saldos por cuota
-- -----------------------------------------------------------------------------
create or replace view public.v_installment_balances
with (security_invoker = true) as
select
  i.id,
  i.org_id,
  i.contract_id,
  i.plan_id,
  i.seq,
  i.kind,
  i.description,
  i.due_date,
  i.currency,
  i.principal,
  i.interest,
  i.fee,
  i.amount,
  i.amount_cancelled,
  i.status,
  coalesce(a.applied, 0)                                   as amount_applied,
  i.amount - i.amount_cancelled - coalesce(a.applied, 0)   as outstanding,
  a.last_applied_at,
  case
    when i.amount - i.amount_cancelled - coalesce(a.applied, 0) = 0 then
      case when i.status = 'reemplazada' then 'reemplazada' else 'pagada' end
    when coalesce(a.applied, 0) > 0 then 'parcial'
    else 'pendiente'
  end                                                      as payment_state,
  case
    when i.amount - i.amount_cancelled - coalesce(a.applied, 0) > 0 and i.due_date < app.org_today(i.org_id)
    then app.org_today(i.org_id) - i.due_date
    else 0
  end                                                      as days_overdue
from public.installments i
left join lateral (
  select sum(pa.amount) as applied, max(pa.created_at) as last_applied_at
  from public.payment_allocations pa
  where pa.installment_id = i.id
) a on true;

comment on view public.v_installment_balances is
  'Saldo por cuota. outstanding = importe − cancelado por refinanciación − aplicaciones netas de pagos CONFIRMADOS. '
  'Una cuota con saldo 0 nunca figura como vencida.';

-- -----------------------------------------------------------------------------
-- Saldos por contrato (base de la cartera y de la mora)
-- -----------------------------------------------------------------------------
create or replace view public.v_contract_balances
with (security_invoker = true) as
with inst as (
  select contract_id,
         sum(amount - amount_cancelled)                                   as total_due,
         sum(amount_applied)                                              as total_applied,
         sum(outstanding)                                                 as outstanding,
         sum(outstanding) filter (where days_overdue > 0)                 as overdue_amount,
         max(days_overdue)                                                as max_days_overdue,
         count(*) filter (where days_overdue > 0)                         as overdue_installments,
         min(due_date) filter (where outstanding > 0 and days_overdue = 0) as next_due_date,
         sum(interest) filter (where status = 'vigente')                  as total_interest
  from public.v_installment_balances
  group by contract_id
),
pay as (
  select p.contract_id,
         sum(p.amount_contract) filter (where p.status = 'confirmado' and p.method not in ('trade_in','nota_credito')) as cash_collected,
         sum(p.amount_contract) filter (where p.status = 'confirmado')                                                as credits_confirmed,
         max(p.received_on)     filter (where p.status = 'confirmado' and p.method not in ('trade_in','nota_credito')) as last_payment_on
  from public.customer_payments p
  where p.contract_id is not null
  group by p.contract_id
),
alloc as (
  select p.contract_id, sum(pa.amount) as applied_from_confirmed
  from public.payment_allocations pa
  join public.customer_payments p on p.id = pa.payment_id
  where p.status = 'confirmado'
  group by p.contract_id
),
led as (
  select contract_id, sum(debit) - sum(credit) as ledger_balance
  from public.contract_ledger_entries
  group by contract_id
)
select
  c.id                                         as contract_id,
  c.org_id,
  c.number,
  c.customer_id,
  c.vehicle_id,
  c.currency,
  c.status,
  c.collector_id,
  c.sale_price,
  c.financed_amount,
  coalesce(inst.total_due, 0)                  as total_due,
  coalesce(inst.total_interest, 0)             as total_interest,
  coalesce(inst.total_applied, 0)              as total_applied,
  coalesce(inst.outstanding, 0)                as outstanding,
  coalesce(inst.overdue_amount, 0)             as overdue_amount,
  coalesce(inst.max_days_overdue, 0)           as max_days_overdue,
  coalesce(inst.overdue_installments, 0)       as overdue_installments,
  inst.next_due_date,
  (select vb.outstanding from public.v_installment_balances vb
    where vb.contract_id = c.id and vb.due_date = inst.next_due_date and vb.outstanding > 0
    order by vb.seq limit 1)                   as next_due_amount,
  coalesce(pay.cash_collected, 0)              as cash_collected,
  pay.last_payment_on,
  coalesce(pay.credits_confirmed, 0) - coalesce(alloc.applied_from_confirmed, 0) as unapplied_credit,
  coalesce(led.ledger_balance, 0)              as ledger_balance
from public.contracts c
left join inst  on inst.contract_id = c.id
left join pay   on pay.contract_id = c.id
left join alloc on alloc.contract_id = c.id
left join led   on led.contract_id = c.id;

comment on view public.v_contract_balances is
  'Cartera por contrato. Invariante verificada por pruebas: ledger_balance = outstanding − unapplied_credit.';

-- Tramo de mora configurable para una cantidad de días.
create or replace function app.aging_bucket(p_org uuid, p_days integer)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select label from public.aging_buckets
  where org_id = p_org and p_days >= min_days and (max_days is null or p_days <= max_days)
  order by sort_order limit 1
$$;

-- -----------------------------------------------------------------------------
-- Promesas de pago y su cumplimiento (NO son cobros)
-- -----------------------------------------------------------------------------
create or replace view public.v_payment_promises
with (security_invoker = true) as
select
  ca.id,
  ca.org_id,
  ca.customer_id,
  ca.contract_id,
  ca.user_id,
  ca.occurred_at,
  ca.promise_amount,
  ca.promise_currency,
  ca.promise_date,
  coalesce(paid.amount, 0) as paid_since_promise,
  case
    when coalesce(paid.amount, 0) >= ca.promise_amount then 'cumplida'
    when ca.promise_date < app.org_today(ca.org_id) then 'incumplida'
    else 'pendiente'
  end as promise_status
from public.collection_actions ca
left join lateral (
  select sum(case when p.currency = ca.promise_currency then p.amount
                  when p.contract_currency = ca.promise_currency then p.amount_contract
                  else 0 end) as amount
  from public.customer_payments p
  where p.customer_id = ca.customer_id
    and (ca.contract_id is null or p.contract_id = ca.contract_id)
    and p.status = 'confirmado'
    and p.method not in ('trade_in','nota_credito')
    and p.received_on between ca.occurred_at::date and ca.promise_date
) paid on true
where ca.result = 'promesa_pago';

-- -----------------------------------------------------------------------------
-- Economía por unidad. Los costes se ocultan (NULL) a quien no tiene
-- inventory.costs.view, para no mostrar márgenes falsos con coste cero.
-- -----------------------------------------------------------------------------
create or replace view public.v_vehicle_economics
with (security_invoker = true) as
select
  v.id                          as vehicle_id,
  v.org_id,
  v.price_currency,
  v.list_price,
  o.base_currency,
  app.fx_rate(v.org_id, v.price_currency, o.base_currency, app.org_today(v.org_id)) as price_fx_rate,
  case when app.has_perm(v.org_id, 'inventory.costs.view') then coalesce(c.total_base, 0) end      as total_cost_base,
  case when app.has_perm(v.org_id, 'inventory.costs.view') then coalesce(c.registered_base, 0) end as registered_cost_base,
  case when app.has_perm(v.org_id, 'inventory.costs.view') then coalesce(c.estimated_base, 0) end  as estimated_cost_base,
  case when app.has_perm(v.org_id, 'inventory.costs.view') then coalesce(c.acquisition_base, 0) end as acquisition_cost_base,
  case when app.has_perm(v.org_id, 'inventory.costs.view') then
    app.round_money(v.list_price * app.fx_rate(v.org_id, v.price_currency, o.base_currency, app.org_today(v.org_id)), o.base_currency)
    - coalesce(c.total_base, 0)
  end                                                                                              as estimated_margin_base,
  app.org_today(v.org_id) - coalesce(v.acquisition_date, v.created_at::date)                       as days_in_stock
from public.vehicles v
join public.organizations o on o.id = v.org_id
left join lateral (
  select sum(vc.amount_base)                                       as total_base,
         sum(vc.amount_base) filter (where not vc.is_estimate)     as registered_base,
         sum(vc.amount_base) filter (where vc.is_estimate)         as estimated_base,
         sum(vc.amount_base) filter (where vc.kind = 'adquisicion') as acquisition_base
  from public.vehicle_costs vc where vc.vehicle_id = v.id
) c on true;

comment on view public.v_vehicle_economics is
  'estimated_margin_base = precio de lista convertido a moneda base con el último tipo de cambio registrado − costes '
  '(registrados + estimados). NULL si falta tipo de cambio o permiso.';

-- -----------------------------------------------------------------------------
-- Cuentas por pagar
-- -----------------------------------------------------------------------------
create or replace view public.v_supplier_invoice_balances
with (security_invoker = true) as
select
  si.id,
  si.org_id,
  si.supplier_id,
  si.invoice_number,
  si.issue_date,
  si.due_date,
  si.currency,
  si.amount,
  si.concept,
  si.category,
  si.vehicle_id,
  si.status,
  coalesce(p.confirmed, 0)                         as paid_confirmed,
  coalesce(p.registered, 0)                        as paid_registered_pending,
  coalesce(p.reconciled, 0)                        as paid_reconciled,
  si.amount - coalesce(p.confirmed, 0)             as outstanding,
  case when si.status = 'aprobada' and si.amount - coalesce(p.confirmed, 0) > 0 and si.due_date < app.org_today(si.org_id)
       then app.org_today(si.org_id) - si.due_date else 0 end as days_overdue
from public.supplier_invoices si
left join lateral (
  select sum(sp.amount) filter (where sp.status = 'confirmado') as confirmed,
         sum(sp.amount) filter (where sp.status = 'registrado') as registered,
         sum(sp.amount) filter (where sp.status = 'confirmado' and cm.status = 'conciliado') as reconciled
  from public.supplier_payments sp
  left join public.cash_movements cm on cm.id = sp.cash_movement_id
  where sp.invoice_id = si.id
) p on true;

-- -----------------------------------------------------------------------------
-- Saldos registrados por cuenta
-- -----------------------------------------------------------------------------
create or replace view public.v_cash_account_balances
with (security_invoker = true) as
select
  a.id as account_id,
  a.org_id,
  a.name,
  a.kind,
  a.currency,
  a.is_active,
  coalesce(sum(case when m.direction = 'ingreso' then m.amount else -m.amount end), 0) as registered_balance,
  coalesce(sum(case when m.direction = 'ingreso' then m.amount else -m.amount end)
           filter (where m.status = 'conciliado'), 0)                                   as reconciled_balance,
  count(m.id) filter (where m.status = 'registrado')                                    as unreconciled_count,
  (select max(r.period_end) from public.reconciliations r
    where r.account_id = a.id and r.status = 'cerrada')                                 as last_reconciled_on
from public.cash_accounts a
left join public.cash_movements m on m.account_id = a.id
group by a.id;

comment on view public.v_cash_account_balances is
  'Saldo REGISTRADO en el sistema (no es saldo bancario verificado). reconciled_balance considera sólo movimientos conciliados.';
