-- =============================================================================
-- Motor Haus · 0012 Funciones de inventario
-- Las columnas de estado, precio y fechas de negocio de una unidad solo se
-- modifican mediante estas funciones (SECURITY DEFINER). Una escritura directa
-- del rol authenticated sobre esas columnas es rechazada por un trigger.
-- =============================================================================

create or replace function app.is_direct_client() returns boolean
language sql stable as $$
  -- Dentro de una función SECURITY DEFINER current_user es el propietario.
  select current_user in ('authenticated', 'anon')
$$;

create or replace function app.units_guard() returns trigger
language plpgsql as $$
begin
  if not app.is_direct_client() then return new; end if;
  if tg_op = 'INSERT' then
    if new.acquisition_status not in ('evaluation') or new.logistics_status <> 'pending'
       or new.preparation_status <> 'not_started' or new.commercial_status <> 'not_listed'
       or new.acquired_on is not null or new.received_on is not null or new.sold_on is not null
       or new.delivered_on is not null or new.retired_on is not null or new.listed_on is not null
       or new.list_price is not null or new.minimum_price is not null or new.offer_price is not null
       or new.source_appraisal_id is not null then
      raise exception 'MH_FORBIDDEN: use create_unit() para dar de alta unidades con estado o precio';
    end if;
    return new;
  end if;
  if new.organization_id <> old.organization_id
     or new.acquisition_status <> old.acquisition_status or new.logistics_status <> old.logistics_status
     or new.preparation_status <> old.preparation_status or new.commercial_status <> old.commercial_status
     or new.list_price is distinct from old.list_price or new.minimum_price is distinct from old.minimum_price
     or new.offer_price is distinct from old.offer_price or new.currency <> old.currency
     or new.acquired_on is distinct from old.acquired_on or new.received_on is distinct from old.received_on
     or new.sold_on is distinct from old.sold_on or new.delivered_on is distinct from old.delivered_on
     or new.retired_on is distinct from old.retired_on or new.listed_on is distinct from old.listed_on
     or new.location_id is distinct from old.location_id
     or new.source_appraisal_id is distinct from old.source_appraisal_id then
    raise exception 'MH_FORBIDDEN: estados, precios, ubicación y fechas de negocio solo cambian mediante funciones validadas';
  end if;
  return new;
end $$;
create trigger units_guard before insert or update on public.units
  for each row execute function app.units_guard();

create or replace function app.lock_unit(p_unit uuid) returns public.units
language plpgsql security definer set search_path = public, app as $$
declare v public.units;
begin
  select * into v from public.units where id = p_unit for update;
  if not found then raise exception 'MH_NOT_FOUND: unidad inexistente'; end if;
  return v;
end $$;

create or replace function app.log_status(
  p_unit public.units, p_dimension text, p_from text, p_to text, p_source text, p_reason text
) returns void
language sql security definer set search_path = public, app as $$
  insert into public.unit_status_events (organization_id, unit_id, dimension, from_status, to_status, source, reason, actor_id)
  values (p_unit.organization_id, p_unit.id, p_dimension, p_from, p_to, p_source, p_reason, auth.uid())
$$;

-- Requisitos para habilitar comercialmente una unidad. Devuelve los motivos
-- que lo impiden (vacío = puede comercializarse).
create or replace function app.unit_listing_blockers(p_unit uuid) returns text[]
language plpgsql stable security definer set search_path = public, app as $$
declare
  u public.units;
  r text[] := '{}';
  n int;
begin
  select * into u from public.units where id = p_unit;
  if u.acquisition_status <> 'acquired' then r := r || text 'La adquisición no está formalizada'; end if;
  if u.logistics_status <> 'received' then r := r || text 'La unidad no fue recibida físicamente'; end if;
  if u.preparation_status <> 'ready' then r := r || text 'La preparación no está completa'; end if;
  select count(*) into n from public.unit_documents
   where unit_id = p_unit and required_for_sale and status = 'pending';
  if n > 0 then r := r || format('%s documento(s) obligatorio(s) pendiente(s)', n); end if;
  select count(*) into n from public.preparation_tasks
   where unit_id = p_unit and mandatory and status = 'pending';
  if n > 0 then r := r || format('%s tarea(s) obligatoria(s) de preparación pendiente(s)', n); end if;
  if u.list_price is null or u.minimum_price is null then r := r || text 'Faltan precio de lista o precio mínimo'; end if;
  if u.location_id is null then r := r || text 'Sin ubicación física registrada'; end if;
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Alta de unidad
-- -----------------------------------------------------------------------------
create or replace function public.create_unit(p_org uuid, p_unit jsonb, p_identifiers jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_id uuid;
  v_idf jsonb;
  v_status text := coalesce(p_unit ->> 'acquisition_status', 'evaluation');
  v_stock text := nullif(trim(p_unit ->> 'stock_number'), '');
begin
  perform app.require_perm(p_org, 'inventory.write');
  if v_status not in ('evaluation', 'approved') then
    raise exception 'MH_VALIDATION: una unidad nueva inicia en evaluación o compra aprobada';
  end if;
  if v_status = 'approved' then perform app.require_perm(p_org, 'inventory.status.write'); end if;
  if v_stock is null then
    v_stock := app.next_number(p_org, 'unit', 'MH');
  end if;
  if (p_unit ? 'list_price' or p_unit ? 'minimum_price') then
    perform app.require_perm(p_org, 'inventory.price.write');
  end if;

  insert into public.units (
    organization_id, branch_id, stock_number, category, make, model, version, year_built, model_year,
    usage_value, usage_unit, exterior_color, interior_color, equipment, origin, origin_country, description,
    responsible_user_id, currency, list_price, minimum_price, offer_price, acquisition_status, created_by)
  values (
    p_org, nullif(p_unit ->> 'branch_id', '')::uuid, v_stock, p_unit ->> 'category', p_unit ->> 'make',
    p_unit ->> 'model', p_unit ->> 'version', (p_unit ->> 'year_built')::smallint, (p_unit ->> 'model_year')::smallint,
    (p_unit ->> 'usage_value')::numeric, coalesce(p_unit ->> 'usage_unit', 'km'), p_unit ->> 'exterior_color',
    p_unit ->> 'interior_color',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_unit -> 'equipment') x), '{}'),
    coalesce(p_unit ->> 'origin', 'local_purchase'), p_unit ->> 'origin_country', p_unit ->> 'description',
    coalesce(nullif(p_unit ->> 'responsible_user_id', '')::uuid, auth.uid()),
    p_unit ->> 'currency', (p_unit ->> 'list_price')::numeric, (p_unit ->> 'minimum_price')::numeric,
    (p_unit ->> 'offer_price')::numeric, v_status, auth.uid())
  returning id into v_id;

  for v_idf in select * from jsonb_array_elements(p_identifiers) loop
    insert into public.unit_identifiers (organization_id, unit_id, kind, value, allow_duplicate, duplicate_reason, created_by)
    values (p_org, v_id, v_idf ->> 'kind', v_idf ->> 'value',
            coalesce((v_idf ->> 'allow_duplicate')::boolean, false), v_idf ->> 'duplicate_reason', auth.uid());
  end loop;

  -- Documentación obligatoria según procedencia
  insert into public.unit_documents (organization_id, unit_id, doc_type, label, required_for_sale)
  select p_org, v_id, r.doc_type, r.label, r.required_for_sale
  from public.unit_document_requirements r
  where r.organization_id = p_org and r.origin = coalesce(p_unit ->> 'origin', 'local_purchase');

  insert into public.unit_status_events (organization_id, unit_id, dimension, from_status, to_status, source, reason, actor_id)
  values (p_org, v_id, 'acquisition', null, v_status, 'create', 'Alta de unidad', auth.uid());

  if (p_unit ->> 'list_price') is not null then
    insert into public.unit_price_history (organization_id, unit_id, field, old_value, new_value, currency, reason, actor_id)
    select p_org, v_id, f, null, (p_unit ->> f)::numeric, p_unit ->> 'currency', 'Precio inicial', auth.uid()
    from unnest(array['list_price','minimum_price','offer_price']) f where (p_unit ->> f) is not null;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'MH_CONFLICT: identificador o número de stock duplicado (%)', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- Cambio de estado genérico, validado contra el flujo configurado
-- -----------------------------------------------------------------------------
create or replace function public.change_unit_status(
  p_unit uuid, p_dimension text, p_to text, p_reason text, p_effective_date date default null
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units := app.lock_unit(p_unit);
  v_from text;
  v_tr public.status_transitions;
  v_blockers text[];
  v_date date := coalesce(p_effective_date, app.today());
begin
  if p_dimension = 'logistics' then
    if not (app.has_perm(u.organization_id, 'import.write') or app.has_perm(u.organization_id, 'inventory.status.write')) then
      raise exception 'MH_FORBIDDEN: se requiere import.write o inventory.status.write' using errcode = '42501';
    end if;
  else
    perform app.require_perm(u.organization_id, 'inventory.status.write');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'MH_VALIDATION: indique el motivo del cambio de estado';
  end if;
  v_from := case p_dimension
    when 'acquisition' then u.acquisition_status when 'logistics' then u.logistics_status
    when 'preparation' then u.preparation_status when 'commercial' then u.commercial_status end;
  if v_from is null then raise exception 'MH_VALIDATION: dimensión de estado inválida'; end if;

  select * into v_tr from public.status_transitions
   where organization_id = u.organization_id and dimension = p_dimension
     and from_status = v_from and to_status = p_to;
  if not found then
    raise exception 'MH_STATE: transición no permitida (% → %)', v_from, p_to;
  end if;
  if v_tr.via_function then
    raise exception 'MH_STATE: la transición % → % requiere su proceso específico (reserva, venta, recepción o entrega)', v_from, p_to;
  end if;
  if v_date > app.today() then raise exception 'MH_VALIDATION: la fecha efectiva no puede ser futura'; end if;

  if p_dimension = 'acquisition' then
    if p_to = 'acquired' then
      if not exists (select 1 from public.unit_costs where unit_id = p_unit and concept_code = 'purchase_price' and status <> 'voided') then
        raise exception 'MH_VALIDATION: registre el precio de compra antes de formalizar la adquisición';
      end if;
      update public.units set acquisition_status = p_to, acquired_on = v_date where id = p_unit;
    else
      update public.units set acquisition_status = p_to where id = p_unit;
    end if;
  elsif p_dimension = 'logistics' then
    if u.acquisition_status not in ('approved', 'acquired') then
      raise exception 'MH_STATE: la compra no está aprobada';
    end if;
    update public.units set logistics_status = p_to where id = p_unit;
  elsif p_dimension = 'preparation' then
    if p_to = 'ready' and exists (select 1 from public.preparation_tasks
                                  where unit_id = p_unit and mandatory and status = 'pending') then
      raise exception 'MH_STATE: hay tareas obligatorias de preparación pendientes';
    end if;
    if p_to = 'in_service' and u.commercial_status = 'available' then
      raise exception 'MH_STATE: retire la unidad de comercialización antes de enviarla a servicio';
    end if;
    if u.logistics_status <> 'received' then
      raise exception 'MH_STATE: la unidad no fue recibida físicamente';
    end if;
    update public.units set preparation_status = p_to where id = p_unit;
  elsif p_dimension = 'commercial' then
    if p_to = 'available' then
      v_blockers := app.unit_listing_blockers(p_unit);
      if cardinality(v_blockers) > 0 then
        raise exception 'MH_STATE: no puede habilitarse: %', array_to_string(v_blockers, '; ');
      end if;
      update public.units set commercial_status = 'available', listed_on = coalesce(listed_on, v_date) where id = p_unit;
    elsif p_to = 'retired' then
      update public.units set commercial_status = 'retired', retired_on = v_date, retire_reason = p_reason where id = p_unit;
    else
      update public.units set commercial_status = p_to where id = p_unit;
    end if;
  end if;

  perform app.log_status(u, p_dimension, v_from, p_to, 'manual', p_reason);
end $$;

-- -----------------------------------------------------------------------------
-- Recepción física: no habilita la venta; inicia la preparación.
-- -----------------------------------------------------------------------------
create or replace function public.receive_unit(
  p_unit uuid, p_location uuid, p_received_on date default null, p_notes text default null
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units := app.lock_unit(p_unit);
  v_date date := coalesce(p_received_on, app.today());
  v_ship uuid;
begin
  if not (app.has_perm(u.organization_id, 'import.write') or app.has_perm(u.organization_id, 'inventory.status.write')) then
    raise exception 'MH_FORBIDDEN: se requiere import.write o inventory.status.write' using errcode = '42501';
  end if;
  if u.logistics_status = 'received' then raise exception 'MH_STATE: la unidad ya fue recibida'; end if;
  if u.acquisition_status not in ('approved','acquired') then raise exception 'MH_STATE: la compra no está aprobada'; end if;
  if v_date > app.today() then raise exception 'MH_VALIDATION: la fecha de recepción no puede ser futura'; end if;
  if u.acquired_on is not null and v_date < u.acquired_on then
    raise exception 'MH_VALIDATION: la recepción no puede ser anterior a la adquisición';
  end if;
  if not exists (select 1 from public.locations where id = p_location and organization_id = u.organization_id and active) then
    raise exception 'MH_VALIDATION: ubicación inválida';
  end if;

  update public.units
     set logistics_status = 'received', received_on = v_date, location_id = p_location,
         preparation_status = case when preparation_status = 'not_started' then 'in_preparation' else preparation_status end
   where id = p_unit;
  insert into public.unit_locations (organization_id, unit_id, location_id, moved_by, note)
  values (u.organization_id, p_unit, p_location, auth.uid(), coalesce(p_notes, 'Recepción física'));
  perform app.log_status(u, 'logistics', u.logistics_status, 'received', 'receipt', p_notes);
  if u.preparation_status = 'not_started' then
    perform app.log_status(u, 'preparation', 'not_started', 'in_preparation', 'receipt', 'Inicio automático de preparación');
  end if;

  insert into public.preparation_tasks (organization_id, unit_id, title, mandatory, sort_order)
  select u.organization_id, p_unit, t.title, t.mandatory, t.sort_order
  from public.preparation_templates t
  where t.organization_id = u.organization_id
    and not exists (select 1 from public.preparation_tasks x where x.unit_id = p_unit and x.title = t.title);

  for v_ship in select su.shipment_id from public.shipment_units su where su.unit_id = p_unit loop
    insert into public.import_events (organization_id, shipment_id, event_type, description, actor_id)
    values (u.organization_id, v_ship, 'receipt', format('Unidad %s recibida físicamente el %s', u.stock_number, v_date), auth.uid());
    update public.shipments s set arrived_on = coalesce(arrived_on, v_date),
      status = case when not exists (
        select 1 from public.shipment_units su2 join public.units u2 on u2.id = su2.unit_id
        where su2.shipment_id = s.id and u2.logistics_status <> 'received') then 'delivered' else s.status end
    where s.id = v_ship;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Precios con historial y control de concurrencia optimista
-- -----------------------------------------------------------------------------
create or replace function public.set_unit_price(
  p_unit uuid, p_list numeric, p_minimum numeric, p_offer numeric, p_reason text, p_expected_version int default null
) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units := app.lock_unit(p_unit);
begin
  perform app.require_perm(u.organization_id, 'inventory.price.write');
  if p_expected_version is not null and u.row_version <> p_expected_version then
    raise exception 'MH_CONFLICT: la unidad fue modificada por otro usuario; recargue antes de cambiar el precio';
  end if;
  if u.commercial_status in ('sold_pending_delivery','delivered','retired') then
    raise exception 'MH_STATE: no se modifican precios de unidades vendidas o retiradas';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'MH_VALIDATION: indique el motivo del cambio de precio'; end if;
  if p_list is null or p_minimum is null then raise exception 'MH_VALIDATION: precio de lista y mínimo son obligatorios'; end if;
  if p_minimum > p_list then raise exception 'MH_VALIDATION: el precio mínimo no puede superar el de lista'; end if;
  if p_offer is not null and (p_offer > p_list or p_offer < p_minimum) then
    raise exception 'MH_VALIDATION: el precio de oferta debe estar entre el mínimo y el de lista';
  end if;

  insert into public.unit_price_history (organization_id, unit_id, field, old_value, new_value, currency, reason, actor_id)
  select u.organization_id, u.id, f.field, f.old_v, f.new_v, u.currency, p_reason, auth.uid()
  from (values ('list_price', u.list_price, p_list),
               ('minimum_price', u.minimum_price, p_minimum),
               ('offer_price', u.offer_price, p_offer)) as f(field, old_v, new_v)
  where f.old_v is distinct from f.new_v;

  update public.units set list_price = p_list, minimum_price = p_minimum, offer_price = p_offer where id = p_unit;
end $$;

-- -----------------------------------------------------------------------------
-- Costes: estimados y reales nunca se confunden
-- -----------------------------------------------------------------------------
create or replace function public.register_unit_cost(
  p_unit uuid, p_concept text, p_nature text, p_amount numeric, p_currency char(3),
  p_incurred_on date default null, p_description text default null,
  p_fx_rate numeric default null, p_fx_date date default null, p_fx_source text default null,
  p_settles_estimate uuid default null, p_payable uuid default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  u public.units;
  v_id uuid;
  v_amount_unit numeric;
  v_est public.unit_costs;
begin
  select * into u from public.units where id = p_unit;
  if not found then raise exception 'MH_NOT_FOUND: unidad inexistente'; end if;
  perform app.require_perm(u.organization_id, 'inventory.cost.write');
  if u.commercial_status = 'retired' then raise exception 'MH_STATE: la unidad está retirada'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'MH_VALIDATION: el importe debe ser positivo'; end if;
  if p_currency <> u.currency and p_fx_rate is null then
    raise exception 'MH_VALIDATION: el coste está en % y la unidad en %; registre cotización, fecha y fuente', p_currency, u.currency;
  end if;
  v_amount_unit := app.round_money(p_amount * coalesce(p_fx_rate, 1), u.currency);

  if p_settles_estimate is not null then
    select * into v_est from public.unit_costs where id = p_settles_estimate and unit_id = p_unit for update;
    if not found or v_est.nature <> 'estimated' or v_est.status <> 'active' then
      raise exception 'MH_STATE: la estimación indicada no está activa';
    end if;
    if p_nature <> 'actual' then raise exception 'MH_VALIDATION: solo un coste real liquida una estimación'; end if;
    update public.unit_costs set status = 'settled' where id = p_settles_estimate;
  end if;
  if p_payable is not null and not exists (
      select 1 from public.supplier_payables where id = p_payable and organization_id = u.organization_id) then
    raise exception 'MH_VALIDATION: factura de proveedor inválida';
  end if;

  insert into public.unit_costs (organization_id, unit_id, concept_code, nature, amount, currency, unit_currency,
    fx_rate, fx_date, fx_source, amount_unit_currency, incurred_on, description, supplier_payable_id,
    settles_estimate_id, created_by)
  values (u.organization_id, p_unit, p_concept, p_nature, p_amount, p_currency, u.currency,
    case when p_currency <> u.currency then p_fx_rate end,
    case when p_currency <> u.currency then p_fx_date end,
    case when p_currency <> u.currency then p_fx_source end,
    v_amount_unit, coalesce(p_incurred_on, app.today()), p_description, p_payable, p_settles_estimate, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.void_unit_cost(p_cost uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app as $$
declare c public.unit_costs;
begin
  select * into c from public.unit_costs where id = p_cost for update;
  if not found then raise exception 'MH_NOT_FOUND: coste inexistente'; end if;
  perform app.require_perm(c.organization_id, 'inventory.cost.write');
  if c.status <> 'active' then raise exception 'MH_STATE: el coste no está activo'; end if;
  update public.unit_costs set status = 'voided', void_reason = p_reason where id = p_cost;
end $$;

create or replace function public.move_unit(p_unit uuid, p_location uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare u public.units := app.lock_unit(p_unit);
begin
  perform app.require_perm(u.organization_id, 'inventory.write');
  if u.logistics_status <> 'received' then raise exception 'MH_STATE: la unidad no está físicamente en la empresa'; end if;
  if not exists (select 1 from public.locations where id = p_location and organization_id = u.organization_id and active) then
    raise exception 'MH_VALIDATION: ubicación inválida';
  end if;
  update public.units set location_id = p_location where id = p_unit;
  insert into public.unit_locations (organization_id, unit_id, location_id, moved_by, note)
  values (u.organization_id, p_unit, p_location, auth.uid(), p_note);
end $$;

create or replace function public.record_physical_count(
  p_unit uuid, p_found boolean, p_observed_location uuid, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare u public.units; v_id uuid;
begin
  select * into u from public.units where id = p_unit;
  if not found then raise exception 'MH_NOT_FOUND: unidad inexistente'; end if;
  perform app.require_perm(u.organization_id, 'inventory.count');
  insert into public.physical_counts (organization_id, unit_id, found, observed_location_id, expected_location_id, notes, counted_by, counted_on)
  values (u.organization_id, p_unit, p_found, p_observed_location, u.location_id, p_notes, auth.uid(), app.today())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_unit_document_status(p_doc uuid, p_status text, p_notes text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare d public.unit_documents;
begin
  select * into d from public.unit_documents where id = p_doc for update;
  if not found then raise exception 'MH_NOT_FOUND: documento inexistente'; end if;
  perform app.require_perm(d.organization_id, 'inventory.write');
  if p_status = 'not_applicable' and coalesce(length(trim(p_notes)), 0) < 5 then
    raise exception 'MH_VALIDATION: justifique por qué el documento no aplica';
  end if;
  update public.unit_documents
     set status = p_status, notes = coalesce(p_notes, notes),
         received_on = case when p_status in ('received','verified') then coalesce(received_on, app.today()) else received_on end,
         verified_by = case when p_status = 'verified' then auth.uid() else verified_by end,
         verified_at = case when p_status = 'verified' then now() else verified_at end
   where id = p_doc;
end $$;

create or replace function public.complete_preparation_task(p_task uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare t public.preparation_tasks;
begin
  select * into t from public.preparation_tasks where id = p_task for update;
  if not found then raise exception 'MH_NOT_FOUND: tarea inexistente'; end if;
  perform app.require_perm(t.organization_id, 'service.write');
  if p_status not in ('done','waived','pending') then raise exception 'MH_VALIDATION: estado inválido'; end if;
  if p_status = 'waived' and t.mandatory then
    perform app.require_perm(t.organization_id, 'inventory.status.write');
  end if;
  update public.preparation_tasks
     set status = p_status, waive_reason = case when p_status = 'waived' then p_reason end,
         done_by = case when p_status = 'pending' then null else auth.uid() end,
         done_at = case when p_status = 'pending' then null else now() end
   where id = p_task;
end $$;
