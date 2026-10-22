-- =============================================================================
-- Motor Haus · 0013 Funciones comerciales
-- Negociación, economía de la operación, planes de financiación, aprobaciones,
-- reservas, formalización, entrega y tasaciones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Costes brutos de una unidad (uso interno; no expone datos al cliente)
-- -----------------------------------------------------------------------------
create or replace function app.unit_cost_raw(p_unit uuid, out cost_actual numeric, out cost_estimated numeric, out has_purchase boolean)
language sql stable security definer set search_path = public, app as $$
  select
    coalesce(sum(c.amount_unit_currency) filter (where c.status = 'active' and c.nature = 'actual' and cc.include_in_inventory_cost), 0),
    coalesce(sum(c.amount_unit_currency) filter (where c.status = 'active' and c.nature = 'estimated' and cc.include_in_inventory_cost), 0),
    coalesce(bool_or(c.concept_code = 'purchase_price' and c.status <> 'voided'), false)
  from public.unit_costs c
  join public.cost_concepts cc on cc.organization_id = c.organization_id and cc.code = c.concept_code
  where c.unit_id = p_unit
$$;

create or replace function app.appraisal_economics(p_appraisal uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'recon_costs', coalesce(rc.total, 0),
    'total_cost', a.proposed_acquisition_price + coalesce(rc.total, 0),
    'expected_resale', a.expected_resale_price,
    'estimated_margin', a.expected_resale_price - (a.proposed_acquisition_price + coalesce(rc.total, 0)),
    'estimated_margin_pct', case when coalesce(a.expected_resale_price, 0) > 0 then
       round((a.expected_resale_price - (a.proposed_acquisition_price + coalesce(rc.total, 0))) / a.expected_resale_price * 100, 2) end
  )
  from public.trade_in_appraisals a
  left join lateral (select sum(amount) as total from public.appraisal_costs where appraisal_id = a.id) rc on true
  where a.id = p_appraisal
$$;

-- -----------------------------------------------------------------------------
-- Economía de la operación (fuente única para mesa, aprobación y contrato)
--   Capital financiado = precio negociado + cargos financiados
--                        − crédito neto de trade-in (valor aceptado − cancelación de prenda)
--                        − entrega en efectivo − otros créditos iniciales
-- -----------------------------------------------------------------------------
create or replace function app.deal_economics(p_deal uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  d public.deals;
  v_items jsonb;
  v_trades jsonb;
  v_list numeric; v_neg numeric; v_min_ok boolean;
  v_cost_a numeric; v_cost_e numeric; v_missing_cost int;
  v_trade_credit numeric; v_trade_margin numeric;
  v_principal numeric; v_margin numeric;
begin
  select * into d from public.deals where id = p_deal;
  if not found then raise exception 'MH_NOT_FOUND: operación inexistente'; end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'unit_id', u.id, 'stock_number', u.stock_number,
      'title', concat_ws(' ', u.make, u.model, u.version), 'year', u.model_year, 'category', u.category,
      'list_price', di.list_price, 'minimum_price', di.minimum_price, 'negotiated_price', di.negotiated_price,
      'discount', di.list_price - di.negotiated_price,
      'cost_actual', c.cost_actual, 'cost_estimated', c.cost_estimated, 'has_purchase_cost', c.has_purchase,
      'margin_estimated', di.negotiated_price - c.cost_actual - c.cost_estimated,
      'margin_pct', case when di.negotiated_price > 0 then
         round((di.negotiated_price - c.cost_actual - c.cost_estimated) / di.negotiated_price * 100, 2) end
    ) order by u.stock_number), '[]'::jsonb),
    coalesce(sum(di.list_price), 0), coalesce(sum(di.negotiated_price), 0),
    coalesce(sum(c.cost_actual), 0), coalesce(sum(c.cost_estimated), 0),
    count(*) filter (where not c.has_purchase)
  into v_items, v_list, v_neg, v_cost_a, v_cost_e, v_missing_cost
  from public.deal_items di
  join public.units u on u.id = di.unit_id
  cross join lateral app.unit_cost_raw(u.id) c
  where di.deal_id = p_deal;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'appraisal_id', a.id, 'number', a.number,
      'title', concat_ws(' ', a.make, a.model, a.version, a.year_built::text),
      'accepted_value', t.accepted_value, 'lien_payoff', t.lien_payoff_amount,
      'net_credit', t.accepted_value - t.lien_payoff_amount,
      'max_authorized', a.max_authorized_price, 'expected_resale', a.expected_resale_price,
      'recon_costs', (ae ->> 'recon_costs')::numeric,
      -- Margen futuro estimado de la reventa: no realizado, nunca se suma al margen de la venta.
      'estimated_margin', a.expected_resale_price - t.accepted_value - (ae ->> 'recon_costs')::numeric,
      'appraisal_status', a.status
    ) order by a.number), '[]'::jsonb),
    coalesce(sum(t.accepted_value - t.lien_payoff_amount), 0),
    coalesce(sum(a.expected_resale_price - t.accepted_value - (ae ->> 'recon_costs')::numeric), 0)
  into v_trades, v_trade_credit, v_trade_margin
  from public.deal_trade_ins t
  join public.trade_in_appraisals a on a.id = t.appraisal_id
  cross join lateral app.appraisal_economics(a.id) ae
  where t.deal_id = p_deal;

  v_principal := v_neg + d.financed_charges - v_trade_credit - d.cash_down_payment - d.other_credits;
  v_margin := v_neg - v_cost_a - v_cost_e;

  return jsonb_build_object(
    'deal_id', d.id, 'currency', d.currency,
    'items', v_items,
    'total_list', v_list,
    'total_negotiated', v_neg,
    'discount_amount', v_list - v_neg,
    'discount_pct', case when v_list > 0 then round((v_list - v_neg) / v_list * 100, 3) else 0 end,
    'cost_actual', v_cost_a,
    'cost_estimated_pending', v_cost_e,
    'units_missing_purchase_cost', v_missing_cost,
    'gross_margin_estimated', v_margin,
    'gross_margin_pct', case when v_neg > 0 then round(v_margin / v_neg * 100, 3) end,
    'gross_margin_actual_costs_only', v_neg - v_cost_a,
    'financed_charges', d.financed_charges,
    'cash_down_payment', d.cash_down_payment,
    'other_credits', d.other_credits,
    'trade_ins', v_trades,
    'trade_in_credit', v_trade_credit,
    'trade_in_estimated_margin', v_trade_margin,
    'financed_principal', v_principal
  );
end $$;

create or replace function app.deal_terms_hash(p_deal uuid) returns text
language sql stable security definer set search_path = public, app as $$
  select md5(jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_array(unit_id, negotiated_price) order by unit_id), '[]') from public.deal_items where deal_id = d.id),
    'trades', (select coalesce(jsonb_agg(jsonb_build_array(appraisal_id, accepted_value, lien_payoff_amount) order by appraisal_id), '[]') from public.deal_trade_ins where deal_id = d.id),
    'down', d.cash_down_payment, 'credits', d.other_credits, 'charges', d.financed_charges,
    'plan', d.selected_plan_id,
    'plan_checksum', (select v.checksum from public.financing_plan_versions v
                      join public.financing_plans p on p.id = v.plan_id
                      where p.id = d.selected_plan_id and v.version = p.current_version)
  )::text)
  from public.deals d where d.id = p_deal
$$;

-- Acceso a una operación: lectura total o propia; edición requiere deal.write
-- y, para asesores, ser el vendedor responsable.
create or replace function app.require_deal_access(p_deal public.deals, p_write boolean) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not (app.has_perm(p_deal.organization_id, 'deal.read')
          or (app.has_perm(p_deal.organization_id, 'deal.read_own') and p_deal.salesperson_id = auth.uid())) then
    raise exception 'MH_FORBIDDEN: sin acceso a esta operación' using errcode = '42501';
  end if;
  if p_write then perform app.require_perm(p_deal.organization_id, 'deal.write'); end if;
end $$;

create or replace function public.get_deal_economics(p_deal uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_deal;
  if not found then raise exception 'MH_NOT_FOUND: operación inexistente'; end if;
  perform app.require_deal_access(d, false);
  return app.deal_economics(p_deal);
end $$;

-- -----------------------------------------------------------------------------
-- Validación independiente del calendario producido por el motor financiero.
-- No reimplementa el cálculo de cuotas: verifica que el calendario es coherente
-- (saldos, intereses sobre saldo, tasas por período, fechas y totales).
-- -----------------------------------------------------------------------------
create or replace function app.validate_schedule(
  p_inputs jsonb, p_summary jsonb, p_schedule jsonb, p_principal numeric, p_currency char(3), p_cash_down numeric
) returns void
language plpgsql stable set search_path = public, app as $$
declare
  v_minor int;
  v_system text := p_inputs ->> 'system';
  v_rate_type text := p_inputs ->> 'rateType';
  v_rate numeric := coalesce((p_inputs ->> 'rate')::numeric, 0);
  v_n int := (p_inputs ->> 'termPeriods')::int;
  v_m int := (p_inputs ->> 'monthsPerPeriod')::int;
  v_start date := (p_inputs ->> 'startDate')::date;
  v_first date := (p_inputs ->> 'firstDueDate')::date;
  v_base numeric := (p_summary ->> 'periodicRate')::numeric;
  v_expected_base numeric;
  v_row jsonb; v_k int := 0;
  v_prev_close numeric := p_principal;
  v_open numeric; v_int numeric; v_prin numeric; v_bal numeric; v_pay numeric; v_close numeric;
  v_pr numeric; v_frac numeric; v_exp_frac numeric; v_exp_pr numeric; v_due date;
  v_level numeric; v_tot_int numeric := 0; v_tot_pay numeric := 0;
  v_upfront numeric;
begin
  select minor_units into v_minor from public.currencies where code = p_currency;
  if p_inputs ->> 'currency' is distinct from p_currency then
    raise exception 'MH_VALIDATION: la moneda del plan no coincide con la de la operación';
  end if;
  if (p_inputs ->> 'principal')::numeric is distinct from p_principal then
    raise exception 'MH_VALIDATION: el capital del plan (%) no coincide con el capital financiado de la operación (%); recalcule el plan',
      p_inputs ->> 'principal', p_principal;
  end if;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into v_upfront from jsonb_array_elements(coalesce(p_inputs -> 'upfront', '[]')) x;
  if jsonb_array_length(coalesce(p_inputs -> 'upfront', '[]')) > 0 and v_upfront <> p_cash_down then
    raise exception 'MH_VALIDATION: las entregas iniciales del plan (%) no suman la entrega en efectivo (%)', v_upfront, p_cash_down;
  end if;
  if p_principal = 0 then
    if jsonb_array_length(p_schedule) <> 0 then raise exception 'MH_VALIDATION: sin capital financiado no corresponde un calendario'; end if;
    return;
  end if;
  if v_system not in ('french','german','zero_interest','custom') then raise exception 'MH_VALIDATION: sistema de amortización inválido'; end if;
  if v_m not in (1, 2, 3, 6, 12) or v_n is null or v_n < 1 or v_n > 360 then raise exception 'MH_VALIDATION: plazo o frecuencia inválidos'; end if;
  if v_first <= v_start or v_first > (v_start + make_interval(months => 2 * v_m))::date then
    raise exception 'MH_VALIDATION: el primer vencimiento debe estar dentro de los dos primeros períodos';
  end if;

  v_expected_base := case v_rate_type
    when 'none' then 0
    when 'effective_annual' then round(power(1 + v_rate, v_m / 12.0) - 1, 12)
    when 'nominal_annual' then round(power(1 + v_rate / 12, v_m) - 1, 12)
    when 'effective_monthly' then round(power(1 + v_rate, v_m) - 1, 12)
  end;
  if v_expected_base is null then raise exception 'MH_VALIDATION: tipo de tasa inválido'; end if;
  if v_system = 'zero_interest' and v_expected_base <> 0 then raise exception 'MH_VALIDATION: financiación sin interés con tasa distinta de cero'; end if;
  if abs(v_base - v_expected_base) > 0.000000000001 then
    raise exception 'MH_VALIDATION: tasa periódica % inconsistente con la tasa declarada (esperada %)', v_base, v_expected_base;
  end if;
  if jsonb_array_length(p_schedule) <> v_n then raise exception 'MH_VALIDATION: el calendario no tiene % períodos', v_n; end if;

  for v_row in select value from jsonb_array_elements(p_schedule) loop
    v_k := v_k + 1;
    v_open := (v_row ->> 'openingBalance')::numeric;
    v_int  := (v_row ->> 'interest')::numeric;
    v_prin := (v_row ->> 'principal')::numeric;
    v_bal  := coalesce((v_row ->> 'balloon')::numeric, 0);
    v_pay  := (v_row ->> 'payment')::numeric;
    v_close := (v_row ->> 'closingBalance')::numeric;
    v_pr   := (v_row ->> 'periodRate')::numeric;
    v_frac := (v_row ->> 'periodFraction')::numeric;
    v_due  := (v_row ->> 'dueDate')::date;

    if (v_row ->> 'period')::int <> v_k then raise exception 'MH_VALIDATION: períodos fuera de secuencia'; end if;
    if v_due <> (v_first + make_interval(months => (v_k - 1) * v_m))::date then
      raise exception 'MH_VALIDATION: vencimiento % inconsistente en el período %', v_due, v_k;
    end if;
    if v_open <> v_prev_close then raise exception 'MH_VALIDATION: saldo inicial inconsistente en el período %', v_k; end if;
    if v_k = 1 then
      v_exp_frac := round((v_first - v_start)::numeric / ((v_start + make_interval(months => v_m))::date - v_start), 10);
    else
      v_exp_frac := 1;
    end if;
    if v_frac <> v_exp_frac then raise exception 'MH_VALIDATION: fracción de período inconsistente en el período %', v_k; end if;
    v_exp_pr := case when v_frac = 1 then v_base else round(power(1 + v_base, v_frac) - 1, 12) end;
    if abs(v_pr - v_exp_pr) > 0.000000000001 then raise exception 'MH_VALIDATION: tasa del período % inconsistente', v_k; end if;
    if v_int <> round(v_open * v_pr, v_minor) then
      raise exception 'MH_VALIDATION: interés del período % no corresponde al saldo (esperado %)', v_k, round(v_open * v_pr, v_minor);
    end if;
    if v_prin <> round(v_prin, v_minor) or v_int <> round(v_int, v_minor) then
      raise exception 'MH_VALIDATION: importes con más decimales que la moneda en el período %', v_k;
    end if;
    if v_pay <> v_int + v_prin then raise exception 'MH_VALIDATION: cuota ≠ interés + amortización en el período %', v_k; end if;
    if v_bal < 0 or v_prin - v_bal < 0 then
      raise exception 'MH_VALIDATION: amortización negativa en el período % (la cuota no cubre el interés)', v_k;
    end if;
    if v_close <> v_open - v_prin or v_close < 0 then raise exception 'MH_VALIDATION: saldo final inconsistente en el período %', v_k; end if;

    if v_k < v_n then
      if v_system = 'french' or v_system = 'zero_interest' then
        if v_level is null then v_level := v_pay - v_bal;
        elsif v_pay - v_bal <> v_level then raise exception 'MH_VALIDATION: cuotas no niveladas en sistema francés (período %)', v_k; end if;
      elsif v_system = 'german' then
        if v_level is null then v_level := v_prin - v_bal;
        elsif v_prin - v_bal <> v_level then raise exception 'MH_VALIDATION: amortización no constante en sistema alemán (período %)', v_k; end if;
      end if;
    end if;
    v_tot_int := v_tot_int + v_int;
    v_tot_pay := v_tot_pay + v_pay;
    v_prev_close := v_close;
  end loop;

  if v_prev_close <> 0 then raise exception 'MH_VALIDATION: el calendario no cancela el capital (saldo %)', v_prev_close; end if;
  if (p_summary ->> 'totalInterest')::numeric <> v_tot_int or (p_summary ->> 'totalPayments')::numeric <> v_tot_pay then
    raise exception 'MH_VALIDATION: los totales del resumen no coinciden con el calendario';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Negociación
-- -----------------------------------------------------------------------------
create or replace function public.create_deal(p_org uuid, p_customer uuid, p_unit uuid, p_salesperson uuid default null)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units;
  v_id uuid;
  v_sp uuid := coalesce(p_salesperson, auth.uid());
begin
  perform app.require_perm(p_org, 'deal.write');
  if v_sp <> auth.uid() and not app.has_perm(p_org, 'deal.read') then
    raise exception 'MH_FORBIDDEN: solo puede crear operaciones a su nombre';
  end if;
  if not exists (select 1 from public.memberships where organization_id = p_org and user_id = v_sp and active) then
    raise exception 'MH_VALIDATION: el vendedor no pertenece a la organización';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'MH_NOT_FOUND: cliente inexistente';
  end if;
  select * into u from public.units where id = p_unit and organization_id = p_org;
  if not found then raise exception 'MH_NOT_FOUND: unidad inexistente'; end if;
  if u.commercial_status = 'reserved' and not exists (
      select 1 from public.reservations where unit_id = p_unit and status = 'active' and customer_id = p_customer) then
    raise exception 'MH_CONFLICT: la unidad está reservada para otro cliente';
  end if;
  if u.commercial_status not in ('available','reserved') then
    raise exception 'MH_STATE: la unidad no está disponible para negociar';
  end if;

  insert into public.deals (organization_id, branch_id, number, customer_id, salesperson_id, currency, created_by,
                            proposal_valid_until)
  values (p_org, u.branch_id, app.next_number(p_org, 'deal', 'NEG'), p_customer, v_sp, u.currency, auth.uid(),
          app.today() + 7)
  returning id into v_id;
  insert into public.deal_items (organization_id, deal_id, currency, unit_id, list_price, minimum_price, negotiated_price)
  values (p_org, v_id, u.currency, u.id, u.list_price, u.minimum_price, coalesce(u.offer_price, u.list_price));
  update public.reservations set deal_id = v_id
   where unit_id = p_unit and status = 'active' and customer_id = p_customer and deal_id is null;
  return v_id;
end $$;

create or replace function app.reset_deal_to_draft(p_deal uuid) returns void
language sql security definer set search_path = public, app as $$
  update public.approvals set status = 'void', decision_note = coalesce(decision_note, 'Términos modificados')
   where entity_type = 'deal' and entity_id = p_deal and status = 'pending';
  update public.deals set status = 'draft', terms_hash = null, submitted_at = null, decided_at = null
   where id = p_deal and status in ('pending_approval','approved','rejected');
$$;

create or replace function app.lock_editable_deal(p_deal uuid) returns public.deals
language plpgsql security definer set search_path = public, app as $$
declare d public.deals;
begin
  select * into d from public.deals where id = p_deal for update;
  if not found then raise exception 'MH_NOT_FOUND: operación inexistente'; end if;
  perform app.require_deal_access(d, true);
  if d.status in ('formalized','cancelled') then raise exception 'MH_STATE: la operación está % y no admite cambios', d.status; end if;
  return d;
end $$;

create or replace function public.add_deal_unit(p_deal uuid, p_unit uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals := app.lock_editable_deal(p_deal); u public.units;
begin
  select * into u from public.units where id = p_unit and organization_id = d.organization_id;
  if not found then raise exception 'MH_NOT_FOUND: unidad inexistente'; end if;
  if u.currency <> d.currency then
    raise exception 'MH_VALIDATION: la unidad se comercializa en % y la operación en %; no se mezclan monedas', u.currency, d.currency;
  end if;
  if u.commercial_status not in ('available','reserved') then raise exception 'MH_STATE: la unidad no está disponible'; end if;
  if u.commercial_status = 'reserved' and not exists (
      select 1 from public.reservations where unit_id = p_unit and status = 'active' and customer_id = d.customer_id) then
    raise exception 'MH_CONFLICT: la unidad está reservada para otro cliente';
  end if;
  insert into public.deal_items (organization_id, deal_id, currency, unit_id, list_price, minimum_price, negotiated_price)
  values (d.organization_id, d.id, d.currency, u.id, u.list_price, u.minimum_price, coalesce(u.offer_price, u.list_price));
  perform app.reset_deal_to_draft(p_deal);
exception when unique_violation then
  raise exception 'MH_CONFLICT: la unidad ya forma parte de la operación';
end $$;

create or replace function public.remove_deal_unit(p_deal uuid, p_unit uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals := app.lock_editable_deal(p_deal);
begin
  if (select count(*) from public.deal_items where deal_id = p_deal) <= 1 then
    raise exception 'MH_VALIDATION: la operación debe conservar al menos una unidad';
  end if;
  delete from public.deal_items where deal_id = p_deal and unit_id = p_unit;
  perform app.reset_deal_to_draft(p_deal);
end $$;

create or replace function public.update_deal_terms(
  p_deal uuid, p_items jsonb, p_cash_down numeric, p_other_credits numeric, p_other_credits_note text,
  p_financed_charges numeric, p_financed_charges_note text, p_notes text, p_valid_until date,
  p_expected_version int default null
) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals := app.lock_editable_deal(p_deal); v_item jsonb; v_changed boolean;
begin
  if p_expected_version is not null and d.row_version <> p_expected_version then
    raise exception 'MH_CONFLICT: la operación fue modificada por otro usuario; recargue';
  end if;
  if coalesce(p_cash_down, 0) < 0 or coalesce(p_other_credits, 0) < 0 or coalesce(p_financed_charges, 0) < 0 then
    raise exception 'MH_VALIDATION: los importes no pueden ser negativos';
  end if;
  if p_valid_until is not null and p_valid_until < app.today() then
    raise exception 'MH_VALIDATION: la vigencia de la propuesta no puede estar vencida';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if (v_item ->> 'negotiated_price')::numeric <= 0 then raise exception 'MH_VALIDATION: precio negociado inválido'; end if;
    update public.deal_items set negotiated_price = app.round_money((v_item ->> 'negotiated_price')::numeric, currency)
     where deal_id = p_deal and unit_id = (v_item ->> 'unit_id')::uuid;
    if not found then raise exception 'MH_VALIDATION: unidad ajena a la operación'; end if;
  end loop;
  v_changed := app.deal_terms_hash(p_deal) is distinct from d.terms_hash
    or d.cash_down_payment <> coalesce(p_cash_down, 0) or d.other_credits <> coalesce(p_other_credits, 0)
    or d.financed_charges <> coalesce(p_financed_charges, 0);
  update public.deals set
    cash_down_payment = app.round_money(coalesce(p_cash_down, 0), currency),
    other_credits = app.round_money(coalesce(p_other_credits, 0), currency),
    other_credits_note = nullif(trim(p_other_credits_note), ''),
    financed_charges = app.round_money(coalesce(p_financed_charges, 0), currency),
    financed_charges_note = nullif(trim(p_financed_charges_note), ''),
    notes = p_notes,
    proposal_valid_until = coalesce(p_valid_until, proposal_valid_until)
  where id = p_deal;
  if v_changed then perform app.reset_deal_to_draft(p_deal); end if;
end $$;

create or replace function public.attach_trade_in(p_deal uuid, p_appraisal uuid, p_accepted_value numeric) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals := app.lock_editable_deal(p_deal); a public.trade_in_appraisals;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found or a.organization_id <> d.organization_id then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  if a.customer_id <> d.customer_id then raise exception 'MH_VALIDATION: la tasación pertenece a otro cliente'; end if;
  if a.currency <> d.currency then raise exception 'MH_VALIDATION: la tasación está en % y la operación en %', a.currency, d.currency; end if;
  if a.status not in ('approved') then
    raise exception 'MH_STATE: solo se incorporan tasaciones aprobadas (estado actual: %)', a.status;
  end if;
  if a.deal_id is not null and a.deal_id <> p_deal then raise exception 'MH_CONFLICT: la tasación ya está vinculada a otra operación'; end if;
  if p_accepted_value is null or p_accepted_value <= 0 then raise exception 'MH_VALIDATION: valor aceptado inválido'; end if;
  insert into public.deal_trade_ins (organization_id, deal_id, currency, appraisal_id, accepted_value, lien_payoff_amount)
  values (d.organization_id, p_deal, d.currency, p_appraisal, app.round_money(p_accepted_value, d.currency), a.lien_payoff_amount)
  on conflict (appraisal_id) do update set accepted_value = excluded.accepted_value, lien_payoff_amount = excluded.lien_payoff_amount;
  update public.trade_in_appraisals set deal_id = p_deal where id = p_appraisal;
  perform app.reset_deal_to_draft(p_deal);
end $$;

create or replace function public.detach_trade_in(p_deal uuid, p_appraisal uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals := app.lock_editable_deal(p_deal);
begin
  delete from public.deal_trade_ins where deal_id = p_deal and appraisal_id = p_appraisal;
  update public.trade_in_appraisals set deal_id = null where id = p_appraisal and deal_id = p_deal;
  perform app.reset_deal_to_draft(p_deal);
end $$;

-- -----------------------------------------------------------------------------
-- Planes de financiación (escenarios versionados)
-- -----------------------------------------------------------------------------
create or replace function public.save_financing_plan(
  p_deal uuid, p_label text, p_inputs jsonb, p_summary jsonb, p_schedule jsonb, p_engine_version text
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  d public.deals := app.lock_editable_deal(p_deal);
  e jsonb := app.deal_economics(p_deal);
  v_plan public.financing_plans;
  v_version int;
  v_checksum text;
begin
  if coalesce(length(trim(p_label)), 0) = 0 then raise exception 'MH_VALIDATION: indique un nombre de escenario'; end if;
  if (e ->> 'financed_principal')::numeric < 0 then
    raise exception 'MH_VALIDATION: los créditos iniciales superan el precio; capital financiado negativo';
  end if;
  perform app.validate_schedule(p_inputs, p_summary, p_schedule, (e ->> 'financed_principal')::numeric, d.currency, d.cash_down_payment);
  v_checksum := encode(sha256(convert_to(jsonb_build_object('i', p_inputs, 's', p_summary, 'c', p_schedule)::text, 'UTF8')), 'hex');

  select * into v_plan from public.financing_plans where deal_id = p_deal and label = trim(p_label) for update;
  if not found then
    insert into public.financing_plans (organization_id, deal_id, label, created_by)
    values (d.organization_id, p_deal, trim(p_label), auth.uid()) returning * into v_plan;
    v_version := 1;
  else
    v_version := v_plan.current_version + 1;
    update public.financing_plans set current_version = v_version,
      status = case when status = 'discarded' then 'scenario' else status end
     where id = v_plan.id;
  end if;
  insert into public.financing_plan_versions (organization_id, plan_id, version, engine_version, inputs, summary, schedule, checksum, created_by)
  values (d.organization_id, v_plan.id, v_version, p_engine_version, p_inputs, p_summary, p_schedule, v_checksum, auth.uid());
  if d.selected_plan_id = v_plan.id then perform app.reset_deal_to_draft(p_deal); end if;
  return v_plan.id;
end $$;

create or replace function public.select_financing_plan(p_deal uuid, p_plan uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals := app.lock_editable_deal(p_deal);
begin
  if p_plan is not null and not exists (select 1 from public.financing_plans where id = p_plan and deal_id = p_deal) then
    raise exception 'MH_NOT_FOUND: plan inexistente en esta operación';
  end if;
  update public.financing_plans set status = case when id = p_plan then 'selected' else 'scenario' end
   where deal_id = p_deal and status in ('scenario','selected');
  update public.deals set selected_plan_id = p_plan where id = p_deal;
  perform app.reset_deal_to_draft(p_deal);
end $$;

-- -----------------------------------------------------------------------------
-- Envío a aprobación: evalúa reglas explícitas de org_policies
-- -----------------------------------------------------------------------------
create or replace function public.submit_deal(p_deal uuid) returns text
language plpgsql security definer set search_path = public, app as $$
declare
  d public.deals := app.lock_editable_deal(p_deal);
  pol public.org_policies;
  e jsonb := app.deal_economics(p_deal);
  v_item jsonb; v_trade jsonb;
  v_hash text := app.deal_terms_hash(p_deal);
  v_plan public.financing_plan_versions;
  v_months int; v_eff_annual numeric;
  v_count int := 0;
begin
  select * into pol from public.org_policies where organization_id = d.organization_id;
  if (e ->> 'units_missing_purchase_cost')::int > 0 then
    raise exception 'MH_VALIDATION: hay unidades sin precio de compra registrado; el margen no puede calcularse';
  end if;
  if (e ->> 'financed_principal')::numeric < 0 then
    raise exception 'MH_VALIDATION: los créditos iniciales superan el precio negociado';
  end if;
  if exists (select 1 from jsonb_array_elements(e -> 'trade_ins') t where t ->> 'appraisal_status' <> 'approved') then
    raise exception 'MH_STATE: hay tasaciones vinculadas que no están aprobadas';
  end if;
  if (e ->> 'financed_principal')::numeric > 0 then
    if d.selected_plan_id is null then raise exception 'MH_VALIDATION: seleccione un plan de financiación'; end if;
    select v.* into v_plan from public.financing_plan_versions v join public.financing_plans p on p.id = v.plan_id
     where p.id = d.selected_plan_id and v.version = p.current_version;
    if (v_plan.inputs ->> 'principal')::numeric <> (e ->> 'financed_principal')::numeric then
      raise exception 'MH_VALIDATION: el plan seleccionado fue calculado con otro capital; recalcúlelo';
    end if;
  elsif d.selected_plan_id is not null then
    raise exception 'MH_VALIDATION: operación de contado con plan de financiación seleccionado; quite el plan';
  end if;

  update public.approvals set status = 'void', decision_note = 'Reemplazada por un nuevo envío'
   where entity_type = 'deal' and entity_id = p_deal and status = 'pending';

  for v_item in select * from jsonb_array_elements(e -> 'items') loop
    if (v_item ->> 'negotiated_price')::numeric < (v_item ->> 'minimum_price')::numeric then
      insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
      values (d.organization_id, 'deal', p_deal, 'min_price', 'deal.approve',
        jsonb_build_object('minimum_price', v_item -> 'minimum_price', 'unit', v_item -> 'stock_number'),
        jsonb_build_object('negotiated_price', v_item -> 'negotiated_price'),
        format('Precio de %s por debajo del mínimo autorizado', v_item ->> 'stock_number'), v_hash, auth.uid());
      v_count := v_count + 1;
    end if;
  end loop;
  if (e ->> 'discount_pct')::numeric > pol.max_discount_pct then
    insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
    values (d.organization_id, 'deal', p_deal, 'discount', 'deal.approve',
      jsonb_build_object('max_discount_pct', pol.max_discount_pct),
      jsonb_build_object('discount_pct', e -> 'discount_pct', 'discount_amount', e -> 'discount_amount'),
      format('Descuento de %s%% supera el límite de %s%%', e ->> 'discount_pct', pol.max_discount_pct), v_hash, auth.uid());
    v_count := v_count + 1;
  end if;
  if (e ->> 'gross_margin_pct')::numeric < pol.min_margin_pct then
    insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
    values (d.organization_id, 'deal', p_deal, 'min_margin', 'deal.approve',
      jsonb_build_object('min_margin_pct', pol.min_margin_pct),
      jsonb_build_object('gross_margin_pct', e -> 'gross_margin_pct', 'gross_margin', e -> 'gross_margin_estimated'),
      format('Margen bruto estimado de %s%% inferior al mínimo de %s%%', e ->> 'gross_margin_pct', pol.min_margin_pct), v_hash, auth.uid());
    v_count := v_count + 1;
  end if;
  for v_trade in select * from jsonb_array_elements(e -> 'trade_ins') loop
    if (v_trade ->> 'accepted_value')::numeric > (v_trade ->> 'max_authorized')::numeric then
      insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
      values (d.organization_id, 'deal', p_deal, 'trade_in_value', 'deal.approve',
        jsonb_build_object('max_authorized', v_trade -> 'max_authorized', 'appraisal', v_trade -> 'number'),
        jsonb_build_object('accepted_value', v_trade -> 'accepted_value'),
        format('Valor aceptado del trade-in %s supera el máximo autorizado', v_trade ->> 'number'), v_hash, auth.uid());
      v_count := v_count + 1;
    end if;
  end loop;
  if v_plan.id is not null then
    v_months := (v_plan.inputs ->> 'termPeriods')::int * (v_plan.inputs ->> 'monthsPerPeriod')::int;
    if v_months > pol.max_financing_months then
      insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
      values (d.organization_id, 'deal', p_deal, 'financing_term', 'deal.approve',
        jsonb_build_object('max_months', pol.max_financing_months), jsonb_build_object('months', v_months),
        format('Plazo de %s meses supera el máximo de %s', v_months, pol.max_financing_months), v_hash, auth.uid());
      v_count := v_count + 1;
    end if;
    v_eff_annual := round(power(1 + (v_plan.summary ->> 'periodicRate')::numeric, 12.0 / (v_plan.inputs ->> 'monthsPerPeriod')::int) - 1, 6);
    if v_eff_annual < pol.min_effective_annual_rate then
      insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
      values (d.organization_id, 'deal', p_deal, 'financing_rate', 'deal.approve',
        jsonb_build_object('min_effective_annual_rate', pol.min_effective_annual_rate),
        jsonb_build_object('effective_annual_rate', v_eff_annual),
        format('Tasa efectiva anual %s inferior al mínimo %s', v_eff_annual, pol.min_effective_annual_rate), v_hash, auth.uid());
      v_count := v_count + 1;
    end if;
    if v_plan.inputs ->> 'system' = 'custom' then
      insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, terms_hash, requested_by)
      values (d.organization_id, 'deal', p_deal, 'exception', 'deal.approve',
        jsonb_build_object('standard_systems', jsonb_build_array('french','german','zero_interest')),
        jsonb_build_object('system', 'custom'),
        'Calendario personalizado: requiere autorización', v_hash, auth.uid());
      v_count := v_count + 1;
    end if;
  end if;

  update public.deals
     set status = case when v_count = 0 then 'approved' else 'pending_approval' end,
         terms_hash = v_hash, submitted_at = now(),
         decided_at = case when v_count = 0 then now() end
   where id = p_deal;
  perform app.audit(d.organization_id, 'deal.submit', 'deals', p_deal, null,
    jsonb_build_object('approvals_required', v_count, 'economics', e));
  return case when v_count = 0 then 'approved' else 'pending_approval' end;
end $$;

-- -----------------------------------------------------------------------------
-- Decisión sobre una aprobación (con segregación de funciones)
-- -----------------------------------------------------------------------------
create or replace function public.decide_approval(p_approval uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  a public.approvals;
  pol public.org_policies;
  d public.deals;
  v_pending int; v_rejected int;
begin
  select * into a from public.approvals where id = p_approval for update;
  if not found then raise exception 'MH_NOT_FOUND: aprobación inexistente'; end if;
  perform app.require_perm(a.organization_id, a.required_permission);
  if a.status <> 'pending' then raise exception 'MH_STATE: la aprobación ya está %', a.status; end if;
  if p_decision not in ('approved','rejected') then raise exception 'MH_VALIDATION: decisión inválida'; end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'MH_VALIDATION: registre el fundamento de la decisión'; end if;
  select * into pol from public.org_policies where organization_id = a.organization_id;
  if pol.approval_segregation and a.requested_by = auth.uid() then
    raise exception 'MH_FORBIDDEN: quien solicita una excepción no puede aprobarla';
  end if;

  if a.entity_type = 'deal' then
    select * into d from public.deals where id = a.entity_id for update;
    if pol.approval_segregation and d.salesperson_id = auth.uid() then
      raise exception 'MH_FORBIDDEN: el vendedor de la operación no puede aprobar sus excepciones';
    end if;
    if d.status <> 'pending_approval' or d.terms_hash is distinct from a.terms_hash
       or app.deal_terms_hash(d.id) is distinct from a.terms_hash then
      update public.approvals set status = 'void', decision_note = 'Términos modificados después de la solicitud' where id = a.id;
      raise exception 'MH_STATE: los términos de la operación cambiaron; la solicitud quedó anulada';
    end if;
  end if;

  update public.approvals set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_approval;

  if a.entity_type = 'deal' then
    select count(*) filter (where status = 'pending'), count(*) filter (where status = 'rejected')
      into v_pending, v_rejected
      from public.approvals where entity_type = 'deal' and entity_id = a.entity_id and terms_hash = a.terms_hash;
    if v_rejected > 0 then
      update public.approvals set status = 'void', decision_note = 'Operación rechazada'
       where entity_type = 'deal' and entity_id = a.entity_id and status = 'pending';
      update public.deals set status = 'rejected', decided_at = now() where id = a.entity_id;
    elsif v_pending = 0 then
      update public.deals set status = 'approved', decided_at = now() where id = a.entity_id;
    end if;
  elsif a.entity_type = 'trade_in_appraisal' then
    if p_decision = 'approved' then
      if not exists (select 1 from public.approvals where entity_type = a.entity_type and entity_id = a.entity_id
                     and status = 'pending' and id <> a.id) then
        update public.trade_in_appraisals
           set status = 'approved', max_authorized_price = proposed_acquisition_price, decision_note = p_note
         where id = a.entity_id and status = 'pending_approval';
      end if;
    else
      update public.approvals set status = 'void', decision_note = 'Tasación rechazada'
       where entity_type = a.entity_type and entity_id = a.entity_id and status = 'pending';
      update public.trade_in_appraisals set status = 'rejected', decision_note = p_note where id = a.entity_id;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Reservas (integridad transaccional: bloqueo de fila + índice único parcial)
-- -----------------------------------------------------------------------------
create or replace function app.expire_reservations_for_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare r public.reservations; u public.units;
begin
  for r in select * from public.reservations where unit_id = p_unit and status = 'active' and expires_at <= now() for update loop
    update public.reservations set status = 'expired', closed_at = now(), close_reason = 'Vencimiento automático' where id = r.id;
    select * into u from public.units where id = p_unit;
    if u.commercial_status = 'reserved' then
      update public.units set commercial_status = 'available' where id = p_unit;
      perform app.log_status(u, 'commercial', 'reserved', 'available', 'reservation', 'Reserva vencida');
    end if;
  end loop;
end $$;

create or replace function public.expire_reservations(p_org uuid) returns int
language plpgsql security definer set search_path = public, app as $$
declare v_unit uuid; n int := 0;
begin
  if auth.uid() is not null then perform app.require_perm(p_org, 'reservation.write'); end if;
  for v_unit in select unit_id from public.reservations where organization_id = p_org and status = 'active' and expires_at <= now() loop
    perform app.lock_unit(v_unit);
    perform app.expire_reservations_for_unit(v_unit);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.reserve_unit(
  p_unit uuid, p_customer uuid, p_conditions text, p_hours int default null, p_deal uuid default null,
  p_deposit numeric default 0, p_deposit_currency char(3) default null, p_responsible uuid default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units := app.lock_unit(p_unit);
  pol public.org_policies;
  v_hours int;
  v_id uuid;
begin
  perform app.require_perm(u.organization_id, 'reservation.write');
  perform app.expire_reservations_for_unit(p_unit);
  select * into u from public.units where id = p_unit;
  if u.commercial_status <> 'available' then
    raise exception 'MH_CONFLICT: la unidad % no está disponible (estado: %)', u.stock_number, u.commercial_status;
  end if;
  if not exists (select 1 from public.customers where id = p_customer and organization_id = u.organization_id) then
    raise exception 'MH_NOT_FOUND: cliente inexistente';
  end if;
  if coalesce(length(trim(p_conditions)), 0) < 5 then raise exception 'MH_VALIDATION: registre las condiciones de la reserva'; end if;
  if p_deal is not null and not exists (
      select 1 from public.deals d join public.deal_items i on i.deal_id = d.id
      where d.id = p_deal and d.customer_id = p_customer and i.unit_id = p_unit and d.status not in ('cancelled','formalized')) then
    raise exception 'MH_VALIDATION: la operación indicada no corresponde a esta unidad y cliente';
  end if;
  select * into pol from public.org_policies where organization_id = u.organization_id;
  v_hours := coalesce(p_hours, pol.reservation_default_hours);
  if v_hours < 1 or v_hours > pol.reservation_max_days * 24 then
    raise exception 'MH_VALIDATION: la reserva debe durar entre 1 hora y % días', pol.reservation_max_days;
  end if;

  insert into public.reservations (organization_id, unit_id, customer_id, deal_id, expires_at, deposit_amount,
    deposit_currency, conditions, responsible_user_id, created_by)
  values (u.organization_id, p_unit, p_customer, p_deal, now() + make_interval(hours => v_hours), coalesce(p_deposit, 0),
    case when coalesce(p_deposit, 0) > 0 then coalesce(p_deposit_currency, u.currency) end, p_conditions,
    coalesce(p_responsible, auth.uid()), auth.uid())
  returning id into v_id;
  update public.units set commercial_status = 'reserved' where id = p_unit;
  perform app.log_status(u, 'commercial', 'available', 'reserved', 'reservation', p_conditions);
  return v_id;
exception when unique_violation then
  raise exception 'MH_CONFLICT: la unidad ya tiene una reserva activa';
end $$;

create or replace function public.release_reservation(p_reservation uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare r public.reservations; u public.units;
begin
  select * into r from public.reservations where id = p_reservation;
  if not found then raise exception 'MH_NOT_FOUND: reserva inexistente'; end if;
  u := app.lock_unit(r.unit_id);
  perform app.require_perm(r.organization_id, 'reservation.write');
  select * into r from public.reservations where id = p_reservation for update;
  if r.status <> 'active' then raise exception 'MH_STATE: la reserva no está activa'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'MH_VALIDATION: indique el motivo de la liberación'; end if;
  update public.reservations set status = 'released', closed_at = now(), close_reason = p_reason where id = p_reservation;
  if u.commercial_status = 'reserved' then
    update public.units set commercial_status = 'available' where id = u.id;
    perform app.log_status(u, 'commercial', 'reserved', 'available', 'reservation', p_reason);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Formalización: del acuerdo a las obligaciones
-- -----------------------------------------------------------------------------
create or replace function public.formalize_deal(p_deal uuid, p_contract_date date default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  d public.deals;
  e jsonb;
  v_date date := coalesce(p_contract_date, app.today());
  v_unit record;
  v_plan public.financing_plan_versions;
  v_contract uuid;
  v_number text;
  v_seq int := 0;
  v_row jsonb;
  v_up jsonb;
  v_principal numeric;
  v_upfront jsonb;
begin
  select * into d from public.deals where id = p_deal for update;
  if not found then raise exception 'MH_NOT_FOUND: operación inexistente'; end if;
  perform app.require_perm(d.organization_id, 'deal.formalize');
  perform app.require_deal_access(d, false);
  if d.status <> 'approved' then raise exception 'MH_STATE: solo se formalizan operaciones aprobadas (estado: %)', d.status; end if;
  if app.deal_terms_hash(p_deal) is distinct from d.terms_hash then
    raise exception 'MH_STATE: los términos cambiaron después de la aprobación; vuelva a enviarla';
  end if;
  if v_date <> app.today() then
    perform app.require_perm(d.organization_id, 'contract.backdate');
    if v_date > app.today() then raise exception 'MH_VALIDATION: la fecha del contrato no puede ser futura'; end if;
  end if;

  -- Bloqueo ordenado de unidades y nueva comprobación de disponibilidad real.
  for v_unit in select u.id, u.commercial_status, u.stock_number from public.units u
                join public.deal_items i on i.unit_id = u.id where i.deal_id = p_deal order by u.id for update of u loop
    perform app.expire_reservations_for_unit(v_unit.id);
    if not exists (select 1 from public.units where id = v_unit.id and (
         commercial_status = 'available'
         or (commercial_status = 'reserved' and exists (
               select 1 from public.reservations r where r.unit_id = v_unit.id and r.status = 'active'
               and r.customer_id = d.customer_id)))) then
      raise exception 'MH_CONFLICT: la unidad % ya no está disponible para esta operación', v_unit.stock_number;
    end if;
  end loop;

  e := app.deal_economics(p_deal);
  v_principal := (e ->> 'financed_principal')::numeric;
  if v_principal < 0 then raise exception 'MH_VALIDATION: capital financiado negativo'; end if;
  if v_principal > 0 then
    select v.* into v_plan from public.financing_plan_versions v join public.financing_plans p on p.id = v.plan_id
     where p.id = d.selected_plan_id and v.version = p.current_version;
    if not found then raise exception 'MH_VALIDATION: falta el plan de financiación seleccionado'; end if;
    perform app.validate_schedule(v_plan.inputs, v_plan.summary, v_plan.schedule, v_principal, d.currency, d.cash_down_payment);
    if (v_plan.inputs ->> 'startDate')::date <> v_date then
      raise exception 'MH_VALIDATION: el plan comienza el % y el contrato se firma el %; recalcule el plan', v_plan.inputs ->> 'startDate', v_date;
    end if;
  end if;

  v_number := app.next_number(d.organization_id, 'contract', 'CTO', v_date);
  insert into public.sales_contracts (organization_id, number, deal_id, customer_id, salesperson_id, currency, contract_date,
    total_price, upfront_total, financed_principal, created_by)
  values (d.organization_id, v_number, d.id, d.customer_id, d.salesperson_id, d.currency, v_date,
    (e ->> 'total_negotiated')::numeric, d.cash_down_payment, v_principal, auth.uid())
  returning id into v_contract;

  insert into public.contract_versions (organization_id, contract_id, version, reason, terms, plan_version_id, plan_checksum, created_by)
  values (d.organization_id, v_contract, 1, 'Formalización',
    jsonb_build_object('economics', e, 'deal_number', d.number, 'terms_hash', d.terms_hash,
      'policies', (select to_jsonb(p) - 'organization_id' from public.org_policies p where p.organization_id = d.organization_id),
      'plan', case when v_plan.id is not null then jsonb_build_object('inputs', v_plan.inputs, 'summary', v_plan.summary,
        'engine_version', v_plan.engine_version) end),
    v_plan.id, v_plan.checksum, auth.uid());

  -- Entregas iniciales (una o varias)
  v_upfront := coalesce(v_plan.inputs -> 'upfront', '[]'::jsonb);
  if d.cash_down_payment > 0 then
    if jsonb_array_length(v_upfront) = 0 then
      v_upfront := jsonb_build_array(jsonb_build_object('dueDate', v_date, 'amount', d.cash_down_payment, 'label', 'Entrega inicial'));
    end if;
    for v_up in select * from jsonb_array_elements(v_upfront) loop
      insert into public.receivable_installments (organization_id, contract_id, currency, contract_version, plan_version_id,
        customer_id, seq, kind, label, due_date, principal_amount, interest_amount)
      values (d.organization_id, v_contract, d.currency, 1, v_plan.id, d.customer_id, v_seq, 'down_payment',
        coalesce(v_up ->> 'label', 'Entrega inicial'), (v_up ->> 'dueDate')::date, (v_up ->> 'amount')::numeric, 0);
      v_seq := v_seq + 1;
    end loop;
  end if;

  -- Cuotas del calendario validado; los refuerzos son obligaciones separadas.
  if v_plan.id is not null then
    for v_row in select * from jsonb_array_elements(v_plan.schedule) loop
      insert into public.receivable_installments (organization_id, contract_id, currency, contract_version, plan_version_id,
        customer_id, seq, kind, label, due_date, principal_amount, interest_amount)
      values (d.organization_id, v_contract, d.currency, 1, v_plan.id, d.customer_id, v_seq, 'installment',
        format('Cuota %s/%s', v_row ->> 'period', v_plan.inputs ->> 'termPeriods'), (v_row ->> 'dueDate')::date,
        (v_row ->> 'principal')::numeric - coalesce((v_row ->> 'balloon')::numeric, 0), (v_row ->> 'interest')::numeric);
      v_seq := v_seq + 1;
      if coalesce((v_row ->> 'balloon')::numeric, 0) > 0 then
        insert into public.receivable_installments (organization_id, contract_id, currency, contract_version, plan_version_id,
          customer_id, seq, kind, label, due_date, principal_amount, interest_amount)
        values (d.organization_id, v_contract, d.currency, 1, v_plan.id, d.customer_id, v_seq, 'balloon',
          format('Refuerzo período %s', v_row ->> 'period'), (v_row ->> 'dueDate')::date, (v_row ->> 'balloon')::numeric, 0);
        v_seq := v_seq + 1;
      end if;
    end loop;
  end if;

  -- Una cuota con capital cero e interés cero no es una obligación; la restricción lo impide.
  if (select coalesce(sum(principal_amount), 0) from public.receivable_installments where contract_id = v_contract)
     <> d.cash_down_payment + v_principal then
    raise exception 'MH_VALIDATION: las obligaciones generadas no reconcilian con el contrato';
  end if;

  -- Unidades vendidas, costes congelados como referencia
  update public.deal_items i set
    cost_actual_snapshot = (app.unit_cost_raw(i.unit_id)).cost_actual,
    cost_estimated_snapshot = (app.unit_cost_raw(i.unit_id)).cost_estimated
  where i.deal_id = p_deal;
  for v_unit in select u.* from public.units u join public.deal_items i on i.unit_id = u.id where i.deal_id = p_deal loop
    update public.units set commercial_status = 'sold_pending_delivery', sold_on = v_date where id = v_unit.id;
    insert into public.unit_status_events (organization_id, unit_id, dimension, from_status, to_status, source, reason, actor_id)
    values (d.organization_id, v_unit.id, 'commercial', v_unit.commercial_status, 'sold_pending_delivery', 'deal',
            'Contrato ' || v_number, auth.uid());
  end loop;
  update public.reservations set status = 'converted', closed_at = now(), close_reason = 'Contrato ' || v_number
   where status = 'active' and unit_id in (select unit_id from public.deal_items where deal_id = p_deal);
  update public.trade_in_appraisals a set status = 'accepted', accepted_value = t.accepted_value
    from public.deal_trade_ins t where t.appraisal_id = a.id and t.deal_id = p_deal;
  update public.financing_plans set status = case when id = d.selected_plan_id then 'contracted' else 'discarded' end
   where deal_id = p_deal;
  update public.deals set status = 'formalized', formalized_at = now() where id = p_deal;
  update public.sales_opportunities set stage = 'won' where deal_id = p_deal;

  perform app.audit(d.organization_id, 'deal.formalize', 'sales_contracts', v_contract, null,
    jsonb_build_object('number', v_number, 'deal', d.number, 'financed_principal', v_principal,
                       'obligations', v_seq, 'plan_checksum', v_plan.checksum));
  return v_contract;
end $$;

create or replace function public.cancel_deal(p_deal uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.deals; r record;
begin
  select * into d from public.deals where id = p_deal for update;
  if not found then raise exception 'MH_NOT_FOUND: operación inexistente'; end if;
  perform app.require_deal_access(d, false);
  if not (app.has_perm(d.organization_id, 'deal.cancel') or (d.salesperson_id = auth.uid() and d.status = 'draft')) then
    raise exception 'MH_FORBIDDEN: se requiere deal.cancel' using errcode = '42501';
  end if;
  if d.status in ('formalized','cancelled') then
    raise exception 'MH_STATE: una operación % no se cancela desde aquí', d.status;
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo de la cancelación'; end if;
  for r in select id from public.reservations where deal_id = p_deal and status = 'active' loop
    perform public.release_reservation(r.id, 'Operación cancelada: ' || p_reason);
  end loop;
  update public.approvals set status = 'void', decision_note = 'Operación cancelada'
   where entity_type = 'deal' and entity_id = p_deal and status = 'pending';
  update public.trade_in_appraisals set deal_id = null where deal_id = p_deal;
  delete from public.deal_trade_ins where deal_id = p_deal;
  update public.deals set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_deal;
  update public.sales_opportunities set stage = 'lost', lost_reason = p_reason where deal_id = p_deal;
end $$;

-- -----------------------------------------------------------------------------
-- Entrega
-- -----------------------------------------------------------------------------
create or replace function public.deliver_unit(p_unit uuid, p_delivered_on date default null, p_notes text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units := app.lock_unit(p_unit);
  pol public.org_policies;
  v_contract public.sales_contracts;
  v_date date := coalesce(p_delivered_on, app.today());
  v_pending numeric;
begin
  perform app.require_perm(u.organization_id, 'deal.deliver');
  if u.commercial_status <> 'sold_pending_delivery' then raise exception 'MH_STATE: la unidad no está vendida pendiente de entrega'; end if;
  if u.preparation_status <> 'ready' then raise exception 'MH_STATE: la preparación de la unidad no está completa'; end if;
  if exists (select 1 from public.preparation_tasks where unit_id = p_unit and mandatory and status = 'pending') then
    raise exception 'MH_STATE: hay tareas obligatorias pendientes';
  end if;
  if exists (select 1 from public.unit_documents where unit_id = p_unit and required_for_sale and status = 'pending') then
    raise exception 'MH_STATE: hay documentación obligatoria pendiente';
  end if;
  select c.* into v_contract from public.sales_contracts c
    join public.deal_items i on i.deal_id = c.deal_id
   where i.unit_id = p_unit and c.status <> 'cancelled' order by c.contract_date desc limit 1;
  if not found then raise exception 'MH_STATE: no existe contrato vigente para la unidad'; end if;
  if v_date < v_contract.contract_date or v_date > app.today() then raise exception 'MH_VALIDATION: fecha de entrega inválida'; end if;
  select * into pol from public.org_policies where organization_id = u.organization_id;
  if pol.require_full_payment_before_delivery then
    select coalesce(sum(outstanding), 0) into v_pending from public.installment_status where contract_id = v_contract.id;
    if v_pending > 0 then raise exception 'MH_STATE: la política exige pago total antes de la entrega (pendiente %)', v_pending; end if;
  elsif pol.require_down_payment_before_delivery then
    select coalesce(sum(outstanding), 0) into v_pending from public.installment_status
     where contract_id = v_contract.id and kind = 'down_payment';
    if v_pending > 0 then raise exception 'MH_STATE: la entrega inicial no está cobrada y confirmada (pendiente %)', v_pending; end if;
  end if;
  update public.units set commercial_status = 'delivered', delivered_on = v_date where id = p_unit;
  perform app.log_status(u, 'commercial', 'sold_pending_delivery', 'delivered', 'delivery', coalesce(p_notes, 'Entrega al cliente'));
end $$;

-- -----------------------------------------------------------------------------
-- Tasaciones
-- -----------------------------------------------------------------------------
create or replace function app.appraisals_guard() returns trigger
language plpgsql as $$
begin
  if not app.is_direct_client() then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'MH_FORBIDDEN: use create_appraisal()';
  end if;
  if old.status not in ('draft','inspected','valued') then
    raise exception 'MH_STATE: la tasación está % y no admite edición directa', old.status;
  end if;
  if new.status <> old.status or new.accepted_value is distinct from old.accepted_value
     or new.acquired_unit_id is distinct from old.acquired_unit_id or new.deal_id is distinct from old.deal_id
     or new.max_authorized_price is distinct from old.max_authorized_price
     or new.market_value_estimate is distinct from old.market_value_estimate
     or new.proposed_acquisition_price is distinct from old.proposed_acquisition_price
     or new.expected_resale_price is distinct from old.expected_resale_price
     or new.uncertainty is distinct from old.uncertainty or new.lien_payoff_amount <> old.lien_payoff_amount
     or new.currency <> old.currency or new.customer_id <> old.customer_id or new.number <> old.number
     or new.organization_id <> old.organization_id then
    raise exception 'MH_FORBIDDEN: la valoración y el estado se registran con value_appraisal()';
  end if;
  return new;
end $$;
create trigger trade_in_appraisals_guard before insert or update on public.trade_in_appraisals
  for each row execute function app.appraisals_guard();

create or replace function public.create_appraisal(p_org uuid, p_customer uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  perform app.require_perm(p_org, 'tradein.write');
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then
    raise exception 'MH_NOT_FOUND: cliente inexistente';
  end if;
  insert into public.trade_in_appraisals (organization_id, number, customer_id, category, make, model, version, year_built,
    usage_value, usage_unit, identifier_kind, identifier_value, history_notes, currency, appraiser_id, created_by)
  values (p_org, app.next_number(p_org, 'appraisal', 'TAS'), p_customer, coalesce(p_data ->> 'category', 'other'),
    p_data ->> 'make', p_data ->> 'model', p_data ->> 'version', (p_data ->> 'year_built')::smallint,
    (p_data ->> 'usage_value')::numeric, coalesce(p_data ->> 'usage_unit', 'km'), p_data ->> 'identifier_kind',
    p_data ->> 'identifier_value', p_data ->> 'history_notes', p_data ->> 'currency',
    coalesce(nullif(p_data ->> 'appraiser_id', '')::uuid, auth.uid()), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_appraisal_inspection(p_appraisal uuid, p_items jsonb, p_conditions jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.trade_in_appraisals; v jsonb;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  perform app.require_perm(a.organization_id, 'tradein.write');
  if a.status not in ('draft','inspected','valued') then raise exception 'MH_STATE: la tasación está %', a.status; end if;
  for v in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    insert into public.appraisal_inspections (organization_id, appraisal_id, item, result, notes, inspected_by)
    values (a.organization_id, p_appraisal, v ->> 'item', v ->> 'result', v ->> 'notes', auth.uid())
    on conflict (appraisal_id, item) do update set result = excluded.result, notes = excluded.notes,
      inspected_by = excluded.inspected_by, inspected_at = now();
  end loop;
  update public.trade_in_appraisals set
    body_condition = coalesce(p_conditions ->> 'body_condition', body_condition),
    interior_condition = coalesce(p_conditions ->> 'interior_condition', interior_condition),
    tires_condition = coalesce(p_conditions ->> 'tires_condition', tires_condition),
    mechanical_condition = coalesce(p_conditions ->> 'mechanical_condition', mechanical_condition),
    documentation_status = coalesce(p_conditions ->> 'documentation_status', documentation_status),
    inspection_notes = coalesce(p_conditions ->> 'inspection_notes', inspection_notes),
    inspector_report = coalesce(p_conditions ->> 'inspector_report', inspector_report),
    status = case when status = 'draft' then 'inspected' else status end
  where id = p_appraisal;
end $$;

create or replace function public.add_appraisal_cost(p_appraisal uuid, p_concept text, p_amount numeric, p_description text) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare a public.trade_in_appraisals; v_id uuid;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  perform app.require_perm(a.organization_id, 'tradein.write');
  if a.status not in ('draft','inspected','valued') then raise exception 'MH_STATE: la tasación está %', a.status; end if;
  insert into public.appraisal_costs (organization_id, appraisal_id, concept, description, amount, created_by)
  values (a.organization_id, p_appraisal, p_concept, p_description, app.round_money(p_amount, a.currency), auth.uid())
  returning id into v_id;
  if a.status = 'valued' then update public.trade_in_appraisals set status = 'inspected' where id = p_appraisal; end if;
  return v_id;
end $$;

create or replace function public.remove_appraisal_cost(p_cost uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.trade_in_appraisals; c public.appraisal_costs;
begin
  select * into c from public.appraisal_costs where id = p_cost;
  if not found then raise exception 'MH_NOT_FOUND: coste inexistente'; end if;
  select * into a from public.trade_in_appraisals where id = c.appraisal_id for update;
  perform app.require_perm(a.organization_id, 'tradein.write');
  if a.status not in ('draft','inspected','valued') then raise exception 'MH_STATE: la tasación está %', a.status; end if;
  delete from public.appraisal_costs where id = p_cost;
  if a.status = 'valued' then update public.trade_in_appraisals set status = 'inspected' where id = a.id; end if;
end $$;

create or replace function public.value_appraisal(
  p_appraisal uuid, p_market_value numeric, p_market_source text, p_market_date date,
  p_proposed_price numeric, p_expected_resale numeric, p_uncertainty text, p_lien_payoff numeric default 0
) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare a public.trade_in_appraisals;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  perform app.require_perm(a.organization_id, 'tradein.write');
  if a.status not in ('inspected','valued') then
    raise exception 'MH_STATE: complete la inspección antes de valorar (estado: %)', a.status;
  end if;
  if coalesce(length(trim(p_market_source)), 0) < 3 or p_market_date is null then
    raise exception 'MH_VALIDATION: el valor de mercado exige fuente y fecha de referencia';
  end if;
  if p_market_date > app.today() then raise exception 'MH_VALIDATION: la fecha de referencia no puede ser futura'; end if;
  if p_proposed_price is null or p_proposed_price <= 0 or p_expected_resale is null or p_expected_resale < 0 then
    raise exception 'MH_VALIDATION: precio propuesto y precio de reventa son obligatorios';
  end if;
  update public.trade_in_appraisals set
    market_value_estimate = app.round_money(p_market_value, currency), market_value_source = p_market_source,
    market_value_date = p_market_date, proposed_acquisition_price = app.round_money(p_proposed_price, currency),
    expected_resale_price = app.round_money(p_expected_resale, currency), uncertainty = p_uncertainty,
    lien_payoff_amount = app.round_money(coalesce(p_lien_payoff, 0), currency), status = 'valued',
    max_authorized_price = null
  where id = p_appraisal;
  return app.appraisal_economics(p_appraisal);
end $$;

create or replace function public.submit_appraisal(p_appraisal uuid) returns text
language plpgsql security definer set search_path = public, app as $$
declare
  a public.trade_in_appraisals;
  pol public.org_policies;
  e jsonb;
  v_count int := 0;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  perform app.require_perm(a.organization_id, 'tradein.write');
  if a.status <> 'valued' then raise exception 'MH_STATE: la tasación debe estar valorada (estado: %)', a.status; end if;
  if a.documentation_status in ('pending') then raise exception 'MH_VALIDATION: registre el estado documental'; end if;
  select * into pol from public.org_policies where organization_id = a.organization_id;
  e := app.appraisal_economics(p_appraisal);
  update public.approvals set status = 'void', decision_note = 'Reemplazada por un nuevo envío'
   where entity_type = 'trade_in_appraisal' and entity_id = p_appraisal and status = 'pending';

  if (e ->> 'estimated_margin_pct') is null or (e ->> 'estimated_margin_pct')::numeric < pol.min_margin_pct then
    insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, requested_by)
    values (a.organization_id, 'trade_in_appraisal', p_appraisal, 'tradein_margin', 'tradein.approve',
      jsonb_build_object('min_margin_pct', pol.min_margin_pct),
      jsonb_build_object('estimated_margin_pct', e -> 'estimated_margin_pct', 'estimated_margin', e -> 'estimated_margin'),
      format('Margen estimado de reventa %s%% inferior al mínimo de %s%%', coalesce(e ->> 'estimated_margin_pct', 'no calculable'), pol.min_margin_pct),
      auth.uid());
    v_count := v_count + 1;
  end if;
  if a.uncertainty = 'high' or a.documentation_status = 'issues' then
    insert into public.approvals (organization_id, entity_type, entity_id, rule, required_permission, limit_value, requested_value, message, requested_by)
    values (a.organization_id, 'trade_in_appraisal', p_appraisal, 'exception', 'tradein.approve',
      jsonb_build_object('uncertainty', 'low|medium', 'documentation', 'complete'),
      jsonb_build_object('uncertainty', a.uncertainty, 'documentation', a.documentation_status),
      'Incertidumbre alta o documentación con observaciones', auth.uid());
    v_count := v_count + 1;
  end if;

  if v_count = 0 then
    update public.trade_in_appraisals set status = 'approved', max_authorized_price = proposed_acquisition_price where id = p_appraisal;
    return 'approved';
  end if;
  update public.trade_in_appraisals set status = 'pending_approval' where id = p_appraisal;
  return 'pending_approval';
end $$;

create or replace function public.close_appraisal(p_appraisal uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare a public.trade_in_appraisals;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  if p_status = 'rejected' then perform app.require_perm(a.organization_id, 'tradein.approve');
  elsif p_status = 'withdrawn' then perform app.require_perm(a.organization_id, 'tradein.write');
  else raise exception 'MH_VALIDATION: estado inválido'; end if;
  if a.status in ('accepted','acquired') then raise exception 'MH_STATE: la tasación ya forma parte de un contrato'; end if;
  if a.deal_id is not null then raise exception 'MH_STATE: desvincule la tasación de la operación %', a.deal_id; end if;
  if coalesce(length(trim(p_note)), 0) < 5 then raise exception 'MH_VALIDATION: indique el motivo'; end if;
  update public.approvals set status = 'void', decision_note = p_note
   where entity_type = 'trade_in_appraisal' and entity_id = p_appraisal and status = 'pending';
  update public.trade_in_appraisals set status = p_status, decision_note = p_note where id = p_appraisal;
end $$;

-- Incorporación al inventario mediante el proceso de adquisición
create or replace function public.acquire_trade_in(p_appraisal uuid, p_location uuid, p_received_on date default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  a public.trade_in_appraisals;
  v_unit uuid;
  v_date date := coalesce(p_received_on, app.today());
  v_contract_date date;
  c public.appraisal_costs;
begin
  select * into a from public.trade_in_appraisals where id = p_appraisal for update;
  if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
  perform app.require_perm(a.organization_id, 'tradein.acquire');
  if a.status <> 'accepted' then
    raise exception 'MH_STATE: la tasación debe estar aceptada en un contrato formalizado (estado: %)', a.status;
  end if;
  select sc.contract_date into v_contract_date from public.sales_contracts sc where sc.deal_id = a.deal_id;
  if v_date < v_contract_date or v_date > app.today() then raise exception 'MH_VALIDATION: fecha de recepción inválida'; end if;

  insert into public.units (organization_id, stock_number, category, make, model, version, year_built, model_year, usage_value,
    usage_unit, origin, currency, acquisition_status, acquired_on, source_appraisal_id, description, created_by, responsible_user_id)
  values (a.organization_id, app.next_number(a.organization_id, 'unit', 'MH'), a.category, a.make, a.model, a.version,
    a.year_built, a.year_built, a.usage_value, a.usage_unit, 'trade_in', a.currency, 'acquired', v_contract_date, a.id,
    'Ingreso por parte de pago, tasación ' || a.number, auth.uid(), auth.uid())
  returning id into v_unit;
  if a.identifier_value is not null then
    insert into public.unit_identifiers (organization_id, unit_id, kind, value, created_by)
    values (a.organization_id, v_unit, coalesce(a.identifier_kind, 'vin'), a.identifier_value, auth.uid());
  end if;
  insert into public.unit_documents (organization_id, unit_id, doc_type, label, required_for_sale)
  select a.organization_id, v_unit, r.doc_type, r.label, r.required_for_sale
  from public.unit_document_requirements r where r.organization_id = a.organization_id and r.origin = 'trade_in';
  insert into public.unit_status_events (organization_id, unit_id, dimension, from_status, to_status, source, reason, actor_id)
  values (a.organization_id, v_unit, 'acquisition', null, 'acquired', 'trade_in', 'Tasación ' || a.number, auth.uid());

  -- El coste de adquisición es el valor aceptado en el contrato; el reacondicionamiento queda como estimación.
  insert into public.unit_costs (organization_id, unit_id, concept_code, nature, amount, currency, unit_currency,
    amount_unit_currency, incurred_on, description, created_by)
  values (a.organization_id, v_unit, 'purchase_price', 'actual', a.accepted_value, a.currency, a.currency,
    a.accepted_value, v_contract_date, 'Valor aceptado como parte de pago (' || a.number || ')', auth.uid());
  for c in select * from public.appraisal_costs where appraisal_id = a.id loop
    insert into public.unit_costs (organization_id, unit_id, concept_code, nature, amount, currency, unit_currency,
      amount_unit_currency, incurred_on, description, created_by)
    values (a.organization_id, v_unit, case when c.concept in ('repairs','reconditioning','tires') then 'repairs' else 'preparation' end,
      'estimated', c.amount, a.currency, a.currency, c.amount, v_date, coalesce(c.description, c.concept) || ' (estimación de tasación)', auth.uid());
  end loop;

  perform public.receive_unit(v_unit, p_location, v_date, 'Recepción de unidad de parte de pago');
  update public.trade_in_appraisals set status = 'acquired', acquired_unit_id = v_unit where id = p_appraisal;
  return v_unit;
end $$;
