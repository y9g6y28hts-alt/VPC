-- =============================================================================
-- Motor Haus · 0011 Vistas de saldos y estado
-- Todas las vistas son security_invoker: aplican el RLS del usuario que consulta.
-- Ningún saldo se almacena como valor editable: se deriva de obligaciones,
-- ajustes y asignaciones de pagos confirmados.
-- =============================================================================

-- Fecha de referencia. Permite fijar una fecha "al" para estados de cuenta y
-- pruebas reproducibles (SET app.as_of_date = '2026-01-31').
create or replace function app.today() returns date
language sql stable as $$
  select coalesce(nullif(current_setting('app.as_of_date', true), '')::date, current_date)
$$;

-- -----------------------------------------------------------------------------
-- Costes por unidad. Devuelve NULL (no cero) si el usuario no puede ver costes.
-- -----------------------------------------------------------------------------
create view public.unit_cost_summary with (security_invoker = true) as
select
  u.id as unit_id,
  u.organization_id,
  u.currency,
  case when app.has_perm(u.organization_id, 'inventory.cost.read') then
    coalesce(sum(c.amount_unit_currency) filter (
      where c.status = 'active' and c.nature = 'actual' and cc.include_in_inventory_cost), 0)
  end as cost_actual,
  case when app.has_perm(u.organization_id, 'inventory.cost.read') then
    coalesce(sum(c.amount_unit_currency) filter (
      where c.status = 'active' and c.nature = 'estimated' and cc.include_in_inventory_cost), 0)
  end as cost_estimated_pending,
  case when app.has_perm(u.organization_id, 'inventory.cost.read') then
    coalesce(sum(c.amount_unit_currency) filter (
      where c.status = 'active' and not cc.include_in_inventory_cost), 0)
  end as cost_excluded,
  case when app.has_perm(u.organization_id, 'inventory.cost.read') then
    count(c.id) filter (where c.status = 'active' and c.nature = 'estimated')
  end as pending_estimates
from public.units u
left join public.unit_costs c on c.unit_id = u.id
left join public.cost_concepts cc on cc.organization_id = c.organization_id and cc.code = c.concept_code
group by u.id;

create or replace function app.unit_display_status(
  p_acq text, p_log text, p_prep text, p_com text
) returns text
language sql immutable as $$
  select case
    when p_com = 'retired' then 'retired'
    when p_com = 'delivered' then 'delivered'
    when p_com = 'sold_pending_delivery' then 'sold_pending_delivery'
    when p_com = 'reserved' then 'reserved'
    when p_prep = 'in_service' then 'in_service'
    when p_com = 'available' then 'available'
    when p_acq = 'rejected' then 'rejected'
    when p_acq = 'evaluation' then 'evaluation'
    when p_log = 'in_transit' then 'in_transit'
    when p_log = 'in_customs' then 'in_customs'
    when p_log = 'pending' then 'purchase_approved'
    when p_prep in ('not_started', 'in_preparation') then 'in_preparation'
    else 'ready_not_listed'
  end
$$;

create view public.unit_overview with (security_invoker = true) as
select
  u.*,
  app.unit_display_status(u.acquisition_status, u.logistics_status, u.preparation_status, u.commercial_status)
    as display_status,
  (u.acquisition_status = 'acquired' and u.commercial_status in ('not_listed','available','reserved'))
    as in_stock,
  case when u.received_on is not null then
    coalesce(u.sold_on, u.retired_on, app.today()) - u.received_on
  end as days_in_stock,
  cs.cost_actual,
  cs.cost_estimated_pending,
  cs.pending_estimates,
  case when cs.cost_actual is not null and u.list_price is not null then
    u.list_price - cs.cost_actual - cs.cost_estimated_pending end as potential_margin,
  case when cs.cost_actual is not null and coalesce(u.list_price, 0) > 0 then
    round((u.list_price - cs.cost_actual - cs.cost_estimated_pending) / u.list_price * 100, 2)
  end as potential_margin_pct,
  l.name as location_name,
  l.kind as location_kind,
  r.id as reservation_id,
  r.expires_at as reservation_expires_at,
  r.customer_id as reservation_customer_id,
  (select ui.value from public.unit_identifiers ui
    where ui.unit_id = u.id and ui.kind in ('vin','chassis','hull','serial')
    order by case ui.kind when 'vin' then 1 when 'chassis' then 2 else 3 end limit 1) as primary_identifier,
  (select m.storage_path from public.unit_media m where m.unit_id = u.id and m.is_cover limit 1) as cover_path,
  (select count(*) from public.unit_documents d
    where d.unit_id = u.id and d.required_for_sale and d.status = 'pending') as required_docs_pending,
  (select count(*) from public.preparation_tasks t
    where t.unit_id = u.id and t.mandatory and t.status = 'pending') as mandatory_tasks_pending,
  p.full_name as responsible_name
from public.units u
left join public.unit_cost_summary cs on cs.unit_id = u.id
left join public.locations l on l.id = u.location_id
left join public.reservations r on r.unit_id = u.id and r.status = 'active'
left join public.user_profiles p on p.id = u.responsible_user_id;

-- -----------------------------------------------------------------------------
-- Estado de cada obligación (cuota)
-- -----------------------------------------------------------------------------
create view public.installment_status with (security_invoker = true) as
with alloc as (
  select pa.installment_id,
    sum(pa.amount) filter (where cp.status = 'confirmed') as paid_confirmed,
    sum(pa.amount) filter (where cp.status = 'pending_reconciliation') as pending_allocated,
    max(cp.effective_date) filter (where cp.status = 'confirmed') as last_payment_date
  from public.payment_allocations pa
  join public.customer_payments cp on cp.id = pa.payment_id
  group by pa.installment_id
), adj as (
  select installment_id, sum(amount) as adjustments_total
  from public.installment_adjustments group by installment_id
), base as (
  select
    i.*,
    coalesce(adj.adjustments_total, 0) as adjustments_total,
    i.amount_due + coalesce(adj.adjustments_total, 0) as total_due,
    coalesce(alloc.paid_confirmed, 0) as paid_confirmed,
    coalesce(alloc.pending_allocated, 0) as pending_allocated,
    alloc.last_payment_date,
    app.exigible_date(i.organization_id, i.due_date) as exigible_date,
    coalesce(op.grace_days, 0) as grace_days,
    coalesce(op.installment_due_soon_days, 7) as due_soon_days
  from public.receivable_installments i
  left join alloc on alloc.installment_id = i.id
  left join adj on adj.installment_id = i.id
  left join public.org_policies op on op.organization_id = i.organization_id
  where i.status = 'open'
)
select
  b.*,
  greatest(b.total_due - b.paid_confirmed, 0) as outstanding,
  (b.total_due - b.paid_confirmed > 0 and app.today() > b.exigible_date + b.grace_days) as is_overdue,
  case when b.total_due - b.paid_confirmed > 0 and app.today() > b.exigible_date + b.grace_days
    then app.today() - b.exigible_date else 0 end as days_past_due,
  case
    when b.total_due - b.paid_confirmed <= 0 then 'paid'
    when app.today() > b.exigible_date + b.grace_days then 'overdue'
    when b.paid_confirmed > 0 then 'partial'
    when b.due_date <= app.today() + b.due_soon_days then 'due_soon'
    else 'upcoming'
  end as payment_status
from base b;

-- -----------------------------------------------------------------------------
-- Saldo por contrato, con control de reconciliación
-- -----------------------------------------------------------------------------
create view public.contract_balances with (security_invoker = true) as
select
  c.id as contract_id,
  c.organization_id,
  c.number,
  c.customer_id,
  c.salesperson_id,
  c.currency,
  c.contract_date,
  c.status,
  c.total_price,
  c.upfront_total,
  c.financed_principal,
  coalesce(sum(s.total_due), 0) as total_obligations,
  coalesce(sum(s.principal_amount), 0) as total_principal_scheduled,
  coalesce(sum(s.interest_amount), 0) as total_interest_scheduled,
  coalesce(sum(s.adjustments_total), 0) as total_adjustments,
  coalesce(sum(s.paid_confirmed), 0) as collected_confirmed,
  coalesce(sum(s.pending_allocated), 0) as pending_reconciliation,
  coalesce(sum(s.outstanding), 0) as outstanding,
  coalesce(sum(s.outstanding) filter (where s.is_overdue), 0) as overdue_amount,
  coalesce(sum(s.outstanding) filter (where not s.is_overdue), 0) as future_amount,
  count(*) filter (where s.is_overdue) as overdue_count,
  coalesce(max(s.days_past_due), 0) as max_days_past_due,
  min(s.due_date) filter (where s.outstanding > 0) as next_due_date,
  (select s2.outstanding from public.installment_status s2
    where s2.contract_id = c.id and s2.outstanding > 0 order by s2.due_date, s2.seq limit 1) as next_due_amount,
  max(s.last_payment_date) as last_payment_date,
  -- Debe ser cero: principal programado = entregas iniciales + capital financiado.
  coalesce(sum(s.principal_amount), 0) - (c.upfront_total + c.financed_principal) as schedule_discrepancy,
  case
    when c.status = 'cancelled' then 'cancelled'
    when coalesce(sum(s.outstanding), 0) <= 0 then 'settled'
    when count(*) filter (where s.is_overdue) > 0 then 'overdue'
    else 'current'
  end as account_status
from public.sales_contracts c
left join public.installment_status s on s.contract_id = c.id
group by c.id;

-- -----------------------------------------------------------------------------
-- Pagos: importe asignado y sin asignar
-- -----------------------------------------------------------------------------
create view public.payment_status with (security_invoker = true) as
select
  p.*,
  coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id), 0) as allocated_amount,
  p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id), 0) as unallocated_amount,
  cu.display_name as customer_name,
  ca.name as cash_account_name
from public.customer_payments p
join public.customers cu on cu.id = p.customer_id
join public.cash_accounts ca on ca.id = p.cash_account_id;

-- -----------------------------------------------------------------------------
-- Cuentas por pagar
-- -----------------------------------------------------------------------------
create view public.payable_status with (security_invoker = true) as
select
  sp.*,
  s.name as supplier_name,
  coalesce((select sum(pp.amount) from public.payable_payments pp
            where pp.payable_id = sp.id and pp.status = 'posted'), 0) as paid_amount,
  case when sp.cancelled then 0 else
    sp.amount - coalesce((select sum(pp.amount) from public.payable_payments pp
                          where pp.payable_id = sp.id and pp.status = 'posted'), 0) end as outstanding,
  sp.due_date - app.today() as days_to_due,
  case
    when sp.cancelled then 'cancelled'
    when sp.amount - coalesce((select sum(pp.amount) from public.payable_payments pp
                               where pp.payable_id = sp.id and pp.status = 'posted'), 0) <= 0 then 'paid'
    when sp.due_date < app.today() then 'overdue'
    else 'open'
  end as payable_state
from public.supplier_payables sp
join public.suppliers s on s.id = sp.supplier_id;

-- -----------------------------------------------------------------------------
-- Saldos de cuentas financieras (registrados, no sincronizados)
-- -----------------------------------------------------------------------------
create view public.cash_account_balances with (security_invoker = true) as
select
  a.id as cash_account_id,
  a.organization_id,
  a.name,
  a.kind,
  a.currency,
  a.data_origin,
  a.active,
  a.opening_balance,
  a.opening_date,
  a.opening_balance + coalesce(sum(m.amount) filter (
    where m.status = 'posted' and m.movement_date <= app.today()), 0) as posted_balance,
  coalesce(sum(m.amount) filter (where m.status = 'pending'), 0) as pending_amount,
  count(m.id) filter (where m.reconciliation_status = 'unreconciled' and m.status = 'posted') as unreconciled_count,
  max(m.movement_date) as last_movement_date,
  (select max(r.statement_date) from public.bank_reconciliations r where r.cash_account_id = a.id) as last_reconciled_on
from public.cash_accounts a
left join public.cash_movements m on m.cash_account_id = a.id
group by a.id;

-- -----------------------------------------------------------------------------
-- Compromisos de pago: se evalúan contra pagos confirmados, nunca se suman como cobro.
-- -----------------------------------------------------------------------------
create view public.collection_promises with (security_invoker = true) as
select
  ca.*,
  coalesce((select sum(p.amount) from public.customer_payments p
            where p.customer_id = ca.customer_id
              and p.currency = ca.promise_currency
              and p.status = 'confirmed'
              and p.effective_date >= ca.contacted_at::date
              and p.effective_date <= ca.promise_date), 0) as paid_since_promise,
  case
    when ca.outcome <> 'promise' then null
    when coalesce((select sum(p.amount) from public.customer_payments p
                   where p.customer_id = ca.customer_id and p.currency = ca.promise_currency
                     and p.status = 'confirmed' and p.effective_date >= ca.contacted_at::date
                     and p.effective_date <= ca.promise_date), 0) >= ca.promise_amount then 'kept'
    when ca.promise_date < app.today() then 'broken'
    else 'pending'
  end as promise_status
from public.collection_actions ca;
