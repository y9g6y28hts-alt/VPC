-- =============================================================================
-- Da Silva OS — Funciones transaccionales: helpers, reservas y ventas
--
-- Reglas comunes:
--   * SECURITY DEFINER + verificación explícita de permisos (app.require_perm).
--   * Bloqueo de filas (FOR UPDATE) sobre la unidad/operación antes de validar
--     disponibilidad: dos procesos concurrentes se serializan y el segundo ve
--     el estado ya actualizado por el primero.
--   * Los índices únicos parciales (una reserva activa / una venta por unidad)
--     son la última barrera ante cualquier carrera no prevista.
--   * Errores de negocio: SQLSTATE P0001 con mensaje en español para el usuario.
-- =============================================================================

alter table public.org_settings
  add column require_down_payment_before_delivery boolean not null default true;

-- -----------------------------------------------------------------------------
-- Helpers internos
-- -----------------------------------------------------------------------------
create or replace function app.fail(p_message text)
returns void language plpgsql as $$
begin
  raise exception using message = p_message, errcode = 'P0001';
end $$;

create or replace function app.ledger(
  p_org uuid, p_contract uuid, p_date date, p_kind text, p_description text,
  p_debit numeric, p_credit numeric,
  p_installment uuid default null, p_payment uuid default null, p_approval uuid default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.contract_ledger_entries
    (org_id, contract_id, entry_date, kind, description, debit, credit, installment_id, payment_id, approval_id, created_by)
  values (p_org, p_contract, p_date, p_kind, p_description, coalesce(p_debit, 0), coalesce(p_credit, 0),
          p_installment, p_payment, p_approval, auth.uid())
$$;

-- Fija moneda, tipo de cambio e importe del pago en la moneda del contrato.
create or replace function app.bind_payment_to_contract(p_payment uuid, p_contract uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay  public.customer_payments%rowtype;
  v_ctr  public.contracts%rowtype;
  v_rate numeric;
begin
  select * into v_pay from public.customer_payments where id = p_payment for update;
  select * into v_ctr from public.contracts where id = p_contract;
  if v_pay.customer_id <> v_ctr.customer_id then
    perform app.fail('El pago pertenece a otro cliente');
  end if;
  v_rate := app.fx_rate(v_pay.org_id, v_pay.currency, v_ctr.currency, v_pay.received_on);
  if v_rate is null then
    perform app.fail(format('No hay tipo de cambio %s→%s registrado al %s. Regístrelo antes de continuar.',
                            v_pay.currency, v_ctr.currency, to_char(v_pay.received_on, 'DD/MM/YYYY')));
  end if;
  update public.customer_payments
     set contract_id = p_contract,
         contract_currency = v_ctr.currency,
         fx_rate_to_contract = v_rate,
         amount_contract = app.round_money(v_pay.amount * v_rate, v_ctr.currency)
   where id = p_payment;
end $$;

-- Aplica el saldo disponible de un pago confirmado a las cuotas pendientes,
-- de la más antigua a la más reciente (vencimiento, luego secuencia).
create or replace function app.allocate_payment(p_payment uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay       public.customer_payments%rowtype;
  v_remaining numeric;
  r           record;
  v_apply     numeric;
begin
  select * into v_pay from public.customer_payments where id = p_payment for update;
  if v_pay.contract_id is null or v_pay.status <> 'confirmado' then
    return 0;
  end if;
  select v_pay.amount_contract - coalesce(sum(amount), 0) into v_remaining
  from public.payment_allocations where payment_id = p_payment;

  for r in
    select i.id, i.amount - i.amount_cancelled - coalesce((select sum(pa.amount) from public.payment_allocations pa
                                                           where pa.installment_id = i.id), 0) as outstanding
    from public.installments i
    where i.contract_id = v_pay.contract_id and i.status = 'vigente'
    order by i.due_date, i.seq
    for update of i
  loop
    exit when v_remaining <= 0;
    continue when r.outstanding <= 0;
    v_apply := least(v_remaining, r.outstanding);
    insert into public.payment_allocations (org_id, payment_id, installment_id, amount, created_by)
    values (v_pay.org_id, p_payment, r.id, v_apply, auth.uid());
    v_remaining := v_remaining - v_apply;
  end loop;
  return v_remaining;   -- saldo a favor no aplicado
end $$;

create or replace function app.refresh_contract_status(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_out numeric;
begin
  select coalesce(sum(i.amount - i.amount_cancelled), 0)
         - coalesce((select sum(pa.amount) from public.payment_allocations pa
                     join public.installments i2 on i2.id = pa.installment_id
                     where i2.contract_id = p_contract), 0)
    into v_out
  from public.installments i where i.contract_id = p_contract;
  update public.contracts
     set status = case when v_out = 0 then 'saldado' else 'vigente' end
   where id = p_contract and status in ('vigente','saldado');
end $$;

-- Ingreso de caja por un pago confirmado (no aplica a trade-in ni notas de crédito).
create or replace function app.cash_in_for_payment(p_payment uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay  public.customer_payments%rowtype;
  v_name text;
  v_id   uuid;
begin
  select * into v_pay from public.customer_payments where id = p_payment;
  if v_pay.method in ('trade_in','nota_credito') then
    return null;
  end if;
  select full_name into v_name from public.customers where id = v_pay.customer_id;
  insert into public.cash_movements (org_id, account_id, occurred_on, direction, kind, amount, currency,
                                     description, reference, counterparty, customer_payment_id, created_by)
  values (v_pay.org_id, v_pay.cash_account_id, v_pay.received_on, 'ingreso', 'cobro_cliente', v_pay.amount, v_pay.currency,
          'Cobro ' || v_pay.number, v_pay.reference, v_name, v_pay.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Valida e inserta un cronograma (cuotas + asientos de cuenta corriente).
-- p_schedule: [{kind, due_date, principal, interest, fee?, description?}, ...]
create or replace function app.insert_schedule(
  p_org uuid, p_contract uuid, p_plan uuid, p_currency text, p_entry_date date, p_schedule jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq  integer;
  e      jsonb;
  v_inst uuid;
  v_amt  numeric;
begin
  if jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) = 0 then
    perform app.fail('El cronograma está vacío');
  end if;
  select coalesce(max(seq), 0) into v_seq from public.installments where contract_id = p_contract;
  for e in select value from jsonb_array_elements(p_schedule) loop
    v_seq := v_seq + 1;
    if (e ->> 'kind') not in ('entrega_usado','entrega_inicial','cuota','refuerzo','recargo') then
      perform app.fail('Tipo de cuota inválido: ' || coalesce(e ->> 'kind', 'vacío'));
    end if;
    if not app.money_ok((e ->> 'principal')::numeric, p_currency)
       or not app.money_ok(coalesce((e ->> 'interest')::numeric, 0), p_currency)
       or not app.money_ok(coalesce((e ->> 'fee')::numeric, 0), p_currency) then
      perform app.fail(format('Importe con decimales no válidos para %s en la cuota %s', p_currency, v_seq));
    end if;
    if (e ->> 'due_date')::date < p_entry_date then
      perform app.fail(format('La cuota %s vence antes de la fecha del contrato', v_seq));
    end if;
    insert into public.installments (org_id, contract_id, plan_id, seq, kind, description, due_date, currency,
                                     principal, interest, fee)
    values (p_org, p_contract, p_plan, v_seq, e ->> 'kind', e ->> 'description', (e ->> 'due_date')::date, p_currency,
            coalesce((e ->> 'principal')::numeric, 0), coalesce((e ->> 'interest')::numeric, 0),
            coalesce((e ->> 'fee')::numeric, 0))
    returning id, amount into v_inst, v_amt;
    perform app.ledger(p_org, p_contract, p_entry_date,
                       case when e ->> 'kind' = 'recargo' then 'recargo' else 'cuota_generada' end,
                       coalesce(e ->> 'description', initcap(replace(e ->> 'kind', '_', ' ')) || ' ' || v_seq),
                       v_amt, 0, v_inst);
  end loop;
end $$;

-- Libera reservas vencidas (y la unidad, si seguía reservada por ellas).
create or replace function app.expire_reservations(p_org uuid, p_vehicle uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, vehicle_id from public.reservations
    where org_id = p_org and status = 'activa' and expires_at < now()
      and (p_vehicle is null or vehicle_id = p_vehicle)
    for update skip locked
  loop
    update public.reservations set status = 'vencida', closed_at = now(), close_reason = 'Vencimiento automático'
     where id = r.id;
    perform set_config('app.status_note', 'Reserva vencida', true);
    update public.vehicles set commercial_status = 'disponible', contract_status = 'sin_contrato'
     where id = r.vehicle_id and commercial_status = 'reservado';
    perform set_config('app.status_note', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.rpc_housekeeping(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_member(p_org) then
    raise exception 'No pertenece a la organización' using errcode = '42501';
  end if;
  return app.expire_reservations(p_org);
end $$;

-- -----------------------------------------------------------------------------
-- Reservas
-- -----------------------------------------------------------------------------
-- p_deposit (opcional): {amount, currency, method, cash_account_id, received_on, reference}
create or replace function public.rpc_reservation_create(
  p_vehicle_id uuid, p_customer_id uuid, p_expires_at timestamptz,
  p_notes text default null, p_deposit jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_cust_org uuid;
  v_res     uuid;
  v_amount  numeric := coalesce((p_deposit ->> 'amount')::numeric, 0);
  v_cur     text := coalesce(p_deposit ->> 'currency', 'PYG');
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found then perform app.fail('La unidad no existe'); end if;
  perform app.require_perm(v_vehicle.org_id, 'reservations.manage');
  select org_id into v_cust_org from public.customers where id = p_customer_id;
  if v_cust_org is distinct from v_vehicle.org_id then perform app.fail('El cliente no existe'); end if;

  perform app.expire_reservations(v_vehicle.org_id, p_vehicle_id);
  select * into v_vehicle from public.vehicles where id = p_vehicle_id;

  if v_vehicle.commercial_status <> 'disponible' then
    perform app.fail(format('La unidad %s no está disponible para reservar (estado actual: %s)',
                            v_vehicle.stock_code, replace(v_vehicle.commercial_status, '_', ' ')));
  end if;
  if p_expires_at <= now() then perform app.fail('El vencimiento de la reserva debe ser futuro'); end if;
  if p_expires_at > now() + interval '90 days' then perform app.fail('Una reserva no puede superar 90 días'); end if;

  insert into public.reservations (org_id, vehicle_id, customer_id, deposit_amount, currency, expires_at, notes, created_by)
  values (v_vehicle.org_id, p_vehicle_id, p_customer_id, v_amount, v_cur, p_expires_at, p_notes, auth.uid())
  returning id into v_res;

  perform set_config('app.status_note', 'Reserva creada', true);
  update public.vehicles set commercial_status = 'reservado', contract_status = 'reservado' where id = p_vehicle_id;
  perform set_config('app.status_note', '', true);

  if v_amount > 0 then
    perform app.require_perm(v_vehicle.org_id, 'payments.register');
    insert into public.customer_payments (org_id, customer_id, reservation_id, received_on, method, cash_account_id,
                                          currency, amount, reference, notes, registered_by)
    values (v_vehicle.org_id, p_customer_id, v_res, coalesce((p_deposit ->> 'received_on')::date, app.org_today(v_vehicle.org_id)),
            p_deposit ->> 'method', (p_deposit ->> 'cash_account_id')::uuid, v_cur, v_amount,
            p_deposit ->> 'reference', 'Seña de reserva', auth.uid());
  end if;

  perform app.audit(v_vehicle.org_id, 'reserva_creada', 'reservations', v_res::text,
                    format('Reserva de %s hasta %s', v_vehicle.stock_code, to_char(p_expires_at, 'DD/MM/YYYY HH24:MI')));
  return v_res;
end $$;

create or replace function public.rpc_reservation_cancel(p_reservation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.reservations%rowtype;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then perform app.fail('La reserva no existe'); end if;
  perform app.require_perm(v_res.org_id, 'reservations.manage');
  if v_res.status <> 'activa' then perform app.fail('La reserva no está activa'); end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo de la anulación'); end if;
  perform 1 from public.vehicles where id = v_res.vehicle_id for update;

  update public.reservations set status = 'anulada', closed_at = now(), close_reason = p_reason where id = p_reservation_id;
  perform set_config('app.status_note', 'Reserva anulada: ' || p_reason, true);
  update public.vehicles set commercial_status = 'disponible', contract_status = 'sin_contrato'
   where id = v_res.vehicle_id and commercial_status = 'reservado';
  perform set_config('app.status_note', '', true);
  perform app.audit(v_res.org_id, 'reserva_anulada', 'reservations', p_reservation_id::text, p_reason);
end $$;

-- -----------------------------------------------------------------------------
-- Ventas
-- -----------------------------------------------------------------------------
-- Envía una operación en borrador: queda aprobada o pendiente de aprobación.
create or replace function public.rpc_deal_submit(p_deal_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals%rowtype;
  v_vehicle  public.vehicles%rowtype;
  v_settings public.org_settings%rowtype;
  v_res      public.reservations%rowtype;
  v_app      public.trade_in_appraisals%rowtype;
  v_pct      numeric;
  v_min      numeric;
  v_rate     numeric;
  v_kind     text;
  v_reason   text;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then perform app.fail('La operación no existe'); end if;
  perform app.require_perm(v_deal.org_id, 'deals.create');
  if not app.can_see_deal(v_deal.org_id, v_deal.seller_id) then
    raise exception 'No tiene acceso a esta operación' using errcode = '42501';
  end if;
  if v_deal.status <> 'borrador' then perform app.fail('Sólo se envían operaciones en borrador'); end if;

  select * into v_vehicle from public.vehicles where id = v_deal.vehicle_id;
  if v_vehicle.commercial_status not in ('disponible','reservado') then
    perform app.fail(format('La unidad %s ya no está disponible', v_vehicle.stock_code));
  end if;
  select * into v_res from public.reservations where vehicle_id = v_deal.vehicle_id and status = 'activa';
  if found and v_res.customer_id <> v_deal.customer_id then
    perform app.fail('La unidad está reservada para otro cliente');
  end if;

  if v_deal.payment_type = 'contado' and v_deal.trade_in_value + v_deal.down_payment <> v_deal.sale_price then
    perform app.fail('En una venta de contado, entrega + trade-in deben cubrir el precio de venta');
  end if;
  if v_deal.payment_type = 'financiado' and v_deal.trade_in_value + v_deal.down_payment >= v_deal.sale_price then
    perform app.fail('No queda capital a financiar: registre la operación como contado');
  end if;
  if v_deal.payment_type = 'financiado' and v_deal.financing_terms is null then
    perform app.fail('Defina las condiciones de financiación (plazo, tasa y sistema) antes de enviar la operación');
  end if;

  if v_deal.trade_in_value > 0 then
    if v_deal.trade_in_appraisal_id is null then perform app.fail('El valor de trade-in requiere una tasación'); end if;
    select * into v_app from public.trade_in_appraisals where id = v_deal.trade_in_appraisal_id;
    if v_app.customer_id <> v_deal.customer_id then perform app.fail('La tasación pertenece a otro cliente'); end if;
    if v_app.status not in ('aprobada','aceptada_cliente','adquirida') then
      perform app.fail('La tasación del usado aún no está aprobada');
    end if;
    if v_app.currency <> v_deal.currency then
      perform app.fail('La tasación debe expresarse en la moneda de la operación');
    end if;
    if v_deal.trade_in_value > coalesce(v_app.accepted_value, v_app.offered_value) then
      perform app.fail('El valor de trade-in supera el valor aprobado de la tasación');
    end if;
  end if;

  select * into v_settings from public.org_settings where org_id = v_deal.org_id;
  v_pct := case when v_deal.list_price > 0 then round(v_deal.discount_amount * 100 / v_deal.list_price, 2) else 0 end;

  if v_vehicle.min_price is not null then
    v_rate := app.fx_rate(v_deal.org_id, v_vehicle.price_currency, v_deal.currency, app.org_today(v_deal.org_id));
    v_min := case when v_rate is null then null else app.round_money(v_vehicle.min_price * v_rate, v_deal.currency) end;
    if v_min is null then
      v_kind := 'precio_bajo_minimo';
      v_reason := 'No hay tipo de cambio para comparar con el precio mínimo autorizado';
    elsif v_deal.sale_price < v_min then
      v_kind := 'precio_bajo_minimo';
      v_reason := format('Precio de venta %s por debajo del mínimo autorizado %s', app.fmt_money(v_deal.sale_price, v_deal.currency), app.fmt_money(v_min, v_deal.currency));
    end if;
  end if;
  if v_kind is null and v_deal.discount_amount * 100 > v_deal.list_price * v_settings.max_discount_pct_without_approval then
    v_kind := 'descuento';
    v_reason := format('Descuento de %s%% supera el límite de %s%%', v_pct, v_settings.max_discount_pct_without_approval);
  end if;

  if v_kind is not null then
    insert into public.approvals (org_id, kind, entity_type, entity_id, title, reason, amount, currency, payload, requested_by)
    values (v_deal.org_id, v_kind, 'deal', v_deal.id,
            format('Operación %s — %s', v_deal.number, case v_kind when 'descuento' then 'descuento' else 'precio bajo mínimo' end),
            v_reason, v_deal.discount_amount, v_deal.currency,
            jsonb_build_object('discount_pct', v_pct, 'list_price', v_deal.list_price, 'sale_price', v_deal.sale_price,
                               'min_price', v_min),
            auth.uid());
    update public.deals set status = 'pendiente_aprobacion', requires_approval = true, approval_reason = v_reason
     where id = p_deal_id;
    return 'pendiente_aprobacion';
  end if;

  update public.deals set status = 'aprobada', requires_approval = false, approval_reason = null where id = p_deal_id;
  return 'aprobada';
end $$;

-- Vuelve a borrador para modificar condiciones (anula la aprobación pendiente).
create or replace function public.rpc_deal_reopen(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals%rowtype;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then perform app.fail('La operación no existe'); end if;
  perform app.require_perm(v_deal.org_id, 'deals.create');
  if not app.can_see_deal(v_deal.org_id, v_deal.seller_id) then
    raise exception 'No tiene acceso a esta operación' using errcode = '42501';
  end if;
  if v_deal.status not in ('pendiente_aprobacion','aprobada') then
    perform app.fail('Sólo se reabren operaciones no formalizadas');
  end if;
  update public.approvals set status = 'anulada', decided_at = now(), decided_by = auth.uid(),
         decision_note = 'Operación reabierta para modificar condiciones'
   where entity_id = p_deal_id and status = 'pendiente';
  update public.deals set status = 'borrador' where id = p_deal_id;
end $$;

-- Formaliza la venta: contrato, plan, cuotas, cuenta corriente, trade-in,
-- conversión de reserva y estados de la unidad. Todo o nada.
--   p_plan: {method, rate_input, rate_convention, monthly_rate, term_months, first_due_date, balloons, total_interest}
--   p_schedule: cronograma completo generado por el motor de financiación
create or replace function public.rpc_deal_formalize(
  p_deal_id uuid, p_signed_on date, p_plan jsonb, p_schedule jsonb,
  p_collector_id uuid default null, p_fx_rate_to_base numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals%rowtype;
  v_vehicle  public.vehicles%rowtype;
  v_res      public.reservations%rowtype;
  v_app      public.trade_in_appraisals%rowtype;
  v_base     char(3);
  v_financed numeric;
  v_contract uuid;
  v_plan     uuid;
  v_pay      uuid;
  v_fx       numeric;
  v_sum_used numeric; v_sum_down numeric; v_sum_fin numeric; v_sum_int numeric; v_bad integer;
  r          record;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then perform app.fail('La operación no existe'); end if;
  perform app.require_perm(v_deal.org_id, 'deals.formalize');
  if v_deal.status <> 'aprobada' then
    perform app.fail('Sólo se formalizan operaciones aprobadas (estado actual: ' || replace(v_deal.status, '_', ' ') || ')');
  end if;

  -- Bloqueo de la unidad: serializa ventas concurrentes de la misma unidad.
  select * into v_vehicle from public.vehicles where id = v_deal.vehicle_id for update;
  perform app.expire_reservations(v_deal.org_id, v_deal.vehicle_id);
  select * into v_vehicle from public.vehicles where id = v_deal.vehicle_id;
  if v_vehicle.commercial_status not in ('disponible','reservado') then
    perform app.fail(format('La unidad %s ya no está disponible (estado: %s)', v_vehicle.stock_code,
                            replace(v_vehicle.commercial_status, '_', ' ')));
  end if;
  select * into v_res from public.reservations where vehicle_id = v_deal.vehicle_id and status = 'activa' for update;
  if found and v_res.customer_id <> v_deal.customer_id then
    perform app.fail('La unidad está reservada para otro cliente');
  end if;

  v_financed := v_deal.sale_price - v_deal.trade_in_value - v_deal.down_payment;
  if v_deal.payment_type = 'contado' and v_financed <> 0 then
    perform app.fail('Venta de contado con saldo a financiar');
  end if;

  -- Trade-in: debe estar aceptado por el cliente al valor de la operación.
  if v_deal.trade_in_value > 0 then
    select * into v_app from public.trade_in_appraisals where id = v_deal.trade_in_appraisal_id for update;
    if v_app.status not in ('aceptada_cliente','adquirida') then
      perform app.fail('El cliente debe aceptar la tasación antes de formalizar');
    end if;
    if v_app.accepted_value <> v_deal.trade_in_value then
      perform app.fail('El valor de trade-in no coincide con el valor aceptado en la tasación');
    end if;
  end if;

  -- Validación estructural del cronograma.
  select coalesce(sum((e->>'principal')::numeric) filter (where e->>'kind' = 'entrega_usado'), 0),
         coalesce(sum((e->>'principal')::numeric) filter (where e->>'kind' = 'entrega_inicial'), 0),
         coalesce(sum((e->>'principal')::numeric) filter (where e->>'kind' in ('cuota','refuerzo')), 0),
         coalesce(sum(coalesce((e->>'interest')::numeric, 0)), 0),
         count(*) filter (where e->>'kind' in ('entrega_usado','entrega_inicial') and coalesce((e->>'interest')::numeric, 0) <> 0)
    into v_sum_used, v_sum_down, v_sum_fin, v_sum_int, v_bad
  from jsonb_array_elements(p_schedule) e;
  if v_sum_used <> v_deal.trade_in_value then perform app.fail('El cronograma no refleja el valor del trade-in'); end if;
  if v_sum_down <> v_deal.down_payment then perform app.fail('El cronograma no refleja la entrega inicial'); end if;
  if v_sum_fin <> v_financed then
    perform app.fail(format('El capital de las cuotas (%s) no coincide con el capital financiado (%s)', app.fmt_money(v_sum_fin, v_deal.currency), app.fmt_money(v_financed, v_deal.currency)));
  end if;
  if v_bad > 0 then perform app.fail('Las entregas no pueden llevar intereses'); end if;
  if v_sum_int <> coalesce((p_plan->>'total_interest')::numeric, 0) then
    perform app.fail('El interés total del plan no coincide con el cronograma');
  end if;

  select base_currency into v_base from public.organizations where id = v_deal.org_id;
  v_fx := coalesce(p_fx_rate_to_base, app.fx_rate(v_deal.org_id, v_deal.currency, v_base, p_signed_on));
  if v_fx is null then
    perform app.fail(format('Registre el tipo de cambio %s→%s para formalizar', v_deal.currency, v_base));
  end if;

  insert into public.contracts (org_id, deal_id, customer_id, vehicle_id, currency, sale_price, trade_in_value,
                                down_payment, financed_amount, signed_on, collector_id, created_by)
  values (v_deal.org_id, v_deal.id, v_deal.customer_id, v_deal.vehicle_id, v_deal.currency, v_deal.sale_price,
          v_deal.trade_in_value, v_deal.down_payment, v_financed, p_signed_on, p_collector_id, auth.uid())
  returning id into v_contract;

  insert into public.financing_plans (org_id, contract_id, version_no, method, principal, rate_input, rate_convention,
                                      monthly_rate, term_months, first_due_date, balloons, total_interest, total_payable,
                                      created_by)
  values (v_deal.org_id, v_contract, 1,
          case when v_financed = 0 then 'sin_financiacion' else p_plan->>'method' end,
          v_financed, coalesce((p_plan->>'rate_input')::numeric, 0),
          coalesce(p_plan->>'rate_convention', 'nominal_annual'), coalesce((p_plan->>'monthly_rate')::numeric, 0),
          coalesce((p_plan->>'term_months')::integer, 0), (p_plan->>'first_due_date')::date,
          coalesce(p_plan->'balloons', '[]'::jsonb), v_sum_int, v_financed + v_sum_int, auth.uid())
  returning id into v_plan;

  insert into public.contract_versions (org_id, contract_id, version_no, reason, terms, financing_plan_id, created_by)
  values (v_deal.org_id, v_contract, 1, 'Contrato original',
          jsonb_build_object('sale_price', v_deal.sale_price, 'list_price', v_deal.list_price,
                             'discount_amount', v_deal.discount_amount, 'trade_in_value', v_deal.trade_in_value,
                             'down_payment', v_deal.down_payment, 'financed_amount', v_financed,
                             'currency', v_deal.currency, 'plan', p_plan, 'schedule', p_schedule),
          v_plan, auth.uid());

  perform app.insert_schedule(v_deal.org_id, v_contract, v_plan, v_deal.currency, p_signed_on, p_schedule);

  -- Trade-in como pago en especie (sin movimiento de caja).
  if v_deal.trade_in_value > 0 then
    insert into public.customer_payments (org_id, customer_id, contract_id, received_on, method, currency, amount,
                                          contract_currency, fx_rate_to_contract, amount_contract, reference, notes,
                                          status, registered_by, confirmed_by, confirmed_at)
    values (v_deal.org_id, v_deal.customer_id, v_contract, p_signed_on, 'trade_in', v_deal.currency, v_deal.trade_in_value,
            v_deal.currency, 1, v_deal.trade_in_value, v_app.number,
            format('Vehículo usado %s %s %s', v_app.brand_name, v_app.model, v_app.year_model),
            'confirmado', auth.uid(), auth.uid(), now())
    returning id into v_pay;
    perform app.ledger(v_deal.org_id, v_contract, p_signed_on, 'pago', 'Trade-in ' || v_app.number, 0, v_deal.trade_in_value,
                       null, v_pay);
    perform app.allocate_payment(v_pay);
  end if;

  -- Reserva: se convierte y sus señas pasan al contrato.
  if v_res.id is not null then
    update public.reservations set status = 'convertida', deal_id = v_deal.id, closed_at = now(),
           close_reason = 'Convertida en venta ' || v_deal.number
     where id = v_res.id;
    for r in select id, status, number from public.customer_payments
             where reservation_id = v_res.id and status in ('registrado','confirmado') loop
      perform app.bind_payment_to_contract(r.id, v_contract);
      if r.status = 'confirmado' then
        perform app.ledger(v_deal.org_id, v_contract, p_signed_on, 'pago', 'Seña de reserva ' || r.number, 0,
                           (select amount_contract from public.customer_payments where id = r.id), null, r.id);
        perform app.allocate_payment(r.id);
      end if;
    end loop;
  end if;

  update public.deals set status = 'formalizada', formalized_at = now(), fx_rate_to_base = v_fx where id = v_deal.id;
  perform set_config('app.status_note', 'Venta ' || v_deal.number, true);
  update public.vehicles set commercial_status = 'vendido_pendiente_entrega', contract_status = 'contrato_firmado'
   where id = v_deal.vehicle_id;
  perform set_config('app.status_note', '', true);

  if v_deal.opportunity_id is not null then
    update public.opportunities
       set status = 'ganada',
           stage_id = (select id from public.pipeline_stages where org_id = v_deal.org_id and key = 'venta')
     where id = v_deal.opportunity_id;
  end if;

  perform app.refresh_contract_status(v_contract);
  perform app.audit(v_deal.org_id, 'venta_formalizada', 'deals', v_deal.id::text,
                    format('Venta %s formalizada: %s', v_deal.number, app.fmt_money(v_deal.sale_price, v_deal.currency)));
  return v_contract;
end $$;

create or replace function public.rpc_deal_deliver(p_deal_id uuid, p_delivered_on date, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals%rowtype;
  v_required boolean;
  v_pending  numeric;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then perform app.fail('La operación no existe'); end if;
  perform app.require_perm(v_deal.org_id, 'deals.deliver');
  if v_deal.status <> 'formalizada' then perform app.fail('Sólo se entregan ventas formalizadas'); end if;
  perform 1 from public.vehicles where id = v_deal.vehicle_id for update;

  select require_down_payment_before_delivery into v_required from public.org_settings where org_id = v_deal.org_id;
  if v_required then
    select coalesce(sum(b.outstanding), 0) into v_pending
    from public.v_installment_balances b
    join public.contracts c on c.id = b.contract_id
    where c.deal_id = p_deal_id and b.kind in ('entrega_inicial','entrega_usado');
    if v_pending > 0 then
      perform app.fail(format('La entrega inicial tiene un saldo pendiente de %s. Debe estar cobrada y confirmada antes de entregar.',
                              app.fmt_money(v_pending, v_deal.currency)));
    end if;
  end if;

  update public.deals set status = 'entregada', delivered_at = p_delivered_on::timestamptz,
         notes = coalesce(p_notes, notes) where id = p_deal_id;
  perform set_config('app.status_note', 'Entrega ' || v_deal.number, true);
  update public.vehicles set commercial_status = 'entregado' where id = v_deal.vehicle_id;
  perform set_config('app.status_note', '', true);
  if v_deal.opportunity_id is not null then
    update public.opportunities
       set stage_id = (select id from public.pipeline_stages where org_id = v_deal.org_id and key = 'entrega')
     where id = v_deal.opportunity_id;
  end if;
  perform app.audit(v_deal.org_id, 'venta_entregada', 'deals', p_deal_id::text, 'Entrega física registrada');
end $$;

create or replace function public.rpc_deal_cancel(p_deal_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal     public.deals%rowtype;
  v_contract public.contracts%rowtype;
  v_cash     numeric;
  r          record;
  v_rev      uuid;
begin
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then perform app.fail('La operación no existe'); end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then perform app.fail('Indique el motivo de la anulación'); end if;

  if v_deal.status in ('borrador','pendiente_aprobacion','aprobada') then
    if not (app.has_perm(v_deal.org_id, 'deals.cancel')
            or (app.has_perm(v_deal.org_id, 'deals.create') and v_deal.seller_id = auth.uid())) then
      raise exception 'No tiene permiso para anular esta operación' using errcode = '42501';
    end if;
    update public.approvals set status = 'anulada', decided_at = now(), decided_by = auth.uid(),
           decision_note = 'Operación anulada'
     where entity_id = p_deal_id and status = 'pendiente';
    update public.deals set status = 'anulada', cancelled_at = now(), cancel_reason = p_reason where id = p_deal_id;
    return;
  end if;

  perform app.require_perm(v_deal.org_id, 'deals.cancel');
  if v_deal.status <> 'formalizada' then
    perform app.fail('Una venta entregada no se anula; registre una devolución con dirección');
  end if;

  select * into v_contract from public.contracts where deal_id = p_deal_id for update;
  select coalesce(sum(pa.amount), 0) into v_cash
  from public.payment_allocations pa
  join public.customer_payments p on p.id = pa.payment_id
  where p.contract_id = v_contract.id and p.method <> 'trade_in';
  if v_cash > 0 then
    perform app.fail('El contrato tiene cobros aplicados. Revierta o reintegre los pagos antes de anular la venta.');
  end if;

  -- Revierte el trade-in en especie.
  for r in select id, amount_contract, number from public.customer_payments
           where contract_id = v_contract.id and method = 'trade_in' and status = 'confirmado' loop
    insert into public.payment_reversals (org_id, payment_id, reason, reversed_by)
    values (v_deal.org_id, r.id, 'Anulación de venta: ' || p_reason, auth.uid()) returning id into v_rev;
    insert into public.payment_allocations (org_id, payment_id, installment_id, amount, reversal_id, created_by)
    select v_deal.org_id, r.id, pa.installment_id, -sum(pa.amount), v_rev, auth.uid()
    from public.payment_allocations pa where pa.payment_id = r.id
    group by pa.installment_id having sum(pa.amount) > 0;
    update public.customer_payments set status = 'revertido' where id = r.id;
    perform app.ledger(v_deal.org_id, v_contract.id, app.org_today(v_deal.org_id), 'reversion_pago',
                       'Reversión trade-in ' || r.number, r.amount_contract, 0, null, r.id);
  end loop;

  -- Da de baja el saldo de las cuotas.
  for r in select id, outstanding from public.v_installment_balances where contract_id = v_contract.id and outstanding > 0 loop
    update public.installments set amount_cancelled = amount_cancelled + r.outstanding, status = 'reemplazada' where id = r.id;
    perform app.ledger(v_deal.org_id, v_contract.id, app.org_today(v_deal.org_id), 'baja_refinanciacion',
                       'Baja por anulación de venta', 0, r.outstanding, r.id);
  end loop;

  update public.contracts set status = 'anulado' where id = v_contract.id;
  update public.deals set status = 'anulada', cancelled_at = now(), cancel_reason = p_reason where id = p_deal_id;
  perform set_config('app.status_note', 'Venta anulada: ' || p_reason, true);
  update public.vehicles set commercial_status = 'disponible', contract_status = 'sin_contrato' where id = v_deal.vehicle_id;
  perform set_config('app.status_note', '', true);
  perform app.audit(v_deal.org_id, 'venta_anulada', 'deals', p_deal_id::text, p_reason);
end $$;
