-- =============================================================================
-- Da Silva OS — Funciones transaccionales: cobros, ajustes, aprobaciones,
-- tasaciones, proveedores, gastos, caja y conciliación
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pagos de clientes
-- -----------------------------------------------------------------------------
-- p: {customer_id, contract_id?, reservation_id?, received_on, method, cash_account_id,
--     currency, amount, reference?, notes?, evidence_document_id?, allow_duplicate?}
create or replace function public.rpc_payment_register(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_ctr      public.contracts%rowtype;
  v_id       uuid;
  v_amount   numeric := (p->>'amount')::numeric;
  v_currency text := p->>'currency';
  v_date     date := (p->>'received_on')::date;
  v_dup      text;
begin
  select org_id into v_org from public.customers where id = (p->>'customer_id')::uuid;
  if v_org is null then perform app.fail('El cliente no existe'); end if;
  perform app.require_perm(v_org, 'payments.register');

  if (p->>'method') in ('trade_in','nota_credito') then
    perform app.fail('Este tipo de crédito se registra desde la venta o mediante una aprobación');
  end if;
  if v_amount is null or v_amount <= 0 then perform app.fail('El importe debe ser mayor que cero'); end if;
  if not app.money_ok(v_amount, v_currency) then
    perform app.fail(format('Importe con decimales no válidos para %s', v_currency));
  end if;
  if v_date is null or v_date > app.org_today(v_org) then
    perform app.fail('La fecha de cobro no puede ser futura');
  end if;
  if (p->>'contract_id') is null and (p->>'reservation_id') is null then
    perform app.fail('Indique el contrato o la reserva a la que corresponde el pago');
  end if;
  if (p->>'contract_id') is not null then
    select * into v_ctr from public.contracts where id = (p->>'contract_id')::uuid;
    if v_ctr.customer_id is distinct from (p->>'customer_id')::uuid then
      perform app.fail('El contrato no pertenece al cliente');
    end if;
    if v_ctr.status = 'anulado' then perform app.fail('El contrato está anulado'); end if;
  end if;
  if not exists (select 1 from public.cash_accounts
                 where id = (p->>'cash_account_id')::uuid and org_id = v_org and is_active and currency = v_currency) then
    perform app.fail('Seleccione una cuenta activa en la misma moneda del pago');
  end if;

  -- Detección de duplicados: misma cuenta, importe, fecha y referencia.
  select number into v_dup from public.customer_payments
  where org_id = v_org and amount = v_amount and currency = v_currency and received_on = v_date
    and cash_account_id = (p->>'cash_account_id')::uuid
    and coalesce(reference, '') = coalesce(p->>'reference', '')
    and status in ('registrado','confirmado')
  limit 1;
  if v_dup is not null and coalesce((p->>'allow_duplicate')::boolean, false) = false then
    raise exception using errcode = 'P0001',
      message = format('Posible pago duplicado: %s tiene la misma cuenta, fecha, importe y referencia.', v_dup),
      hint = 'duplicate';
  end if;

  insert into public.customer_payments (org_id, customer_id, contract_id, reservation_id, received_on, method,
                                        cash_account_id, currency, amount, reference, notes, evidence_document_id,
                                        registered_by)
  values (v_org, (p->>'customer_id')::uuid, (p->>'contract_id')::uuid, (p->>'reservation_id')::uuid, v_date,
          p->>'method', (p->>'cash_account_id')::uuid, v_currency, v_amount, nullif(p->>'reference', ''),
          nullif(p->>'notes', ''), (p->>'evidence_document_id')::uuid, auth.uid())
  returning id into v_id;

  if v_ctr.id is not null then
    perform app.bind_payment_to_contract(v_id, v_ctr.id);
  end if;
  return v_id;
end $$;

-- Confirma un pago: lo aplica a las cuotas, registra la cuenta corriente y
-- el ingreso de caja. Sólo a partir de aquí cuenta como cobro.
create or replace function public.rpc_payment_confirm(p_payment_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay       public.customer_payments%rowtype;
  v_unapplied numeric := 0;
begin
  select * into v_pay from public.customer_payments where id = p_payment_id for update;
  if not found then perform app.fail('El pago no existe'); end if;
  perform app.require_perm(v_pay.org_id, 'payments.confirm');
  if v_pay.status <> 'registrado' then perform app.fail('Sólo se confirman pagos registrados'); end if;

  update public.customer_payments set status = 'confirmado', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p_payment_id;
  perform app.cash_in_for_payment(p_payment_id);

  if v_pay.contract_id is not null then
    perform app.ledger(v_pay.org_id, v_pay.contract_id, v_pay.received_on, 'pago',
                       format('Pago %s (%s)', v_pay.number, v_pay.method), 0, v_pay.amount_contract, null, p_payment_id);
    v_unapplied := app.allocate_payment(p_payment_id);
    perform app.refresh_contract_status(v_pay.contract_id);
  end if;
  perform app.audit(v_pay.org_id, 'pago_confirmado', 'customer_payments', p_payment_id::text,
                    format('Pago %s confirmado: %s %s', v_pay.number, v_pay.currency, v_pay.amount));
  return v_unapplied;
end $$;

-- Anula un pago aún no confirmado (no tuvo efectos contables).
create or replace function public.rpc_payment_void(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.customer_payments%rowtype;
begin
  select * into v_pay from public.customer_payments where id = p_payment_id for update;
  if not found then perform app.fail('El pago no existe'); end if;
  perform app.require_perm(v_pay.org_id, 'payments.register');
  if v_pay.status <> 'registrado' then
    perform app.fail('Sólo se anulan pagos no confirmados; para un pago confirmado utilice una reversión');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo'); end if;
  update public.customer_payments set status = 'anulado', notes = concat_ws(' · ', notes, 'Anulado: ' || p_reason)
   where id = p_payment_id;
  perform app.audit(v_pay.org_id, 'pago_anulado', 'customer_payments', p_payment_id::text, p_reason);
end $$;

-- Revierte un pago confirmado con trazabilidad completa:
-- aplicaciones negativas, asiento de cuenta corriente y egreso de caja.
create or replace function public.rpc_payment_reverse(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.customer_payments%rowtype;
  v_rev uuid;
  v_mov public.cash_movements%rowtype;
  v_cm  uuid;
begin
  select * into v_pay from public.customer_payments where id = p_payment_id for update;
  if not found then perform app.fail('El pago no existe'); end if;
  perform app.require_perm(v_pay.org_id, 'payments.reverse');
  if v_pay.status <> 'confirmado' then perform app.fail('Sólo se revierten pagos confirmados'); end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo de la reversión'); end if;

  -- 1) Contramovimiento de caja (si el pago generó ingreso).
  select * into v_mov from public.cash_movements
   where customer_payment_id = p_payment_id and kind = 'cobro_cliente' and reverses_id is null;
  if found then
    insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency, description,
                                       reference, counterparty, customer_payment_id, reverses_id, created_by)
    values (v_pay.org_id, v_mov.account_id, app.org_today(v_pay.org_id), 'egreso', 'reversion', v_mov.amount, v_mov.currency,
            format('Reversión de %s: %s', v_pay.number, p_reason), v_mov.reference, v_mov.counterparty,
            p_payment_id, v_mov.id, auth.uid())
    returning id into v_cm;
  end if;

  -- 2) Registro inmutable de la reversión.
  insert into public.payment_reversals (org_id, payment_id, reason, cash_movement_id, reversed_by)
  values (v_pay.org_id, p_payment_id, p_reason, v_cm, auth.uid()) returning id into v_rev;

  -- 3) Aplicaciones compensatorias (negativas) por cuota.
  perform 1 from public.installments i
   where i.id in (select installment_id from public.payment_allocations where payment_id = p_payment_id)
   for update;
  insert into public.payment_allocations (org_id, payment_id, installment_id, amount, reversal_id, created_by)
  select v_pay.org_id, p_payment_id, pa.installment_id, -sum(pa.amount), v_rev, auth.uid()
  from public.payment_allocations pa where pa.payment_id = p_payment_id
  group by pa.installment_id having sum(pa.amount) > 0;

  -- 4) Cuenta corriente.
  if v_pay.contract_id is not null then
    perform app.ledger(v_pay.org_id, v_pay.contract_id, app.org_today(v_pay.org_id), 'reversion_pago',
                       format('Reversión de %s: %s', v_pay.number, p_reason), v_pay.amount_contract, 0, null, p_payment_id);
  end if;

  update public.customer_payments set status = 'revertido' where id = p_payment_id;
  if v_pay.contract_id is not null then
    perform app.refresh_contract_status(v_pay.contract_id);
  end if;
  perform app.audit(v_pay.org_id, 'pago_revertido', 'customer_payments', p_payment_id::text, p_reason);
  return v_rev;
end $$;

-- Posibles duplicados antes de registrar (para advertir en la interfaz).
create or replace function public.rpc_payment_possible_duplicates(
  p_org uuid, p_amount numeric, p_currency text, p_received_on date, p_reference text default null)
returns table (id uuid, number text, customer_name text, received_on date, amount numeric, currency char(3),
               reference text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.require_perm(p_org, 'payments.register');
  return query
  select p.id, p.number, c.full_name, p.received_on, p.amount, p.currency, p.reference, p.status
  from public.customer_payments p
  join public.customers c on c.id = p.customer_id
  where p.org_id = p_org and p.amount = p_amount and p.currency = p_currency
    and p.received_on between p_received_on - 3 and p_received_on + 3
    and (p_reference is null or p.reference is null or p.reference = p_reference)
    and p.status in ('registrado','confirmado')
  order by p.received_on desc
  limit 10;
end $$;

-- -----------------------------------------------------------------------------
-- Ajustes de contrato (siempre mediante aprobación)
-- -----------------------------------------------------------------------------
-- p_kind: 'recargo' | 'nota_credito'
create or replace function public.rpc_contract_request_adjustment(
  p_contract_id uuid, p_kind text, p_amount numeric, p_description text, p_reason text, p_due_date date default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctr public.contracts%rowtype;
  v_out numeric;
  v_id  uuid;
begin
  select * into v_ctr from public.contracts where id = p_contract_id;
  if not found then perform app.fail('El contrato no existe'); end if;
  perform app.require_perm(v_ctr.org_id, 'contracts.adjust');
  if v_ctr.status = 'anulado' then perform app.fail('El contrato está anulado'); end if;
  if p_kind not in ('recargo','nota_credito') then perform app.fail('Tipo de ajuste inválido'); end if;
  if p_amount is null or p_amount <= 0 or not app.money_ok(p_amount, v_ctr.currency) then
    perform app.fail('Importe inválido');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo'); end if;
  if p_kind = 'recargo' and p_due_date is null then perform app.fail('Indique el vencimiento del recargo'); end if;
  if p_kind = 'nota_credito' then
    select outstanding into v_out from public.v_contract_balances where contract_id = p_contract_id;
    if p_amount > v_out then
      perform app.fail(format('La nota de crédito (%s) supera el saldo pendiente (%s)', p_amount, v_out));
    end if;
  end if;
  insert into public.approvals (org_id, kind, entity_type, entity_id, title, reason, amount, currency, payload, requested_by)
  values (v_ctr.org_id, p_kind, 'contract', p_contract_id,
          format('%s en contrato %s', case p_kind when 'recargo' then 'Recargo' else 'Nota de crédito' end, v_ctr.number),
          p_reason, p_amount, v_ctr.currency,
          jsonb_build_object('description', p_description, 'due_date', p_due_date), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Refinanciación: reemplaza el saldo vigente por un nuevo cronograma.
create or replace function public.rpc_contract_request_refinance(
  p_contract_id uuid, p_plan jsonb, p_schedule jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctr public.contracts%rowtype;
  v_out numeric;
  v_principal numeric;
  v_id  uuid;
begin
  select * into v_ctr from public.contracts where id = p_contract_id;
  if not found then perform app.fail('El contrato no existe'); end if;
  perform app.require_perm(v_ctr.org_id, 'contracts.adjust');
  if v_ctr.status <> 'vigente' then perform app.fail('Sólo se refinancian contratos vigentes'); end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo'); end if;
  select coalesce(sum(outstanding), 0) into v_out from public.v_installment_balances
   where contract_id = p_contract_id and status = 'vigente';
  select coalesce(sum((e->>'principal')::numeric), 0) into v_principal
  from jsonb_array_elements(p_schedule) e where e->>'kind' in ('cuota','refuerzo');
  if v_principal <> v_out then
    perform app.fail(format('El capital refinanciado (%s) debe igualar el saldo pendiente (%s)', v_principal, v_out));
  end if;
  insert into public.approvals (org_id, kind, entity_type, entity_id, title, reason, amount, currency, payload, requested_by)
  values (v_ctr.org_id, 'refinanciacion', 'contract', p_contract_id,
          format('Refinanciación del contrato %s', v_ctr.number), p_reason, v_out, v_ctr.currency,
          jsonb_build_object('plan', p_plan, 'schedule', p_schedule, 'outstanding_at_request', v_out), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.apply_refinance(p_approval public.approvals)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctr     public.contracts%rowtype;
  v_out     numeric;
  v_version integer;
  v_plan    uuid;
  v_int     numeric;
  r         record;
begin
  select * into v_ctr from public.contracts where id = p_approval.entity_id for update;
  perform 1 from public.installments where contract_id = v_ctr.id for update;
  select coalesce(sum(outstanding), 0) into v_out from public.v_installment_balances
   where contract_id = v_ctr.id and status = 'vigente';
  if v_out <> (p_approval.payload->>'outstanding_at_request')::numeric then
    perform app.fail('El saldo del contrato cambió desde la solicitud. Genere una nueva propuesta de refinanciación.');
  end if;
  v_version := v_ctr.current_version + 1;
  select coalesce(sum(coalesce((e->>'interest')::numeric, 0)), 0) into v_int
  from jsonb_array_elements(p_approval.payload->'schedule') e;

  for r in select id, outstanding from public.v_installment_balances
           where contract_id = v_ctr.id and status = 'vigente' and outstanding > 0 loop
    update public.installments set amount_cancelled = amount_cancelled + r.outstanding, status = 'reemplazada'
     where id = r.id;
    perform app.ledger(v_ctr.org_id, v_ctr.id, app.org_today(v_ctr.org_id), 'baja_refinanciacion',
                       format('Baja por refinanciación (versión %s)', v_version), 0, r.outstanding, r.id, null, p_approval.id);
  end loop;
  update public.installments set status = 'reemplazada'
   where contract_id = v_ctr.id and status = 'vigente'
     and id in (select id from public.v_installment_balances where contract_id = v_ctr.id and outstanding = 0
                and kind in ('cuota','refuerzo') and amount_applied = 0);

  insert into public.financing_plans (org_id, contract_id, version_no, method, principal, rate_input, rate_convention,
                                      monthly_rate, term_months, first_due_date, balloons, total_interest, total_payable,
                                      created_by)
  values (v_ctr.org_id, v_ctr.id, v_version, p_approval.payload->'plan'->>'method', v_out,
          coalesce((p_approval.payload->'plan'->>'rate_input')::numeric, 0),
          coalesce(p_approval.payload->'plan'->>'rate_convention', 'nominal_annual'),
          coalesce((p_approval.payload->'plan'->>'monthly_rate')::numeric, 0),
          coalesce((p_approval.payload->'plan'->>'term_months')::integer, 0),
          (p_approval.payload->'plan'->>'first_due_date')::date,
          coalesce(p_approval.payload->'plan'->'balloons', '[]'::jsonb), v_int, v_out + v_int, auth.uid())
  returning id into v_plan;

  insert into public.contract_versions (org_id, contract_id, version_no, reason, terms, financing_plan_id, approval_id, created_by)
  values (v_ctr.org_id, v_ctr.id, v_version, 'Refinanciación: ' || coalesce(p_approval.reason, ''), p_approval.payload,
          v_plan, p_approval.id, p_approval.requested_by);

  perform app.insert_schedule(v_ctr.org_id, v_ctr.id, v_plan, v_ctr.currency, app.org_today(v_ctr.org_id),
                              p_approval.payload->'schedule');
  update public.contracts set current_version = v_version where id = v_ctr.id;

  -- Saldos a favor existentes se aplican al nuevo cronograma.
  for r in select id from public.customer_payments where contract_id = v_ctr.id and status = 'confirmado' loop
    perform app.allocate_payment(r.id);
  end loop;
  perform app.refresh_contract_status(v_ctr.id);
end $$;

-- -----------------------------------------------------------------------------
-- Decisión de aprobaciones (con separación de funciones)
-- -----------------------------------------------------------------------------
create or replace function public.rpc_approval_decide(p_approval_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app  public.approvals%rowtype;
  v_ctr  public.contracts%rowtype;
  v_pay  uuid;
  v_seq  integer;
  v_inst uuid;
begin
  select * into v_app from public.approvals where id = p_approval_id for update;
  if not found then perform app.fail('La solicitud no existe'); end if;
  if v_app.status <> 'pendiente' then perform app.fail('La solicitud ya fue resuelta'); end if;
  perform app.require_perm(v_app.org_id, app.approval_permission(v_app.kind));
  if v_app.requested_by = auth.uid() and app.user_role(v_app.org_id) <> 'director' then
    perform app.fail('Una solicitud no puede ser aprobada por quien la emitió (separación de funciones)');
  end if;
  if not p_approve and coalesce(length(trim(p_note)), 0) < 5 then
    perform app.fail('Indique el motivo del rechazo');
  end if;

  update public.approvals
     set status = case when p_approve then 'aprobada' else 'rechazada' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_approval_id;

  case v_app.kind
    when 'descuento', 'precio_bajo_minimo' then
      update public.deals set status = case when p_approve then 'aprobada' else 'borrador' end
       where id = v_app.entity_id and status = 'pendiente_aprobacion';
      if not found then perform app.fail('La operación ya no está pendiente de aprobación'); end if;

    when 'recargo' then
      if p_approve then
        select * into v_ctr from public.contracts where id = v_app.entity_id for update;
        perform app.insert_schedule(v_ctr.org_id, v_ctr.id, null, v_ctr.currency, app.org_today(v_ctr.org_id),
          jsonb_build_array(jsonb_build_object('kind', 'recargo', 'due_date', v_app.payload->>'due_date',
                                               'principal', 0, 'interest', 0, 'fee', v_app.amount,
                                               'description', coalesce(v_app.payload->>'description', 'Recargo autorizado'))));
        select id into v_inst from public.installments where contract_id = v_ctr.id order by seq desc limit 1;
        update public.installments set approval_id = v_app.id where id = v_inst;
        for v_pay in select id from public.customer_payments where contract_id = v_ctr.id and status = 'confirmado' loop
          perform app.allocate_payment(v_pay);
        end loop;
        perform app.refresh_contract_status(v_ctr.id);
      end if;

    when 'nota_credito' then
      if p_approve then
        select * into v_ctr from public.contracts where id = v_app.entity_id for update;
        insert into public.customer_payments (org_id, customer_id, contract_id, received_on, method, currency, amount,
                                              contract_currency, fx_rate_to_contract, amount_contract, notes, status,
                                              approval_id, registered_by, confirmed_by, confirmed_at)
        values (v_ctr.org_id, v_ctr.customer_id, v_ctr.id, app.org_today(v_ctr.org_id), 'nota_credito', v_ctr.currency,
                v_app.amount, v_ctr.currency, 1, v_app.amount, v_app.payload->>'description', 'confirmado',
                v_app.id, v_app.requested_by, auth.uid(), now())
        returning id into v_pay;
        perform app.ledger(v_ctr.org_id, v_ctr.id, app.org_today(v_ctr.org_id), 'nota_credito',
                           coalesce(v_app.payload->>'description', 'Nota de crédito autorizada'), 0, v_app.amount,
                           null, v_pay, v_app.id);
        perform app.allocate_payment(v_pay);
        perform app.refresh_contract_status(v_ctr.id);
      end if;

    when 'refinanciacion' then
      if p_approve then perform app.apply_refinance(v_app); end if;

    when 'tasacion' then
      update public.trade_in_appraisals set status = case when p_approve then 'aprobada' else 'rechazada' end
       where id = v_app.entity_id and status = 'en_revision';

    when 'factura_proveedor' then
      update public.supplier_invoices set status = case when p_approve then 'aprobada' else 'rechazada' end
       where id = v_app.entity_id and status = 'pendiente_aprobacion';
      if p_approve and coalesce((v_app.payload->>'create_vehicle_cost')::boolean, false) then
        insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base,
                                          incurred_on, supplier_id, supplier_invoice_id, created_by, amount_base)
        select si.org_id, si.vehicle_id, coalesce(v_app.payload->>'cost_kind', 'otro'), si.concept, si.amount, si.currency,
               coalesce(app.fx_rate(si.org_id, si.currency, o.base_currency, si.issue_date), 1),
               si.issue_date, si.supplier_id, si.id, si.created_by, 0
        from public.supplier_invoices si join public.organizations o on o.id = si.org_id
        where si.id = v_app.entity_id and si.vehicle_id is not null;
      end if;

    when 'gasto' then
      update public.expenses set status = case when p_approve then 'aprobado' else 'rechazado' end
       where id = v_app.entity_id and status = 'pendiente_aprobacion';
    else
      perform app.fail('Tipo de aprobación no soportado');
  end case;

  perform app.audit(v_app.org_id, case when p_approve then 'aprobacion_aprobada' else 'aprobacion_rechazada' end,
                    'approvals', p_approval_id::text, v_app.title || coalesce(' — ' || p_note, ''));
end $$;

-- -----------------------------------------------------------------------------
-- Trade-in
-- -----------------------------------------------------------------------------
create or replace function public.rpc_tradein_submit(p_appraisal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.trade_in_appraisals%rowtype;
  v_id uuid;
begin
  select * into v from public.trade_in_appraisals where id = p_appraisal_id for update;
  if not found then perform app.fail('La tasación no existe'); end if;
  perform app.require_perm(v.org_id, 'tradein.create');
  if v.status not in ('borrador','rechazada') then perform app.fail('La tasación ya fue enviada'); end if;
  if v.offered_value is null or v.expected_resale_price is null then
    perform app.fail('Complete el valor ofrecido y el precio de reventa esperado');
  end if;
  if v.market_value_estimate is null then
    perform app.fail('Registre el valor de mercado estimado con su fuente y fecha');
  end if;
  if not exists (select 1 from public.appraisal_inspections where appraisal_id = v.id) then
    perform app.fail('Registre al menos una inspección (mecánica, carrocería, neumáticos…)');
  end if;
  update public.trade_in_appraisals set status = 'en_revision' where id = v.id;
  insert into public.approvals (org_id, kind, entity_type, entity_id, title, reason, amount, currency, payload, requested_by)
  values (v.org_id, 'tasacion', 'trade_in', v.id,
          format('Tasación %s — %s %s %s', v.number, v.brand_name, v.model, v.year_model),
          'Revisión de tasación de vehículo usado', v.offered_value, v.currency,
          jsonb_build_object('expected_resale_price', v.expected_resale_price,
                             'estimated_repair_costs', v.estimated_repair_costs,
                             'market_value_estimate', v.market_value_estimate,
                             'market_value_source', v.market_value_source),
          auth.uid())
  returning id into v_id;
  update public.trade_in_appraisals set approval_id = v_id where id = v.id;
  return v_id;
end $$;

create or replace function public.rpc_tradein_customer_decision(p_appraisal_id uuid, p_accepted boolean, p_accepted_value numeric default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.trade_in_appraisals%rowtype;
begin
  select * into v from public.trade_in_appraisals where id = p_appraisal_id for update;
  if not found then perform app.fail('La tasación no existe'); end if;
  perform app.require_perm(v.org_id, 'tradein.create');
  if v.status <> 'aprobada' then perform app.fail('La tasación debe estar aprobada'); end if;
  if p_accepted then
    if p_accepted_value is null or p_accepted_value <= 0 or p_accepted_value > v.offered_value
       or not app.money_ok(p_accepted_value, v.currency) then
      perform app.fail('El valor aceptado debe ser positivo y no superar el valor ofrecido aprobado');
    end if;
    update public.trade_in_appraisals set status = 'aceptada_cliente', accepted_value = p_accepted_value where id = v.id;
  else
    update public.trade_in_appraisals set status = 'anulada' where id = v.id;
  end if;
end $$;

-- Formaliza la adquisición del usado e ingresa la unidad al inventario.
-- p_vehicle: {brand_id, model, version, year_manufacture, year_model, vin, plate, mileage_km, fuel,
--             transmission, color, location, list_price, min_price, price_currency, branch_id, category_id}
create or replace function public.rpc_tradein_acquire(p_appraisal_id uuid, p_vehicle jsonb, p_acquired_on date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v      public.trade_in_appraisals%rowtype;
  v_veh  uuid;
  v_base char(3);
  v_fx   numeric;
begin
  select * into v from public.trade_in_appraisals where id = p_appraisal_id for update;
  if not found then perform app.fail('La tasación no existe'); end if;
  perform app.require_perm(v.org_id, 'tradein.acquire');
  if v.status <> 'aceptada_cliente' then perform app.fail('El cliente debe haber aceptado la tasación'); end if;
  select base_currency into v_base from public.organizations where id = v.org_id;
  v_fx := app.fx_rate(v.org_id, v.currency, v_base, p_acquired_on);
  if v_fx is null then perform app.fail(format('Registre el tipo de cambio %s→%s', v.currency, v_base)); end if;

  insert into public.vehicles (org_id, branch_id, brand_id, category_id, model, version, year_manufacture, year_model, vin,
                               plate, mileage_km, fuel, transmission, color, condition, origin, location,
                               acquisition_date, price_currency, list_price, min_price, physical_status,
                               prep_status, doc_status, created_by, responsible_id)
  values (v.org_id, (p_vehicle->>'branch_id')::uuid, (p_vehicle->>'brand_id')::uuid, (p_vehicle->>'category_id')::uuid,
          coalesce(p_vehicle->>'model', v.model), coalesce(p_vehicle->>'version', v.version),
          coalesce((p_vehicle->>'year_manufacture')::smallint, v.year_model),
          coalesce((p_vehicle->>'year_model')::smallint, v.year_model),
          coalesce(p_vehicle->>'vin', v.vin), coalesce(p_vehicle->>'plate', v.plate),
          coalesce((p_vehicle->>'mileage_km')::integer, v.mileage_km),
          coalesce(p_vehicle->>'fuel', v.fuel, 'nafta'), coalesce(p_vehicle->>'transmission', v.transmission, 'manual'),
          coalesce(p_vehicle->>'color', v.color), 'usado', 'trade_in', p_vehicle->>'location', p_acquired_on,
          coalesce(p_vehicle->>'price_currency', v.currency), (p_vehicle->>'list_price')::numeric,
          (p_vehicle->>'min_price')::numeric, 'recibido', 'pendiente',
          case v.doc_status when 'completa' then 'completa' else 'en_tramite' end, auth.uid(), auth.uid())
  returning id into v_veh;

  insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base,
                                    incurred_on, created_by, amount_base)
  values (v.org_id, v_veh, 'adquisicion', 'Valor de aceptación trade-in ' || v.number, v.accepted_value, v.currency,
          v_fx, p_acquired_on, auth.uid(), 0);
  if v.estimated_repair_costs > 0 then
    insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base,
                                      incurred_on, is_estimate, created_by, amount_base)
    values (v.org_id, v_veh, 'reparacion', 'Reparaciones estimadas en tasación ' || v.number, v.estimated_repair_costs,
            v.currency, v_fx, p_acquired_on, true, auth.uid(), 0);
  end if;

  update public.trade_in_appraisals set status = 'adquirida', vehicle_id = v_veh where id = v.id;
  perform app.audit(v.org_id, 'tradein_adquirido', 'trade_in_appraisals', v.id::text,
                    'Usado ingresado al inventario');
  return v_veh;
end $$;

-- -----------------------------------------------------------------------------
-- Proveedores
-- -----------------------------------------------------------------------------
-- p: {supplier_id, invoice_number, timbrado?, issue_date, due_date, currency, amount, tax_amount?, concept, category,
--     vehicle_id?, create_vehicle_cost?, cost_kind?}
create or replace function public.rpc_supplier_invoice_create(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  uuid;
  v_name text;
begin
  select org_id, name into v_org, v_name from public.suppliers where id = (p->>'supplier_id')::uuid;
  if v_org is null then perform app.fail('El proveedor no existe'); end if;
  perform app.require_perm(v_org, 'payables.create');
  insert into public.supplier_invoices (org_id, supplier_id, invoice_number, timbrado, issue_date, due_date, currency,
                                        amount, tax_amount, concept, category, vehicle_id, created_by)
  values (v_org, (p->>'supplier_id')::uuid, p->>'invoice_number', nullif(p->>'timbrado', ''),
          (p->>'issue_date')::date, (p->>'due_date')::date, p->>'currency', (p->>'amount')::numeric,
          coalesce((p->>'tax_amount')::numeric, 0), p->>'concept', p->>'category', (p->>'vehicle_id')::uuid, auth.uid())
  returning id into v_id;
  insert into public.approvals (org_id, kind, entity_type, entity_id, title, reason, amount, currency, payload, requested_by)
  values (v_org, 'factura_proveedor', 'supplier_invoice', v_id,
          format('Factura %s — %s', p->>'invoice_number', v_name), p->>'concept',
          (p->>'amount')::numeric, p->>'currency',
          jsonb_build_object('create_vehicle_cost', coalesce((p->>'create_vehicle_cost')::boolean, false),
                             'cost_kind', p->>'cost_kind'),
          auth.uid());
  update public.supplier_invoices set approval_id = (select id from public.approvals where entity_id = v_id and status = 'pendiente')
   where id = v_id;
  return v_id;
end $$;

create or replace function public.rpc_supplier_payment_register(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.v_supplier_invoice_balances%rowtype;
  v_pending numeric;
  v_id uuid;
begin
  select * into v_inv from public.v_supplier_invoice_balances where id = (p->>'invoice_id')::uuid;
  if v_inv.id is null then perform app.fail('La factura no existe'); end if;
  perform app.require_perm(v_inv.org_id, 'payables.pay');
  perform 1 from public.supplier_invoices where id = v_inv.id for update;
  if v_inv.status <> 'aprobada' then perform app.fail('Sólo se pagan facturas aprobadas'); end if;
  if (p->>'amount')::numeric > v_inv.outstanding - v_inv.paid_registered_pending then
    perform app.fail(format('El pago supera el saldo pendiente de la factura (%s)', v_inv.outstanding - v_inv.paid_registered_pending));
  end if;
  if not exists (select 1 from public.cash_accounts where id = (p->>'cash_account_id')::uuid and org_id = v_inv.org_id
                 and is_active and currency = v_inv.currency) then
    perform app.fail('Seleccione una cuenta activa en la moneda de la factura');
  end if;
  insert into public.supplier_payments (org_id, supplier_id, invoice_id, paid_on, amount, currency, cash_account_id,
                                        reference, created_by)
  values (v_inv.org_id, v_inv.supplier_id, v_inv.id, (p->>'paid_on')::date, (p->>'amount')::numeric, v_inv.currency,
          (p->>'cash_account_id')::uuid, nullif(p->>'reference', ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.rpc_supplier_payment_confirm(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.supplier_payments%rowtype;
  v_name text;
  v_inv text;
  v_cm uuid;
begin
  select * into v from public.supplier_payments where id = p_payment_id for update;
  if not found then perform app.fail('El pago no existe'); end if;
  perform app.require_perm(v.org_id, 'payables.pay');
  if v.status <> 'registrado' then perform app.fail('Sólo se confirman pagos registrados'); end if;
  select s.name, si.invoice_number into v_name, v_inv
  from public.suppliers s join public.supplier_invoices si on si.id = v.invoice_id where s.id = v.supplier_id;
  insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency, description,
                                     reference, counterparty, supplier_payment_id, created_by)
  values (v.org_id, v.cash_account_id, v.paid_on, 'egreso', 'pago_proveedor', v.amount, v.currency,
          'Pago factura ' || v_inv, v.reference, v_name, v.id, auth.uid())
  returning id into v_cm;
  update public.supplier_payments set status = 'confirmado', confirmed_by = auth.uid(), confirmed_at = now(),
         cash_movement_id = v_cm where id = p_payment_id;
end $$;

-- -----------------------------------------------------------------------------
-- Gastos generales
-- -----------------------------------------------------------------------------
-- p: {expense_date, category, description, amount, currency, supplier_id?}
create or replace function public.rpc_expense_create(p_org uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform app.require_perm(p_org, 'expenses.create');
  insert into public.expenses (org_id, expense_date, category, description, amount, currency, supplier_id, created_by)
  values (p_org, (p->>'expense_date')::date, p->>'category', p->>'description', (p->>'amount')::numeric,
          p->>'currency', (p->>'supplier_id')::uuid, auth.uid())
  returning id into v_id;
  insert into public.approvals (org_id, kind, entity_type, entity_id, title, reason, amount, currency, requested_by)
  values (p_org, 'gasto', 'expense', v_id, 'Gasto: ' || (p->>'description'), p->>'category',
          (p->>'amount')::numeric, p->>'currency', auth.uid());
  update public.expenses set approval_id = (select id from public.approvals where entity_id = v_id and status = 'pendiente')
   where id = v_id;
  return v_id;
end $$;

create or replace function public.rpc_expense_pay(p_expense_id uuid, p_cash_account_id uuid, p_paid_on date, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.expenses%rowtype;
  v_cm uuid;
begin
  select * into v from public.expenses where id = p_expense_id for update;
  if not found then perform app.fail('El gasto no existe'); end if;
  perform app.require_perm(v.org_id, 'cash.register');
  if v.status <> 'aprobado' then perform app.fail('Sólo se pagan gastos aprobados'); end if;
  if not exists (select 1 from public.cash_accounts where id = p_cash_account_id and org_id = v.org_id
                 and is_active and currency = v.currency) then
    perform app.fail('Seleccione una cuenta activa en la moneda del gasto');
  end if;
  insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency, description,
                                     reference, expense_id, created_by)
  values (v.org_id, p_cash_account_id, p_paid_on, 'egreso', 'gasto', v.amount, v.currency,
          'Gasto ' || v.number || ': ' || v.description, p_reference, v.id, auth.uid())
  returning id into v_cm;
  update public.expenses set status = 'pagado', cash_account_id = p_cash_account_id, cash_movement_id = v_cm
   where id = p_expense_id;
  return v_cm;
end $$;

-- -----------------------------------------------------------------------------
-- Caja: movimientos manuales, reversión y conciliación
-- -----------------------------------------------------------------------------
-- p: {account_id, occurred_on, direction, kind (apertura|ajuste|otro), amount, description, reference?, counterparty?}
create or replace function public.rpc_cash_movement_create(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acc public.cash_accounts%rowtype;
  v_id  uuid;
begin
  select * into v_acc from public.cash_accounts where id = (p->>'account_id')::uuid;
  if not found then perform app.fail('La cuenta no existe'); end if;
  perform app.require_perm(v_acc.org_id, 'cash.register');
  if (p->>'kind') not in ('apertura','ajuste','otro') then
    perform app.fail('Los cobros, pagos y gastos se registran desde su módulo');
  end if;
  if coalesce(length(trim(p->>'description')), 0) < 3 then perform app.fail('Describa el movimiento'); end if;
  insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency, description,
                                     reference, counterparty, created_by)
  values (v_acc.org_id, v_acc.id, (p->>'occurred_on')::date, p->>'direction', p->>'kind', (p->>'amount')::numeric,
          v_acc.currency, p->>'description', nullif(p->>'reference', ''), nullif(p->>'counterparty', ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Transferencia entre cuentas de la misma moneda (dos movimientos enlazados por referencia).
create or replace function public.rpc_cash_transfer(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_description text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.cash_accounts%rowtype;
  b public.cash_accounts%rowtype;
  v_ref text := 'TRF-' || substr(gen_random_uuid()::text, 1, 8);
begin
  select * into a from public.cash_accounts where id = p_from;
  select * into b from public.cash_accounts where id = p_to;
  if a.id is null or b.id is null or a.org_id <> b.org_id then perform app.fail('Cuentas inválidas'); end if;
  perform app.require_perm(a.org_id, 'cash.register');
  if a.id = b.id then perform app.fail('Seleccione dos cuentas distintas'); end if;
  if a.currency <> b.currency then perform app.fail('Las transferencias entre monedas requieren un cambio de divisas registrado como dos movimientos'); end if;
  insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency, description, reference, created_by)
  values (a.org_id, a.id, p_date, 'egreso', 'transferencia', p_amount, a.currency, p_description || ' → ' || b.name, v_ref, auth.uid()),
         (a.org_id, b.id, p_date, 'ingreso', 'transferencia', p_amount, b.currency, p_description || ' ← ' || a.name, v_ref, auth.uid());
end $$;

create or replace function public.rpc_cash_movement_reverse(p_movement_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.cash_movements%rowtype;
  v_id uuid;
begin
  select * into v from public.cash_movements where id = p_movement_id for update;
  if not found then perform app.fail('El movimiento no existe'); end if;
  perform app.require_perm(v.org_id, 'cash.reverse');
  if v.kind in ('cobro_cliente','pago_proveedor','gasto') then
    perform app.fail('Este movimiento se revierte desde su origen (pago de cliente, pago a proveedor o gasto)');
  end if;
  if v.reverses_id is not null then perform app.fail('No se revierte una reversión'); end if;
  if exists (select 1 from public.cash_movements where reverses_id = v.id) then
    perform app.fail('El movimiento ya fue revertido');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo'); end if;
  insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency, description,
                                     reference, counterparty, reverses_id, created_by)
  values (v.org_id, v.account_id, app.org_today(v.org_id),
          case v.direction when 'ingreso' then 'egreso' else 'ingreso' end, 'reversion', v.amount, v.currency,
          'Reversión: ' || p_reason, v.reference, v.counterparty, v.id, auth.uid())
  returning id into v_id;
  perform app.audit(v.org_id, 'movimiento_revertido', 'cash_movements', v.id::text, p_reason);
  return v_id;
end $$;

-- Conciliación manual contra un extracto: marca los movimientos verificados y
-- registra la diferencia entre el saldo del extracto y el saldo del sistema.
create or replace function public.rpc_reconciliation_create(
  p_account_id uuid, p_period_end date, p_statement_balance numeric, p_movement_ids uuid[], p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acc  public.cash_accounts%rowtype;
  v_sys  numeric;
  v_id   uuid;
  v_bad  integer;
begin
  select * into v_acc from public.cash_accounts where id = p_account_id;
  if not found then perform app.fail('La cuenta no existe'); end if;
  perform app.require_perm(v_acc.org_id, 'cash.reconcile');
  select count(*) into v_bad from unnest(coalesce(p_movement_ids, '{}')) mid
  where not exists (select 1 from public.cash_movements m where m.id = mid and m.account_id = p_account_id
                    and m.status = 'registrado' and m.occurred_on <= p_period_end);
  if v_bad > 0 then perform app.fail('Hay movimientos no válidos para esta conciliación'); end if;

  select coalesce(sum(case when direction = 'ingreso' then amount else -amount end), 0) into v_sys
  from public.cash_movements where account_id = p_account_id and occurred_on <= p_period_end;

  insert into public.reconciliations (org_id, account_id, period_end, statement_balance, system_balance, status,
                                      notes, created_by, closed_by, closed_at)
  values (v_acc.org_id, p_account_id, p_period_end, p_statement_balance, v_sys,
          case when p_statement_balance = v_sys then 'cerrada' else 'abierta' end, p_notes, auth.uid(),
          case when p_statement_balance = v_sys then auth.uid() end,
          case when p_statement_balance = v_sys then now() end)
  returning id into v_id;

  update public.cash_movements set status = 'conciliado', reconciliation_id = v_id
   where id = any(coalesce(p_movement_ids, '{}'));
  perform app.audit(v_acc.org_id, 'conciliacion', 'reconciliations', v_id::text,
                    format('Extracto %s vs sistema %s', p_statement_balance, v_sys));
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Clientes: detección de duplicados (devuelve sólo datos mínimos)
-- -----------------------------------------------------------------------------
create or replace function public.rpc_customer_duplicates(
  p_org uuid, p_doc_type text, p_doc_number text, p_phone text, p_email text, p_exclude uuid default null)
returns table (id uuid, full_name text, match_on text, seller_name text, visible boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (app.has_perm(p_org, 'customers.create') or app.has_perm(p_org, 'customers.edit')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return query
  select c.id, c.full_name,
         case
           when c.doc_type = p_doc_type and c.doc_normalized = app.normalize_doc(p_doc_number) then 'documento'
           when app.normalize_phone(p_phone) is not null and c.phone_normalized = app.normalize_phone(p_phone) then 'teléfono'
           else 'correo'
         end,
         u.full_name,
         app.can_see_customer(c.org_id, c.assigned_seller_id, c.created_by)
  from public.customers c
  left join public.user_profiles u on u.id = c.assigned_seller_id
  where c.org_id = p_org
    and (p_exclude is null or c.id <> p_exclude)
    and ((c.doc_type = p_doc_type and c.doc_normalized = app.normalize_doc(p_doc_number))
      or (app.normalize_phone(p_phone) is not null and c.phone_normalized = app.normalize_phone(p_phone))
      or (nullif(lower(trim(p_email)), '') is not null and c.email_normalized = lower(trim(p_email))))
  limit 5;
end $$;

-- -----------------------------------------------------------------------------
-- Verificación de consistencia de un contrato
-- -----------------------------------------------------------------------------
create or replace function public.rpc_contract_consistency(p_contract_id uuid)
returns table (ledger_balance numeric, installments_outstanding numeric, unapplied_credit numeric, consistent boolean)
language sql stable
security invoker
set search_path = public, pg_temp
as $$
  select b.ledger_balance, b.outstanding, b.unapplied_credit,
         b.ledger_balance = b.outstanding - b.unapplied_credit
  from public.v_contract_balances b where b.contract_id = p_contract_id
$$;
