-- =============================================================================
-- Da Silva OS — Clientes, CRM, tasaciones, aprobaciones, ventas y reservas
-- =============================================================================

create or replace function app.normalize_doc(p text)
returns text language sql immutable parallel safe as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

-- Teléfonos paraguayos: se guardan sólo dígitos; 09xx… y 5959xx… se unifican.
create or replace function app.normalize_phone(p text)
returns text language sql immutable parallel safe as $$
  select nullif(
    regexp_replace(
      regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', ''),
      '^0(9[0-9]{8})$', '595\1'),
  '')
$$;

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  kind               text not null check (kind in ('persona','empresa')),
  full_name          text not null,
  doc_type           text not null check (doc_type in ('ci','ruc','pasaporte','otro')),
  doc_number         text not null,
  doc_normalized     text generated always as (app.normalize_doc(doc_number)) stored,
  phone              text,
  phone_normalized   text generated always as (app.normalize_phone(phone)) stored,
  email              text,
  email_normalized   text generated always as (nullif(lower(trim(email)), '')) stored,
  address            text,
  city               text,
  customer_type      text not null default 'particular'
                     check (customer_type in ('particular','empresa','flota','revendedor','otro')),
  source             text,
  assigned_seller_id uuid references public.user_profiles(id),
  collector_id       uuid references public.user_profiles(id),
  notes              text,
  created_by         uuid references public.user_profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, org_id),
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index customers_doc_uq on public.customers(org_id, doc_type, doc_normalized);
create index customers_phone_idx on public.customers(org_id, phone_normalized);
create index customers_email_idx on public.customers(org_id, email_normalized);
create index customers_seller_idx on public.customers(org_id, assigned_seller_id);
create index customers_name_idx on public.customers(org_id, lower(full_name));

create trigger customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function app.audit_row();

-- ¿Puede el usuario ver al cliente? (propio o permiso global)
create or replace function app.can_see_customer(p_org uuid, p_seller uuid, p_created_by uuid)
returns boolean
language sql stable
as $$
  select app.has_perm(p_org, 'customers.view_all')
      or (app.has_perm(p_org, 'customers.view')
          and (p_seller = auth.uid() or p_created_by = auth.uid() or p_seller is null))
$$;

create table public.customer_interactions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  customer_id     uuid not null,
  channel         text not null check (channel in ('llamada','whatsapp','visita','email','nota','otro')),
  summary         text not null,
  occurred_at     timestamptz not null default now(),
  next_action     text,
  next_action_at  date,
  user_id         uuid not null references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers(id, org_id) on delete cascade
);
create index customer_interactions_customer_idx on public.customer_interactions(customer_id, occurred_at desc);

-- Contactos aún no calificados como clientes.
create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  full_name       text not null,
  phone           text,
  email           text,
  source          text,
  interest        text,
  assigned_to     uuid references public.user_profiles(id),
  status          text not null default 'nuevo' check (status in ('nuevo','contactado','convertido','descartado')),
  customer_id     uuid,
  created_by      uuid references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers(id, org_id)
);

create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  key         text not null,
  name        text not null,
  sort_order  smallint not null,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  unique (org_id, key),
  unique (id, org_id)
);

create table public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  customer_id     uuid not null,
  vehicle_id      uuid,
  stage_id        uuid not null,
  seller_id       uuid references public.user_profiles(id),
  title           text not null,
  expected_value  numeric(18,2),
  currency        char(3) not null default 'PYG' references public.currencies(code),
  status          text not null default 'abierta' check (status in ('abierta','ganada','perdida')),
  lost_reason     text,
  next_action     text,
  next_action_at  date,
  created_by      uuid references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, org_id),
  foreign key (customer_id, org_id) references public.customers(id, org_id) on delete cascade,
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id),
  foreign key (stage_id, org_id)    references public.pipeline_stages(id, org_id),
  check (app.money_ok(expected_value, currency))
);
create index opportunities_stage_idx on public.opportunities(org_id, stage_id) where status = 'abierta';

create trigger opportunities_touch before update on public.opportunities
  for each row execute function app.touch_updated_at();

create table public.opportunity_stage_events (
  id              bigint generated always as identity primary key,
  org_id          uuid not null,
  opportunity_id  uuid not null,
  from_stage_id   uuid,
  to_stage_id     uuid not null,
  actor_id        uuid,
  note            text,
  occurred_at     timestamptz not null default now(),
  foreign key (opportunity_id, org_id) references public.opportunities(id, org_id) on delete cascade
);

create or replace function app.opportunity_stage_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.opportunity_stage_events (org_id, opportunity_id, from_stage_id, to_stage_id, actor_id)
    values (new.org_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid());
  end if;
  return new;
end $$;

create trigger opportunities_stage_log after insert or update on public.opportunities
  for each row execute function app.opportunity_stage_log();

-- Etapas por defecto del embudo comercial
create or replace function app.init_pipeline_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pipeline_stages (org_id, key, name, sort_order, is_won, is_lost) values
    (new.id, 'nuevo',       'Nuevo contacto',      1, false, false),
    (new.id, 'contactado',  'Contactado',          2, false, false),
    (new.id, 'interesado',  'Interesado',          3, false, false),
    (new.id, 'propuesta',   'Propuesta enviada',   4, false, false),
    (new.id, 'negociacion', 'Negociación',         5, false, false),
    (new.id, 'reserva',     'Reserva',             6, false, false),
    (new.id, 'venta',       'Venta formalizada',   7, true,  false),
    (new.id, 'entrega',     'Entrega',             8, true,  false),
    (new.id, 'posventa',    'Seguimiento posventa',9, true,  false),
    (new.id, 'perdida',     'Perdida',            10, false, true);
  return new;
end $$;

create trigger organizations_pipeline_defaults after insert on public.organizations
  for each row execute function app.init_pipeline_defaults();

-- -----------------------------------------------------------------------------
-- Aprobaciones
-- -----------------------------------------------------------------------------
create table public.approvals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  kind           text not null check (kind in ('descuento','precio_bajo_minimo','recargo','nota_credito','ajuste',
                                               'refinanciacion','tasacion','factura_proveedor','gasto')),
  entity_type    text not null,
  entity_id      uuid not null,
  title          text not null,
  reason         text,
  amount         numeric(18,2),
  currency       char(3) references public.currencies(code),
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'pendiente' check (status in ('pendiente','aprobada','rechazada','anulada')),
  requested_by   uuid references public.user_profiles(id),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references public.user_profiles(id),
  decided_at     timestamptz,
  decision_note  text,
  check ((status = 'pendiente') = (decided_at is null))
);
create unique index approvals_pending_uq on public.approvals(entity_id, kind) where status = 'pendiente';
create index approvals_org_pending_idx on public.approvals(org_id, requested_at) where status = 'pendiente';

create trigger approvals_audit after insert or update on public.approvals
  for each row execute function app.audit_row();

-- Permiso necesario para decidir cada tipo de aprobación.
create or replace function app.approval_permission(p_kind text)
returns text language sql immutable as $$
  select case p_kind
    when 'descuento'          then 'deals.approve'
    when 'precio_bajo_minimo' then 'deals.approve'
    when 'recargo'            then 'contracts.approve'
    when 'nota_credito'       then 'contracts.approve'
    when 'ajuste'             then 'contracts.approve'
    when 'refinanciacion'     then 'contracts.approve'
    when 'tasacion'           then 'tradein.approve'
    when 'factura_proveedor'  then 'payables.approve'
    when 'gasto'              then 'expenses.approve'
  end
$$;

-- -----------------------------------------------------------------------------
-- Tasaciones (trade-in)
-- -----------------------------------------------------------------------------
create table public.trade_in_appraisals (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  number                  text not null,
  customer_id             uuid not null,
  brand_name              text not null,
  model                   text not null,
  version                 text,
  year_model              smallint not null check (year_model between 1950 and 2101),
  mileage_km              integer not null check (mileage_km >= 0),
  vin                     text,
  plate                   text,
  color                   text,
  fuel                    text check (fuel in ('nafta','diesel','hibrido','hibrido_enchufable','electrico','gnc','otro')),
  transmission            text check (transmission in ('manual','automatica','cvt','dct','otra')),
  doc_status              text not null default 'sin_revisar'
                          check (doc_status in ('sin_revisar','completa','observada','con_gravamen')),
  doc_notes               text,
  currency                char(3) not null default 'PYG' references public.currencies(code),
  market_value_estimate   numeric(18,2),
  market_value_source     text,
  market_value_date       date,
  offered_value           numeric(18,2),
  accepted_value          numeric(18,2),
  expected_resale_price   numeric(18,2),
  estimated_repair_costs  numeric(18,2) not null default 0,
  appraiser_notes         text,
  status                  text not null default 'borrador'
                          check (status in ('borrador','en_revision','aprobada','rechazada','aceptada_cliente','adquirida','anulada')),
  appraiser_id            uuid references public.user_profiles(id),
  approval_id             uuid references public.approvals(id),
  vehicle_id              uuid,
  created_by              uuid references public.user_profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (org_id, number),
  unique (id, org_id),
  foreign key (customer_id, org_id) references public.customers(id, org_id),
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id),
  check (app.money_ok(market_value_estimate, currency) and app.money_ok(offered_value, currency)
         and app.money_ok(accepted_value, currency) and app.money_ok(expected_resale_price, currency)
         and app.money_ok(estimated_repair_costs, currency)),
  check (market_value_estimate is null or (market_value_source is not null and market_value_date is not null))
);
comment on column public.trade_in_appraisals.market_value_estimate is
  'Valor de mercado ESTIMADO por el tasador. Requiere fuente y fecha. No es una tasación profesional verificada.';

create trigger trade_in_touch before update on public.trade_in_appraisals
  for each row execute function app.touch_updated_at();
create trigger trade_in_audit after insert or update on public.trade_in_appraisals
  for each row execute function app.audit_row();

create table public.appraisal_inspections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  appraisal_id    uuid not null,
  area            text not null check (area in ('mecanica','carroceria','neumaticos','interior','electronica','documentacion','otro')),
  rating          text not null check (rating in ('bueno','regular','malo','no_evaluado')),
  notes           text,
  repair_estimate numeric(18,2) not null default 0 check (repair_estimate >= 0),
  inspected_by    uuid references public.user_profiles(id),
  inspected_at    timestamptz not null default now(),
  foreign key (appraisal_id, org_id) references public.trade_in_appraisals(id, org_id) on delete cascade,
  unique (appraisal_id, area)
);

-- -----------------------------------------------------------------------------
-- Operaciones de venta
-- -----------------------------------------------------------------------------
create table public.deals (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  number                text not null,
  customer_id           uuid not null,
  vehicle_id            uuid not null,
  seller_id             uuid not null references public.user_profiles(id),
  opportunity_id        uuid,
  currency              char(3) not null references public.currencies(code),
  list_price            numeric(18,2) not null check (list_price >= 0),
  discount_amount       numeric(18,2) not null default 0 check (discount_amount >= 0),
  sale_price            numeric(18,2) generated always as (list_price - discount_amount) stored,
  trade_in_appraisal_id uuid,
  trade_in_value        numeric(18,2) not null default 0 check (trade_in_value >= 0),
  down_payment          numeric(18,2) not null default 0 check (down_payment >= 0),
  payment_type          text not null check (payment_type in ('contado','financiado')),
  -- Propuesta: {method, ratePercent, rateConvention, termMonths, firstDueDate, balloons[]}. Null en contado.
  -- Al formalizar, el motor genera el cronograma definitivo con estas condiciones y la fecha de firma.
  financing_terms       jsonb,
  status                text not null default 'borrador'
                        check (status in ('borrador','pendiente_aprobacion','aprobada','formalizada','entregada','anulada')),
  requires_approval     boolean not null default false,
  approval_reason       text,
  fx_rate_to_base       numeric(18,6),
  delivery_scheduled_on date,
  formalized_at         timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  notes                 text,
  created_by            uuid references public.user_profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, number),
  unique (id, org_id),
  foreign key (customer_id, org_id)           references public.customers(id, org_id),
  foreign key (vehicle_id, org_id)            references public.vehicles(id, org_id),
  foreign key (opportunity_id, org_id)        references public.opportunities(id, org_id),
  foreign key (trade_in_appraisal_id, org_id) references public.trade_in_appraisals(id, org_id),
  check (discount_amount <= list_price),
  check (trade_in_value + down_payment <= list_price - discount_amount),
  check (app.money_ok(list_price, currency) and app.money_ok(discount_amount, currency)
         and app.money_ok(trade_in_value, currency) and app.money_ok(down_payment, currency)),
  check (payment_type = 'financiado' or trade_in_value + down_payment = list_price - discount_amount
         or status in ('borrador','pendiente_aprobacion','aprobada','anulada')),
  check (payment_type = 'contado' or status in ('borrador','anulada') or financing_terms is not null)
);
-- Una unidad sólo puede tener una venta formalizada o entregada.
create unique index deals_vehicle_sold_uq on public.deals(vehicle_id) where status in ('formalizada','entregada');
create index deals_status_idx on public.deals(org_id, status);
create index deals_seller_idx on public.deals(org_id, seller_id);

comment on column public.deals.sale_price is 'Precio de venta = precio de lista − descuento.';
comment on column public.deals.trade_in_value is 'Valor de aceptación del vehículo usado aplicado como parte de pago.';

create or replace function app.can_see_deal(p_org uuid, p_seller uuid)
returns boolean language sql stable as $$
  select app.has_perm(p_org, 'deals.view_all')
      or (app.has_perm(p_org, 'deals.view') and p_seller = auth.uid())
$$;

create trigger deals_touch before update on public.deals
  for each row execute function app.touch_updated_at();
create trigger deals_audit after insert or update on public.deals
  for each row execute function app.audit_row();

-- Historial de precio y condiciones (cada cambio relevante de la operación)
create table public.deal_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null,
  deal_id      uuid not null,
  event        text not null,
  details      jsonb not null default '{}'::jsonb,
  actor_id     uuid,
  occurred_at  timestamptz not null default now(),
  foreign key (deal_id, org_id) references public.deals(id, org_id) on delete cascade
);
create index deal_events_deal_idx on public.deal_events(deal_id, occurred_at);
create trigger deal_events_immutable before update or delete on public.deal_events
  for each row execute function app.forbid_mutation();

create or replace function app.deal_event_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_events (org_id, deal_id, event, details, actor_id)
    values (new.org_id, new.id, 'creada', jsonb_build_object(
      'list_price', new.list_price, 'discount_amount', new.discount_amount, 'trade_in_value', new.trade_in_value,
      'down_payment', new.down_payment, 'payment_type', new.payment_type, 'currency', new.currency), auth.uid());
    return new;
  end if;
  if (new.list_price, new.discount_amount, new.trade_in_value, new.down_payment, new.payment_type, new.currency)
     is distinct from (old.list_price, old.discount_amount, old.trade_in_value, old.down_payment, old.payment_type, old.currency) then
    insert into public.deal_events (org_id, deal_id, event, details, actor_id)
    values (new.org_id, new.id, 'condiciones_modificadas', jsonb_build_object(
      'antes', jsonb_build_object('list_price', old.list_price, 'discount_amount', old.discount_amount,
                                  'trade_in_value', old.trade_in_value, 'down_payment', old.down_payment,
                                  'payment_type', old.payment_type, 'currency', old.currency),
      'despues', jsonb_build_object('list_price', new.list_price, 'discount_amount', new.discount_amount,
                                    'trade_in_value', new.trade_in_value, 'down_payment', new.down_payment,
                                    'payment_type', new.payment_type, 'currency', new.currency)), auth.uid());
  end if;
  if new.financing_terms is distinct from old.financing_terms then
    insert into public.deal_events (org_id, deal_id, event, details, actor_id)
    values (new.org_id, new.id, 'financiacion_modificada',
            jsonb_build_object('antes', old.financing_terms, 'despues', new.financing_terms), auth.uid());
  end if;
  if new.status is distinct from old.status then
    insert into public.deal_events (org_id, deal_id, event, details, actor_id)
    values (new.org_id, new.id, 'estado', jsonb_build_object('de', old.status, 'a', new.status), auth.uid());
  end if;
  return new;
end $$;

create trigger deals_event_log after insert or update on public.deals
  for each row execute function app.deal_event_log();

-- Bloquea cambios de condiciones fuera de borrador y transiciones de estado
-- que no provengan de las funciones transaccionales.
create or replace function app.deals_guard()
returns trigger
language plpgsql
as $$
begin
  if app.is_trusted() then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'El estado de la operación sólo cambia mediante las acciones de venta' using errcode = '42501';
  end if;
  if old.status not in ('borrador') and
     (new.list_price, new.discount_amount, new.trade_in_value, new.down_payment, new.payment_type, new.currency,
      new.vehicle_id, new.customer_id, new.trade_in_appraisal_id, new.financing_terms)
     is distinct from
     (old.list_price, old.discount_amount, old.trade_in_value, old.down_payment, old.payment_type, old.currency,
      old.vehicle_id, old.customer_id, old.trade_in_appraisal_id, old.financing_terms) then
    raise exception 'Las condiciones sólo se modifican en borrador' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger deals_guard before update on public.deals
  for each row execute function app.deals_guard();

-- -----------------------------------------------------------------------------
-- Reservas
-- -----------------------------------------------------------------------------
create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  number        text not null,
  vehicle_id    uuid not null,
  customer_id   uuid not null,
  deal_id       uuid,
  deposit_amount numeric(18,2) not null default 0 check (deposit_amount >= 0),
  currency      char(3) not null references public.currencies(code),
  expires_at    timestamptz not null,
  status        text not null default 'activa' check (status in ('activa','convertida','vencida','anulada')),
  notes         text,
  created_by    uuid references public.user_profiles(id),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  close_reason  text,
  unique (org_id, number),
  unique (id, org_id),
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id),
  foreign key (customer_id, org_id) references public.customers(id, org_id),
  foreign key (deal_id, org_id)     references public.deals(id, org_id),
  check (app.money_ok(deposit_amount, currency))
);
-- Una sola reserva activa por unidad (refuerza el bloqueo transaccional).
create unique index reservations_active_vehicle_uq on public.reservations(vehicle_id) where status = 'activa';

create trigger reservations_audit after insert or update on public.reservations
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Propuestas comerciales (cotizaciones). No crean contrato ni afectan inventario.
-- -----------------------------------------------------------------------------
create table public.proposals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  number        text not null,
  customer_id   uuid not null,
  vehicle_id    uuid not null,
  deal_id       uuid,
  currency      char(3) not null references public.currencies(code),
  terms         jsonb not null,
  valid_until   date not null,
  created_by    uuid references public.user_profiles(id),
  created_at    timestamptz not null default now(),
  unique (org_id, number),
  foreign key (customer_id, org_id) references public.customers(id, org_id),
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id),
  foreign key (deal_id, org_id)     references public.deals(id, org_id)
);
comment on table public.proposals is
  'Instantánea inmutable de una cotización (precio, financiación y tabla de pagos). No equivale a aprobación crediticia.';
create trigger proposals_immutable before update or delete on public.proposals
  for each row execute function app.forbid_mutation();
