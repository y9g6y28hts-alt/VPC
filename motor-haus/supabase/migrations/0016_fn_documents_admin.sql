-- =============================================================================
-- Motor Haus · 0016 Documentos, datos sensibles, exportaciones y administración
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Acceso por entidad (reutilizado por documentos y RLS)
-- -----------------------------------------------------------------------------
create or replace function app.can_read_deal(p_org uuid, p_salesperson uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.has_perm(p_org, 'deal.read') or (app.has_perm(p_org, 'deal.read_own') and p_salesperson = auth.uid())
$$;

create or replace function app.can_read_contract(p_contract uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.sales_contracts c where c.id = p_contract and (
      app.has_perm(c.organization_id, 'receivable.read') or app.has_perm(c.organization_id, 'deal.read')
      or (c.salesperson_id = auth.uid() and (app.has_perm(c.organization_id, 'receivable.read_own')
                                             or app.has_perm(c.organization_id, 'deal.read_own')))))
$$;

create or replace function app.can_read_receivables_of_contract(p_contract uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.sales_contracts c where c.id = p_contract and (
      app.has_perm(c.organization_id, 'receivable.read')
      or (c.salesperson_id = auth.uid() and app.has_perm(c.organization_id, 'receivable.read_own'))))
$$;

create or replace function app.can_read_entity(p_entity_type text, p_entity_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, app as $$
declare v_org uuid; v_sp uuid;
begin
  case p_entity_type
    when 'deal' then
      select organization_id, salesperson_id into v_org, v_sp from public.deals where id = p_entity_id;
      return coalesce(app.can_read_deal(v_org, v_sp), false);
    when 'contract' then
      return app.can_read_contract(p_entity_id);
    when 'trade_in_appraisal' then
      select organization_id into v_org from public.trade_in_appraisals where id = p_entity_id;
      return coalesce(app.has_perm(v_org, 'tradein.read'), false);
    when 'unit' then
      select organization_id into v_org from public.units where id = p_entity_id;
      return coalesce(app.has_perm(v_org, 'inventory.read'), false);
    when 'customer' then
      select organization_id into v_org from public.customers where id = p_entity_id;
      return coalesce(app.has_perm(v_org, 'receivable.read'), false);
    when 'purchase_order' then
      select organization_id into v_org from public.purchase_orders where id = p_entity_id;
      return coalesce(app.has_perm(v_org, 'import.read'), false);
    else return false;
  end case;
end $$;

-- -----------------------------------------------------------------------------
-- Instantáneas de documentos construidas desde datos validados en la base
-- -----------------------------------------------------------------------------
create or replace function app.org_header(p_org uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object('name', name, 'legal_name', legal_name, 'tax_id', tax_id, 'address', address,
                            'phone', phone, 'email', email, 'is_demo', is_demo)
  from public.organizations where id = p_org
$$;

create or replace function app.plan_snapshot(p_plan uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'plan_id', p.id, 'label', p.label, 'version', v.version, 'engine_version', v.engine_version,
    'checksum', v.checksum, 'inputs', v.inputs, 'summary', v.summary, 'schedule', v.schedule)
  from public.financing_plans p
  join public.financing_plan_versions v on v.plan_id = p.id and v.version = p.current_version
  where p.id = p_plan
$$;

create or replace function app.document_snapshot(p_kind text, p_entity_id uuid, p_options jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  d public.deals; c public.sales_contracts; a public.trade_in_appraisals; r public.reservations;
  e jsonb; v_plan uuid; v_plan_snap jsonb; v_cust jsonb; v_from date; v_to date;
begin
  if p_kind = 'proposal' then
    select * into d from public.deals where id = p_entity_id;
    if not found then raise exception 'MH_NOT_FOUND: operación inexistente'; end if;
    if d.status in ('cancelled','formalized') then raise exception 'MH_STATE: la operación está %', d.status; end if;
    e := app.deal_economics(d.id);
    v_plan := coalesce(nullif(p_options ->> 'plan_id', '')::uuid, d.selected_plan_id);
    if (e ->> 'financed_principal')::numeric > 0 then
      if v_plan is null then raise exception 'MH_VALIDATION: seleccione o indique un plan de financiación'; end if;
      v_plan_snap := app.plan_snapshot(v_plan);
      if v_plan_snap is null or (v_plan_snap -> 'inputs' ->> 'principal')::numeric <> (e ->> 'financed_principal')::numeric then
        raise exception 'MH_VALIDATION: el plan no corresponde al capital financiado actual; recalcúlelo';
      end if;
    end if;
    return jsonb_build_object(
      'entity_type', 'deal', 'organization', app.org_header(d.organization_id),
      'deal', jsonb_build_object('number', d.number, 'status', d.status, 'currency', d.currency,
               'valid_until', d.proposal_valid_until, 'created_at', d.created_at::date,
               'salesperson', (select full_name from public.user_profiles where id = d.salesperson_id),
               'other_credits_note', d.other_credits_note, 'financed_charges_note', d.financed_charges_note),
      'customer', (select jsonb_build_object('display_name', display_name, 'kind', kind, 'email', email, 'phone', phone)
                   from public.customers where id = d.customer_id),
      -- La propuesta es un documento para el cliente: no incluye costes ni márgenes.
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
                  'stock_number', u.stock_number, 'title', concat_ws(' ', u.make, u.model, u.version),
                  'model_year', u.model_year, 'usage', concat_ws(' ', u.usage_value, u.usage_unit),
                  'exterior_color', u.exterior_color, 'interior_color', u.interior_color, 'equipment', u.equipment,
                  'identifier', (select value from public.unit_identifiers ui where ui.unit_id = u.id and ui.kind in ('vin','chassis','hull') limit 1),
                  'list_price', di.list_price, 'negotiated_price', di.negotiated_price) order by u.stock_number), '[]')
                from public.deal_items di join public.units u on u.id = di.unit_id where di.deal_id = d.id),
      'trade_ins', (select coalesce(jsonb_agg(jsonb_build_object('title', x ->> 'title', 'accepted_value', x -> 'accepted_value',
                     'lien_payoff', x -> 'lien_payoff', 'net_credit', x -> 'net_credit')), '[]')
                    from jsonb_array_elements(e -> 'trade_ins') x),
      'totals', jsonb_build_object('total_list', e -> 'total_list', 'total_negotiated', e -> 'total_negotiated',
                  'discount_amount', e -> 'discount_amount', 'financed_charges', e -> 'financed_charges',
                  'trade_in_credit', e -> 'trade_in_credit', 'cash_down_payment', e -> 'cash_down_payment',
                  'other_credits', e -> 'other_credits', 'financed_principal', e -> 'financed_principal',
                  'total_projected', (e ->> 'cash_down_payment')::numeric + coalesce((v_plan_snap -> 'summary' ->> 'totalPayments')::numeric, 0)),
      'plan', v_plan_snap,
      'approval', jsonb_build_object('status', d.status,
                   'pending', (select count(*) from public.approvals where entity_type = 'deal' and entity_id = d.id and status = 'pending')));

  elsif p_kind in ('payment_schedule', 'sales_contract', 'delivery_record', 'account_statement') then
    select * into c from public.sales_contracts where id = p_entity_id;
    if not found then raise exception 'MH_NOT_FOUND: contrato inexistente'; end if;
    v_cust := (select jsonb_build_object('display_name', display_name, 'kind', kind, 'email', email, 'phone', phone)
               from public.customers where id = c.customer_id);
    if p_kind = 'account_statement' then
      v_from := coalesce(nullif(p_options ->> 'from', '')::date, c.contract_date);
      v_to := coalesce(nullif(p_options ->> 'to', '')::date, app.today());
      return jsonb_build_object('entity_type', 'contract', 'organization', app.org_header(c.organization_id),
        'contract', jsonb_build_object('number', c.number, 'currency', c.currency, 'contract_date', c.contract_date),
        'customer', v_cust, 'period', jsonb_build_object('from', v_from, 'to', v_to),
        'lines', (select coalesce(jsonb_agg(to_jsonb(s) order by s.entry_order), '[]') from public.contract_statement(c.id, v_from, v_to) s),
        'balance', (select to_jsonb(cb) - 'organization_id' - 'customer_id' - 'salesperson_id' from public.contract_balances cb where cb.contract_id = c.id));
    end if;
    return jsonb_build_object('entity_type', 'contract', 'organization', app.org_header(c.organization_id),
      'contract', jsonb_build_object('number', c.number, 'currency', c.currency, 'contract_date', c.contract_date,
                   'total_price', c.total_price, 'upfront_total', c.upfront_total, 'financed_principal', c.financed_principal,
                   'salesperson', (select full_name from public.user_profiles where id = c.salesperson_id)),
      'customer', v_cust,
      'units', (select coalesce(jsonb_agg(jsonb_build_object('stock_number', u.stock_number,
                  'title', concat_ws(' ', u.make, u.model, u.version), 'model_year', u.model_year,
                  'identifier', (select value from public.unit_identifiers ui where ui.unit_id = u.id and ui.kind in ('vin','chassis','hull') limit 1),
                  'negotiated_price', di.negotiated_price, 'delivered_on', u.delivered_on)), '[]')
                from public.deal_items di join public.units u on u.id = di.unit_id where di.deal_id = c.deal_id),
      'installments', (select coalesce(jsonb_agg(jsonb_build_object('seq', s.seq, 'label', s.label, 'kind', s.kind,
                  'due_date', s.due_date, 'principal', s.principal_amount, 'interest', s.interest_amount,
                  'amount_due', s.total_due, 'paid', s.paid_confirmed, 'outstanding', s.outstanding,
                  'status', s.payment_status) order by s.seq), '[]')
                from public.installment_status s where s.contract_id = c.id),
      'terms', (select terms - 'policies' from public.contract_versions where contract_id = c.id and version = c.current_version));

  elsif p_kind = 'appraisal_report' then
    select * into a from public.trade_in_appraisals where id = p_entity_id;
    if not found then raise exception 'MH_NOT_FOUND: tasación inexistente'; end if;
    return jsonb_build_object('entity_type', 'trade_in_appraisal', 'organization', app.org_header(a.organization_id),
      'appraisal', to_jsonb(a) - 'organization_id' - 'created_by',
      'customer', (select jsonb_build_object('display_name', display_name) from public.customers where id = a.customer_id),
      'appraiser', (select full_name from public.user_profiles where id = a.appraiser_id),
      'inspection', (select coalesce(jsonb_agg(jsonb_build_object('item', item, 'result', result, 'notes', notes) order by item), '[]')
                     from public.appraisal_inspections where appraisal_id = a.id),
      'costs', (select coalesce(jsonb_agg(jsonb_build_object('concept', concept, 'description', description, 'amount', amount)), '[]')
                from public.appraisal_costs where appraisal_id = a.id),
      'economics', app.appraisal_economics(a.id));

  elsif p_kind = 'reservation' then
    select * into r from public.reservations where id = p_entity_id;
    if not found then raise exception 'MH_NOT_FOUND: reserva inexistente'; end if;
    return jsonb_build_object('entity_type', 'unit', 'organization', app.org_header(r.organization_id),
      'reservation', jsonb_build_object('status', r.status, 'expires_at', r.expires_at, 'conditions', r.conditions,
                      'deposit_amount', r.deposit_amount, 'deposit_currency', r.deposit_currency, 'created_at', r.created_at),
      'unit', (select jsonb_build_object('stock_number', stock_number, 'title', concat_ws(' ', make, model, version),
               'model_year', model_year, 'list_price', list_price, 'currency', currency) from public.units where id = r.unit_id),
      'customer', (select jsonb_build_object('display_name', display_name) from public.customers where id = r.customer_id));
  end if;
  raise exception 'MH_VALIDATION: tipo de documento no soportado: %', p_kind;
end $$;

create or replace function public.issue_document(p_org uuid, p_kind text, p_entity_id uuid, p_options jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  t public.document_templates;
  v_snap jsonb;
  v_entity_type text;
  v_id uuid;
  v_prefix text := case p_kind when 'proposal' then 'PRO' when 'payment_schedule' then 'CAL' when 'account_statement' then 'EDC'
                     when 'appraisal_report' then 'INF' when 'reservation' then 'RES' when 'sales_contract' then 'CVT'
                     when 'delivery_record' then 'ENT' else 'DOC' end;
begin
  perform app.require_perm(p_org, 'document.issue');
  select * into t from public.document_templates where organization_id = p_org and kind = p_kind and active;
  if not found then raise exception 'MH_VALIDATION: no hay plantilla activa para %', p_kind; end if;
  v_snap := app.document_snapshot(p_kind, p_entity_id, coalesce(p_options, '{}'));
  v_entity_type := v_snap ->> 'entity_type';
  if (v_snap -> 'organization' ->> 'name') is null then raise exception 'MH_NOT_FOUND: organización'; end if;
  if not app.can_read_entity(v_entity_type, case when p_kind = 'reservation'
       then (select unit_id from public.reservations where id = p_entity_id) else p_entity_id end) then
    raise exception 'MH_FORBIDDEN: sin acceso a la entidad del documento' using errcode = '42501';
  end if;
  if p_kind = 'account_statement' and not app.can_read_receivables_of_contract(p_entity_id) then
    raise exception 'MH_FORBIDDEN: sin acceso a la cuenta por cobrar' using errcode = '42501';
  end if;
  v_snap := v_snap || jsonb_build_object('template', jsonb_build_object('kind', t.kind, 'version', t.version, 'title', t.title,
              'legal_notice', t.legal_notice, 'requires_legal_review', t.requires_legal_review));
  update public.documents set status = 'superseded'
   where organization_id = p_org and kind = p_kind and entity_id = p_entity_id and status = 'issued';
  insert into public.documents (organization_id, kind, number, template_id, template_version, entity_type, entity_id,
    data_snapshot, data_checksum, issued_by)
  values (p_org, p_kind, app.next_number(p_org, 'doc_' || p_kind, v_prefix), t.id, t.version, v_entity_type, p_entity_id,
    v_snap, encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Lectura de un documento con verificación de integridad de su instantánea.
create or replace function public.get_document(p_document uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare doc public.documents;
begin
  select * into doc from public.documents where id = p_document;
  if not found then raise exception 'MH_NOT_FOUND: documento inexistente'; end if;
  perform app.require_perm(doc.organization_id, 'document.read');
  if not app.can_read_entity(doc.entity_type, case when doc.kind = 'reservation'
       then (select unit_id from public.reservations where id = doc.entity_id) else doc.entity_id end) then
    raise exception 'MH_FORBIDDEN: sin acceso a la entidad del documento' using errcode = '42501';
  end if;
  return jsonb_build_object('id', doc.id, 'kind', doc.kind, 'number', doc.number, 'status', doc.status,
    'template_version', doc.template_version, 'entity_type', doc.entity_type, 'entity_id', doc.entity_id,
    'issued_at', doc.issued_at, 'issued_by', (select full_name from public.user_profiles where id = doc.issued_by),
    'checksum', doc.data_checksum,
    'integrity_ok', encode(sha256(convert_to(doc.data_snapshot::text, 'UTF8')), 'hex') = doc.data_checksum,
    'snapshot', doc.data_snapshot);
end $$;

-- -----------------------------------------------------------------------------
-- Datos sensibles del cliente (acceso auditado)
-- -----------------------------------------------------------------------------
create or replace function public.get_customer_sensitive(p_customer uuid)
returns table (document_type text, document_number text, tax_id text, address text)
language plpgsql security definer set search_path = public, app as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.customers where id = p_customer;
  if v_org is null then raise exception 'MH_NOT_FOUND: cliente inexistente'; end if;
  perform app.require_perm(v_org, 'customer.pii.read');
  perform app.audit(v_org, 'customer.pii.view', 'customers', p_customer, null, null, null);
  return query select c.document_type, c.document_number, c.tax_id, c.address from public.customers c where c.id = p_customer;
end $$;

create or replace function public.find_customer_by_document(p_org uuid, p_document text)
returns table (id uuid, display_name text)
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm(p_org, 'customer.pii.read');
  return query select c.id, c.display_name from public.customers c
   where c.organization_id = p_org
     and c.document_normalized = upper(regexp_replace(coalesce(p_document, ''), '[^A-Za-z0-9]', '', 'g'));
end $$;

-- El cliente con customer.write puede registrar el documento, pero no leerlo.
create or replace function public.set_customer_sensitive(
  p_customer uuid, p_document_type text, p_document_number text, p_tax_id text, p_address text
) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.customers where id = p_customer;
  if v_org is null then raise exception 'MH_NOT_FOUND: cliente inexistente'; end if;
  perform app.require_perm(v_org, 'customer.write');
  update public.customers set document_type = nullif(p_document_type, ''), document_number = nullif(trim(p_document_number), ''),
    tax_id = nullif(trim(p_tax_id), ''), address = nullif(trim(p_address), '') where id = p_customer;
  perform app.audit(v_org, 'customer.pii.update', 'customers', p_customer, null, null, null);
exception when unique_violation then
  raise exception 'MH_CONFLICT: ya existe un cliente con ese documento';
end $$;

-- -----------------------------------------------------------------------------
-- Exportaciones sensibles: se registran antes de entregar el archivo
-- -----------------------------------------------------------------------------
create or replace function public.log_export(p_org uuid, p_dataset text, p_filters jsonb, p_rows int) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm(p_org, 'report.export');
  perform app.audit(p_org, 'export', p_dataset, null, null, null, jsonb_build_object('filters', p_filters, 'rows', p_rows));
end $$;

-- -----------------------------------------------------------------------------
-- Administración de usuarios
-- -----------------------------------------------------------------------------
create or replace function public.set_membership(p_org uuid, p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_perm(p_org, 'admin.users');
  if p_user = auth.uid() then raise exception 'MH_FORBIDDEN: no puede modificar su propia membresía'; end if;
  if not exists (select 1 from public.roles where code = p_role) then raise exception 'MH_VALIDATION: rol inexistente'; end if;
  if not exists (select 1 from public.user_profiles where id = p_user) then raise exception 'MH_NOT_FOUND: usuario inexistente'; end if;
  insert into public.memberships (organization_id, user_id, role_code, active, created_by)
  values (p_org, p_user, p_role, p_active, auth.uid())
  on conflict (organization_id, user_id) do update set role_code = excluded.role_code, active = excluded.active;
end $$;

-- -----------------------------------------------------------------------------
-- Eventos automáticos de importación al cambiar ETA o estado
-- -----------------------------------------------------------------------------
create or replace function app.shipment_events() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.eta is distinct from old.eta then
    insert into public.import_events (organization_id, shipment_id, event_type, description, old_value, new_value, actor_id)
    values (new.organization_id, new.id, 'eta_change', 'Cambio de fecha estimada de llegada',
            to_char(old.eta, 'YYYY-MM-DD'), to_char(new.eta, 'YYYY-MM-DD'), auth.uid());
  end if;
  if new.status is distinct from old.status then
    insert into public.import_events (organization_id, shipment_id, event_type, description, old_value, new_value, actor_id)
    values (new.organization_id, new.id, 'status_change', 'Cambio de estado del embarque', old.status, new.status, auth.uid());
  end if;
  if new.eta_original is null and old.eta_original is null and new.eta is not null then
    new.eta_original := coalesce(old.eta, new.eta);
  end if;
  return new;
end $$;
create trigger shipments_events before update on public.shipments
  for each row execute function app.shipment_events();

create or replace function app.shipment_initial_eta() returns trigger
language plpgsql as $$
begin
  new.eta_original := coalesce(new.eta_original, new.eta);
  return new;
end $$;
create trigger shipments_initial_eta before insert on public.shipments
  for each row execute function app.shipment_initial_eta();
