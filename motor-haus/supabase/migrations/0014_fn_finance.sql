-- =============================================================================
-- Motor Haus · 0014 Funciones financieras
-- Pagos de clientes, asignaciones, conciliación, reversiones, ajustes,
-- cobranzas, tesorería y cuentas por pagar.
-- =============================================================================

-- Saldo disponible para asignar a una cuota: total exigible − cobrado
-- confirmado − asignado por otros pagos pendientes de conciliación.
create or replace function app.installment_available(p_installment uuid, p_exclude_payment uuid default null) returns numeric
language sql stable security definer set search_path = public, app as $$
  select i.amount_due
       + coalesce((select sum(a.amount) from public.installment_adjustments a where a.installment_id = i.id), 0)
       - coalesce((select sum(pa.amount) from public.payment_allocations pa
                   join public.customer_payments cp on cp.id = pa.payment_id
                   where pa.installment_id = i.id
                     and cp.status in ('confirmed','pending_reconciliation')
                     and cp.id is distinct from p_exclude_payment), 0)
  from public.receivable_installments i where i.id = p_installment
$$;

create or replace function app.apply_allocations(p_payment uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.customer_payments;
  v_remaining numeric;
  v_inst record;
  v_avail numeric;
  v_amt numeric;
  v_item jsonb;
  v_total numeric := 0;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.status <> 'pending_reconciliation' then
    raise exception 'MH_STATE: solo se asignan pagos pendientes de conciliación';
  end if;
  delete from public.payment_allocations where payment_id = p_payment;
  v_remaining := p.amount;

  if p_allocations is null then
    -- Asignación automática: cuotas más antiguas primero (FIFO).
    for v_inst in
      select i.id from public.receivable_installments i
      join public.sales_contracts c on c.id = i.contract_id
      where i.customer_id = p.customer_id and i.currency = p.currency and i.status = 'open'
        and c.status <> 'cancelled' and (p.contract_id is null or i.contract_id = p.contract_id)
      order by i.due_date, i.seq
      for update of i
    loop
      exit when v_remaining <= 0;
      v_avail := app.installment_available(v_inst.id, p_payment);
      if v_avail > 0 then
        v_amt := least(v_avail, v_remaining);
        insert into public.payment_allocations (organization_id, payment_id, installment_id, currency, amount, created_by)
        values (p.organization_id, p_payment, v_inst.id, p.currency, v_amt, auth.uid());
        v_remaining := v_remaining - v_amt;
      end if;
    end loop;
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_amt := (v_item ->> 'amount')::numeric;
    if v_amt is null or v_amt <= 0 then raise exception 'MH_VALIDATION: importe de asignación inválido'; end if;
    if v_amt <> app.round_money(v_amt, p.currency) then raise exception 'MH_VALIDATION: decimales no admitidos para %', p.currency; end if;
    perform 1 from public.receivable_installments i
      where i.id = (v_item ->> 'installment_id')::uuid and i.customer_id = p.customer_id
        and i.currency = p.currency and i.status = 'open'
        and (p.contract_id is null or i.contract_id = p.contract_id)
      for update;
    if not found then raise exception 'MH_VALIDATION: la cuota no pertenece al cliente, contrato o moneda del pago'; end if;
    v_avail := app.installment_available((v_item ->> 'installment_id')::uuid, p_payment);
    if v_amt > v_avail then
      raise exception 'MH_VALIDATION: la asignación (%) supera el saldo disponible de la cuota (%)', v_amt, v_avail;
    end if;
    v_total := v_total + v_amt;
    if v_total > p.amount then raise exception 'MH_VALIDATION: las asignaciones superan el importe del pago'; end if;
    insert into public.payment_allocations (organization_id, payment_id, installment_id, currency, amount, created_by)
    values (p.organization_id, p_payment, (v_item ->> 'installment_id')::uuid, p.currency, v_amt, auth.uid());
  end loop;
end $$;

create or replace function public.record_customer_payment(
  p_org uuid, p_customer uuid, p_contract uuid, p_amount numeric, p_currency char(3), p_effective_date date,
  p_method text, p_reference text, p_cash_account uuid, p_idempotency_key text,
  p_notes text default null, p_allocations jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_existing public.customer_payments;
  v_id uuid;
begin
  perform app.require_perm(p_org, 'payment.create');
  select * into v_existing from public.customer_payments where organization_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.customer_id = p_customer and v_existing.amount = p_amount and v_existing.currency = p_currency then
      return v_existing.id;  -- reintento del mismo envío: no se duplica
    end if;
    raise exception 'MH_CONFLICT: la clave de idempotencia ya fue usada por otro pago';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'MH_NOT_FOUND: cliente inexistente';
  end if;
  if p_contract is not null and not exists (
      select 1 from public.sales_contracts where id = p_contract and customer_id = p_customer and currency = p_currency) then
    raise exception 'MH_VALIDATION: el contrato no corresponde al cliente o a la moneda del pago';
  end if;
  if not exists (select 1 from public.cash_accounts where id = p_cash_account and organization_id = p_org and active) then
    raise exception 'MH_VALIDATION: cuenta receptora inválida';
  end if;
  if not exists (select 1 from public.cash_accounts where id = p_cash_account and currency = p_currency) then
    raise exception 'MH_VALIDATION: la cuenta receptora no opera en %; no se convierten monedas en silencio', p_currency;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> app.round_money(p_amount, p_currency) then
    raise exception 'MH_VALIDATION: importe inválido para %', p_currency;
  end if;
  if p_effective_date > app.today() then raise exception 'MH_VALIDATION: la fecha efectiva no puede ser futura'; end if;

  insert into public.customer_payments (organization_id, number, customer_id, contract_id, amount, currency, effective_date,
    method, reference, cash_account_id, idempotency_key, notes, recorded_by)
  values (p_org, app.next_number(p_org, 'payment', 'PAG', p_effective_date), p_customer, p_contract, p_amount, p_currency,
    p_effective_date, p_method, nullif(trim(p_reference), ''), p_cash_account, p_idempotency_key, p_notes, auth.uid())
  returning id into v_id;
  perform app.apply_allocations(v_id, p_allocations);
  return v_id;
exception when unique_violation then
  raise exception 'MH_CONFLICT: ya existe un pago con la misma referencia en esta cuenta';
end $$;

create or replace function public.allocate_payment(p_payment uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare p public.customer_payments;
begin
  select * into p from public.customer_payments where id = p_payment;
  if not found then raise exception 'MH_NOT_FOUND: pago inexistente'; end if;
  perform app.require_perm(p.organization_id, 'payment.create');
  perform app.apply_allocations(p_payment, p_allocations);
end $$;

create or replace function app.refresh_contract_status(p_contract uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_out numeric;
begin
  select coalesce(sum(outstanding), 0) into v_out from public.installment_status where contract_id = p_contract;
  update public.sales_contracts set status = case when v_out <= 0 then 'settled' else 'active' end
   where id = p_contract and status <> 'cancelled';
end $$;

create or replace function public.confirm_payment(p_payment uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.customer_payments;
  pol public.org_policies;
  a record;
  v_paid numeric; v_due numeric;
  v_mov uuid;
  v_contract uuid;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if not found then raise exception 'MH_NOT_FOUND: pago inexistente'; end if;
  perform app.require_perm(p.organization_id, 'payment.confirm');
  if p.status <> 'pending_reconciliation' then raise exception 'MH_STATE: el pago está %', p.status; end if;
  select * into pol from public.org_policies where organization_id = p.organization_id;
  if pol.approval_segregation and p.recorded_by = auth.uid() then
    raise exception 'MH_FORBIDDEN: quien registra un pago no puede confirmarlo (segregación de funciones)';
  end if;

  -- Nueva comprobación con bloqueo: ninguna cuota puede quedar sobrecobrada.
  for a in select pa.installment_id, pa.amount from public.payment_allocations pa
           join public.receivable_installments i on i.id = pa.installment_id
           where pa.payment_id = p_payment order by pa.installment_id for update of i loop
    select i.amount_due + coalesce((select sum(x.amount) from public.installment_adjustments x where x.installment_id = i.id), 0)
      into v_due from public.receivable_installments i where i.id = a.installment_id;
    select coalesce(sum(pa.amount), 0) into v_paid from public.payment_allocations pa
      join public.customer_payments cp on cp.id = pa.payment_id
     where pa.installment_id = a.installment_id and cp.status = 'confirmed';
    if v_paid + a.amount > v_due then
      raise exception 'MH_CONFLICT: la cuota ya fue cubierta por otro pago; reasigne este pago antes de confirmarlo';
    end if;
  end loop;

  insert into public.cash_movements (organization_id, cash_account_id, currency, movement_date, amount, category, status,
    description, reference, counterparty, source_type, source_id, created_by)
  select p.organization_id, p.cash_account_id, p.currency, p.effective_date, p.amount, 'customer_payment', 'posted',
    'Cobro ' || p.number, p.reference, c.display_name, 'customer_payment', p.id, auth.uid()
  from public.customers c where c.id = p.customer_id
  returning id into v_mov;

  update public.customer_payments set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(),
    cash_movement_id = v_mov, notes = coalesce(p_note, notes)
   where id = p_payment;

  for v_contract in select distinct i.contract_id from public.payment_allocations pa
                    join public.receivable_installments i on i.id = pa.installment_id where pa.payment_id = p_payment loop
    perform app.refresh_contract_status(v_contract);
  end loop;
  perform app.audit(p.organization_id, 'payment.confirm', 'customer_payments', p_payment, null,
    jsonb_build_object('amount', p.amount, 'currency', p.currency, 'cash_movement', v_mov));
end $$;

create or replace function public.reject_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare p public.customer_payments;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if not found then raise exception 'MH_NOT_FOUND: pago inexistente'; end if;
  perform app.require_perm(p.organization_id, 'payment.confirm');
  if p.status <> 'pending_reconciliation' then raise exception 'MH_STATE: el pago está %', p.status; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo del rechazo'; end if;
  update public.customer_payments set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), rejected_reason = p_reason
   where id = p_payment;
end $$;

create or replace function public.reverse_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  p public.customer_payments;
  v_mov uuid;
  v_contract uuid;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if not found then raise exception 'MH_NOT_FOUND: pago inexistente'; end if;
  perform app.require_perm(p.organization_id, 'payment.reverse');
  if p.status <> 'confirmed' then raise exception 'MH_STATE: solo se revierten pagos confirmados (estado: %)', p.status; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo de la reversión'; end if;

  insert into public.cash_movements (organization_id, cash_account_id, currency, movement_date, amount, category, status,
    description, reference, source_type, source_id, reverses_movement_id, created_by)
  values (p.organization_id, p.cash_account_id, p.currency, app.today(), -p.amount, 'customer_payment_reversal', 'posted',
    'Reversión de ' || p.number || ': ' || p_reason, p.reference, 'payment_reversal', p.id, p.cash_movement_id, auth.uid())
  returning id into v_mov;
  insert into public.payment_reversals (organization_id, payment_id, reason, cash_movement_id, reversed_by)
  values (p.organization_id, p_payment, p_reason, v_mov, auth.uid());
  update public.customer_payments set status = 'reversed' where id = p_payment;

  for v_contract in select distinct i.contract_id from public.payment_allocations pa
                    join public.receivable_installments i on i.id = pa.installment_id where pa.payment_id = p_payment loop
    perform app.refresh_contract_status(v_contract);
  end loop;
  perform app.audit(p.organization_id, 'payment.reverse', 'customer_payments', p_payment,
    jsonb_build_object('status', 'confirmed'), jsonb_build_object('status', 'reversed', 'reason', p_reason, 'cash_movement', v_mov));
end $$;

create or replace function public.register_installment_adjustment(
  p_installment uuid, p_kind text, p_amount numeric, p_reason text
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  i public.receivable_installments;
  v_id uuid;
  v_avail numeric;
begin
  select * into i from public.receivable_installments where id = p_installment for update;
  if not found then raise exception 'MH_NOT_FOUND: cuota inexistente'; end if;
  perform app.require_perm(i.organization_id, 'receivable.adjust');
  if p_amount <> app.round_money(p_amount, i.currency) then raise exception 'MH_VALIDATION: decimales no admitidos'; end if;
  v_avail := app.installment_available(p_installment);
  if v_avail + p_amount < 0 then
    raise exception 'MH_VALIDATION: el ajuste dejaría la cuota por debajo de lo ya cobrado o asignado';
  end if;
  insert into public.installment_adjustments (organization_id, installment_id, currency, kind, amount, reason, created_by)
  values (i.organization_id, p_installment, i.currency, p_kind, p_amount, p_reason, auth.uid())
  returning id into v_id;
  perform app.refresh_contract_status(i.contract_id);
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Cobranzas
-- -----------------------------------------------------------------------------
create or replace function public.log_collection_action(
  p_org uuid, p_customer uuid, p_contract uuid, p_channel text, p_outcome text,
  p_promise_amount numeric, p_promise_currency char(3), p_promise_date date,
  p_next_action text, p_next_action_date date, p_notes text
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  perform app.require_perm(p_org, 'collections.write');
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'MH_NOT_FOUND: cliente inexistente';
  end if;
  if p_contract is not null and not exists (select 1 from public.sales_contracts where id = p_contract and customer_id = p_customer) then
    raise exception 'MH_VALIDATION: el contrato no corresponde al cliente';
  end if;
  if p_outcome = 'promise' and (p_promise_date is null or p_promise_date < app.today()) then
    raise exception 'MH_VALIDATION: la fecha prometida debe ser hoy o posterior';
  end if;
  if p_next_action_date is not null and p_next_action_date < app.today() then
    raise exception 'MH_VALIDATION: la próxima acción no puede programarse en el pasado';
  end if;
  insert into public.collection_actions (organization_id, customer_id, contract_id, channel, user_id, outcome,
    promise_amount, promise_currency, promise_date, next_action, next_action_date, notes)
  values (p_org, p_customer, p_contract, p_channel, auth.uid(), p_outcome,
    case when p_outcome = 'promise' then p_promise_amount end,
    case when p_outcome = 'promise' then p_promise_currency end,
    case when p_outcome = 'promise' then p_promise_date end,
    p_next_action, p_next_action_date, p_notes)
  returning id into v_id;
  return v_id;
end $$;

-- Registra la intención de notificar. Sin canal configurado no se envía nada.
create or replace function public.register_notification_intent(
  p_org uuid, p_customer uuid, p_channel text, p_template text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  perform app.require_perm(p_org, 'collections.write');
  insert into public.notification_events (organization_id, customer_id, channel, template_code, payload, status, created_by)
  values (p_org, p_customer, p_channel, p_template, coalesce(p_payload, '{}'), 'not_sent_no_channel', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Tesorería
-- -----------------------------------------------------------------------------
create or replace function public.record_cash_movement(
  p_account uuid, p_date date, p_amount numeric, p_category text, p_description text,
  p_reference text default null, p_counterparty text default null, p_status text default 'posted'
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare a public.cash_accounts; v_id uuid;
begin
  select * into a from public.cash_accounts where id = p_account;
  if not found then raise exception 'MH_NOT_FOUND: cuenta inexistente'; end if;
  perform app.require_perm(a.organization_id, 'treasury.write');
  if p_category not in ('operating_expense','payroll','tax','transfer','owner_contribution','owner_withdrawal',
                        'financing','adjustment','other_income') then
    raise exception 'MH_VALIDATION: los cobros y pagos a proveedores se registran desde sus módulos';
  end if;
  if p_category in ('operating_expense','payroll','tax','owner_withdrawal') and p_amount >= 0 then
    raise exception 'MH_VALIDATION: un egreso se registra con importe negativo';
  end if;
  if p_category in ('owner_contribution','other_income') and p_amount <= 0 then
    raise exception 'MH_VALIDATION: un ingreso se registra con importe positivo';
  end if;
  if p_amount <> app.round_money(p_amount, a.currency) then raise exception 'MH_VALIDATION: decimales no admitidos'; end if;
  if p_status = 'posted' and p_date > app.today() then
    raise exception 'MH_VALIDATION: un movimiento futuro se registra como pendiente';
  end if;
  if coalesce(length(trim(p_description)), 0) < 3 then raise exception 'MH_VALIDATION: describa el movimiento'; end if;
  insert into public.cash_movements (organization_id, cash_account_id, currency, movement_date, amount, category, status,
    description, reference, counterparty, created_by)
  values (a.organization_id, p_account, a.currency, p_date, p_amount, p_category, p_status, p_description, p_reference,
    p_counterparty, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.post_cash_movement(p_movement uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare m public.cash_movements;
begin
  select * into m from public.cash_movements where id = p_movement for update;
  if not found then raise exception 'MH_NOT_FOUND: movimiento inexistente'; end if;
  perform app.require_perm(m.organization_id, 'treasury.write');
  if m.status <> 'pending' then raise exception 'MH_STATE: el movimiento ya está contabilizado'; end if;
  if m.movement_date > app.today() then raise exception 'MH_STATE: la fecha del movimiento aún no llegó'; end if;
  update public.cash_movements set status = 'posted' where id = p_movement;
end $$;

create or replace function public.reverse_cash_movement(p_movement uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare m public.cash_movements; v_id uuid;
begin
  select * into m from public.cash_movements where id = p_movement for update;
  if not found then raise exception 'MH_NOT_FOUND: movimiento inexistente'; end if;
  perform app.require_perm(m.organization_id, 'treasury.write');
  if m.source_type <> 'manual' then raise exception 'MH_STATE: este movimiento se revierte desde su módulo de origen'; end if;
  if m.status <> 'posted' then raise exception 'MH_STATE: solo se revierten movimientos contabilizados'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo'; end if;
  insert into public.cash_movements (organization_id, cash_account_id, currency, movement_date, amount, category, status,
    description, reference, source_type, source_id, reverses_movement_id, created_by)
  values (m.organization_id, m.cash_account_id, m.currency, app.today(), -m.amount, m.category, 'posted',
    'Reversión: ' || p_reason, m.reference, 'reversal', m.id, m.id, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'MH_CONFLICT: el movimiento ya fue revertido';
end $$;

create or replace function public.reconcile_account(
  p_account uuid, p_statement_date date, p_statement_balance numeric, p_movement_ids uuid[], p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare a public.cash_accounts; v_book numeric; v_id uuid;
begin
  select * into a from public.cash_accounts where id = p_account for update;
  if not found then raise exception 'MH_NOT_FOUND: cuenta inexistente'; end if;
  perform app.require_perm(a.organization_id, 'treasury.reconcile');
  if p_statement_date > app.today() then raise exception 'MH_VALIDATION: fecha de extracto futura'; end if;
  select a.opening_balance + coalesce(sum(amount), 0) into v_book from public.cash_movements
   where cash_account_id = p_account and status = 'posted' and movement_date <= p_statement_date;
  insert into public.bank_reconciliations (organization_id, cash_account_id, statement_date, statement_balance, book_balance, notes, reconciled_by)
  values (a.organization_id, p_account, p_statement_date, p_statement_balance, v_book, p_notes, auth.uid())
  returning id into v_id;
  update public.cash_movements set reconciliation_status = 'reconciled', reconciliation_id = v_id
   where id = any(coalesce(p_movement_ids, '{}')) and cash_account_id = p_account and status = 'posted'
     and movement_date <= p_statement_date and reconciliation_status = 'unreconciled';
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Cuentas por pagar
-- -----------------------------------------------------------------------------
create or replace function public.create_supplier_payable(p_org uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  perform app.require_perm(p_org, 'payable.write');
  if not exists (select 1 from public.suppliers where id = (p_data ->> 'supplier_id')::uuid and organization_id = p_org) then
    raise exception 'MH_NOT_FOUND: proveedor inexistente';
  end if;
  if (p_data ->> 'unit_id') is not null and not exists (
      select 1 from public.units where id = (p_data ->> 'unit_id')::uuid and organization_id = p_org) then
    raise exception 'MH_VALIDATION: unidad inválida';
  end if;
  insert into public.supplier_payables (organization_id, supplier_id, document_type, document_number, concept, category,
    unit_id, purchase_order_id, amount, currency, issue_date, due_date, notes, created_by)
  values (p_org, (p_data ->> 'supplier_id')::uuid, coalesce(p_data ->> 'document_type', 'invoice'), p_data ->> 'document_number',
    p_data ->> 'concept', p_data ->> 'category', nullif(p_data ->> 'unit_id', '')::uuid,
    nullif(p_data ->> 'purchase_order_id', '')::uuid, (p_data ->> 'amount')::numeric, p_data ->> 'currency',
    (p_data ->> 'issue_date')::date, (p_data ->> 'due_date')::date, p_data ->> 'notes', auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'MH_CONFLICT: el documento ya fue registrado para este proveedor';
end $$;

create or replace function public.decide_payable(p_payable uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare sp public.supplier_payables; pol public.org_policies;
begin
  select * into sp from public.supplier_payables where id = p_payable for update;
  if not found then raise exception 'MH_NOT_FOUND: factura inexistente'; end if;
  perform app.require_perm(sp.organization_id, 'payable.approve');
  if sp.approval_status <> 'pending' then raise exception 'MH_STATE: la factura ya está %', sp.approval_status; end if;
  if p_decision not in ('approved','rejected') then raise exception 'MH_VALIDATION: decisión inválida'; end if;
  select * into pol from public.org_policies where organization_id = sp.organization_id;
  if pol.approval_segregation and sp.created_by = auth.uid() then
    raise exception 'MH_FORBIDDEN: quien registra la factura no puede aprobarla';
  end if;
  update public.supplier_payables set approval_status = p_decision, approved_by = auth.uid(), approved_at = now(),
    notes = coalesce(p_note, notes) where id = p_payable;
end $$;

create or replace function public.pay_supplier_payable(
  p_payable uuid, p_amount numeric, p_paid_on date, p_cash_account uuid, p_reference text,
  p_fx_rate numeric default null, p_fx_date date default null, p_fx_source text default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  sp public.supplier_payables;
  a public.cash_accounts;
  v_out numeric;
  v_cash numeric;
  v_mov uuid;
  v_id uuid;
begin
  select * into sp from public.supplier_payables where id = p_payable for update;
  if not found then raise exception 'MH_NOT_FOUND: factura inexistente'; end if;
  perform app.require_perm(sp.organization_id, 'payable.pay');
  if sp.cancelled or sp.approval_status <> 'approved' then raise exception 'MH_STATE: solo se pagan facturas aprobadas y vigentes'; end if;
  select * into a from public.cash_accounts where id = p_cash_account and organization_id = sp.organization_id and active;
  if not found then raise exception 'MH_VALIDATION: cuenta de pago inválida'; end if;
  select sp.amount - coalesce(sum(amount), 0) into v_out from public.payable_payments where payable_id = p_payable and status = 'posted';
  if p_amount <= 0 or p_amount > v_out then raise exception 'MH_VALIDATION: el pago debe estar entre 0 y el saldo pendiente (%)', v_out; end if;
  if p_amount <> app.round_money(p_amount, sp.currency) then raise exception 'MH_VALIDATION: decimales no admitidos'; end if;
  if p_paid_on > app.today() then raise exception 'MH_VALIDATION: use la programación de pagos para fechas futuras'; end if;
  if a.currency = sp.currency then
    v_cash := p_amount;
  else
    if p_fx_rate is null or p_fx_date is null or coalesce(length(trim(p_fx_source)), 0) < 2 then
      raise exception 'MH_VALIDATION: la cuenta opera en % y la factura en %; registre cotización, fecha y fuente', a.currency, sp.currency;
    end if;
    v_cash := app.round_money(p_amount * p_fx_rate, a.currency);
  end if;

  insert into public.cash_movements (organization_id, cash_account_id, currency, movement_date, amount, category, status,
    description, reference, counterparty, source_type, source_id, created_by)
  select sp.organization_id, a.id, a.currency, p_paid_on, -v_cash, 'supplier_payment', 'posted',
    'Pago ' || sp.document_number || ' · ' || sp.concept, p_reference, s.name, 'payable_payment', sp.id, auth.uid()
  from public.suppliers s where s.id = sp.supplier_id
  returning id into v_mov;
  insert into public.payable_payments (organization_id, payable_id, currency, amount, paid_on, cash_account_id, cash_amount,
    fx_rate, fx_date, fx_source, cash_movement_id, reference, created_by)
  values (sp.organization_id, p_payable, sp.currency, p_amount, p_paid_on, a.id, v_cash,
    case when a.currency <> sp.currency then p_fx_rate end, case when a.currency <> sp.currency then p_fx_date end,
    case when a.currency <> sp.currency then p_fx_source end, v_mov, p_reference, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.reverse_payable_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare pp public.payable_payments; m public.cash_movements;
begin
  select * into pp from public.payable_payments where id = p_payment for update;
  if not found then raise exception 'MH_NOT_FOUND: pago inexistente'; end if;
  perform app.require_perm(pp.organization_id, 'payable.pay');
  if pp.status <> 'posted' then raise exception 'MH_STATE: el pago ya fue revertido'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo'; end if;
  select * into m from public.cash_movements where id = pp.cash_movement_id;
  insert into public.cash_movements (organization_id, cash_account_id, currency, movement_date, amount, category, status,
    description, reference, source_type, source_id, reverses_movement_id, created_by)
  values (m.organization_id, m.cash_account_id, m.currency, app.today(), -m.amount, 'supplier_payment_reversal', 'posted',
    'Reversión de pago a proveedor: ' || p_reason, m.reference, 'payable_payment_reversal', pp.id, m.id, auth.uid());
  update public.payable_payments set status = 'reversed', reversed_reason = p_reason, reversed_at = now(), reversed_by = auth.uid()
   where id = p_payment;
end $$;

create or replace function public.cancel_supplier_payable(p_payable uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare sp public.supplier_payables;
begin
  select * into sp from public.supplier_payables where id = p_payable for update;
  if not found then raise exception 'MH_NOT_FOUND: factura inexistente'; end if;
  perform app.require_perm(sp.organization_id, 'payable.approve');
  if exists (select 1 from public.payable_payments where payable_id = p_payable and status = 'posted') then
    raise exception 'MH_STATE: la factura tiene pagos registrados; revierta los pagos primero';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo'; end if;
  update public.supplier_payables set cancelled = true, cancel_reason = p_reason where id = p_payable;
end $$;
