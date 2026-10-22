-- =============================================================================
-- Da Silva OS — Inventario, proveedores y documentos
-- =============================================================================

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  is_active   boolean not null default true,
  sort_order  smallint not null default 0,
  unique (org_id, name),
  unique (id, org_id)
);

create table public.vehicle_categories (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references public.organizations(id) on delete cascade,
  name     text not null,
  unique (org_id, name),
  unique (id, org_id)
);

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  tax_id      text,
  kind        text not null default 'general'
              check (kind in ('vehiculos','transporte','reparacion','documentacion','general')),
  phone       text,
  email       text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_by  uuid references public.user_profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, org_id)
);
create unique index suppliers_tax_id_uq on public.suppliers(org_id, tax_id) where tax_id is not null;

-- -----------------------------------------------------------------------------
-- Vehículos
-- -----------------------------------------------------------------------------
create table public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  branch_id          uuid,
  stock_code         text not null,
  brand_id           uuid not null,
  category_id        uuid,
  model              text not null,
  version            text,
  year_manufacture   smallint not null check (year_manufacture between 1950 and 2100),
  year_model         smallint not null check (year_model between 1950 and 2101),
  vin                text,
  engine_number      text,
  plate              text,
  mileage_km         integer not null default 0 check (mileage_km >= 0),
  fuel               text not null check (fuel in ('nafta','diesel','hibrido','hibrido_enchufable','electrico','gnc','otro')),
  transmission       text not null check (transmission in ('manual','automatica','cvt','dct','otra')),
  color              text,
  condition          text not null check (condition in ('nuevo','usado')),
  origin             text not null default 'compra_local'
                     check (origin in ('importacion','compra_local','trade_in','consignacion')),
  location           text,
  acquisition_date   date,
  supplier_id        uuid,
  responsible_id     uuid references public.user_profiles(id),
  -- Comercial
  price_currency     char(3) not null default 'PYG' references public.currencies(code),
  list_price         numeric(18,2) check (list_price is null or list_price >= 0),
  min_price          numeric(18,2) check (min_price is null or min_price >= 0),
  -- Estados independientes
  physical_status    text not null default 'recibido'
                     check (physical_status in ('en_transito','recibido','en_preparacion','en_reparacion','listo')),
  commercial_status  text not null default 'disponible'
                     check (commercial_status in ('disponible','reservado','vendido_pendiente_entrega','entregado','retirado')),
  contract_status    text not null default 'sin_contrato'
                     check (contract_status in ('sin_contrato','reservado','contrato_firmado','cancelado')),
  prep_status        text not null default 'pendiente'
                     check (prep_status in ('pendiente','en_proceso','completa','no_aplica')),
  doc_status         text not null default 'incompleta'
                     check (doc_status in ('incompleta','en_tramite','completa')),
  description        text,
  is_published       boolean not null default true,
  created_by         uuid references public.user_profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  row_version        integer not null default 1,
  unique (org_id, stock_code),
  unique (id, org_id),
  foreign key (branch_id, org_id)   references public.branches(id, org_id),
  foreign key (brand_id, org_id)    references public.brands(id, org_id),
  foreign key (category_id, org_id) references public.vehicle_categories(id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  check (app.money_ok(list_price, price_currency)),
  check (app.money_ok(min_price, price_currency)),
  check (min_price is null or list_price is null or min_price <= list_price),
  check (year_model between year_manufacture and year_manufacture + 1)
);
create unique index vehicles_vin_uq on public.vehicles(org_id, upper(vin)) where vin is not null and vin <> '';
create index vehicles_status_idx on public.vehicles(org_id, commercial_status);
create index vehicles_brand_idx on public.vehicles(org_id, brand_id);

comment on column public.vehicles.commercial_status is
  'Disponibilidad comercial. Sólo la modifican las funciones transaccionales de reservas y ventas, salvo "retirado".';
comment on column public.vehicles.contract_status is
  'Situación contractual derivada de reservas y contratos. No se edita manualmente.';

create trigger vehicles_touch before update on public.vehicles
  for each row execute function app.touch_updated_at();

-- Las transiciones de disponibilidad y situación contractual son exclusivas
-- de las funciones transaccionales (SECURITY DEFINER; ver app.is_trusted).
create or replace function app.vehicles_guard()
returns trigger
language plpgsql
as $$
begin
  if not app.is_trusted() then
    if new.contract_status is distinct from old.contract_status then
      raise exception 'La situación contractual sólo cambia mediante reservas y contratos' using errcode = '42501';
    end if;
    if new.commercial_status is distinct from old.commercial_status
       and not (old.commercial_status = 'disponible' and new.commercial_status = 'retirado')
       and not (old.commercial_status = 'retirado' and new.commercial_status = 'disponible') then
      raise exception 'La disponibilidad comercial sólo cambia mediante reservas, ventas y entregas (salvo retirar/reincorporar)'
        using errcode = '42501';
    end if;
    if new.list_price is distinct from old.list_price or new.min_price is distinct from old.min_price
       or new.price_currency is distinct from old.price_currency then
      if not app.has_perm(new.org_id, 'inventory.pricing.edit') then
        raise exception 'No tiene permiso para modificar precios' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.row_version := old.row_version + 1;
  end if;
  return new;
end $$;

create trigger vehicles_guard before update on public.vehicles
  for each row execute function app.vehicles_guard();

-- Historial de estados (todas las dimensiones)
create table public.vehicle_status_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null,
  vehicle_id   uuid not null,
  dimension    text not null check (dimension in ('physical','commercial','contract','prep','doc')),
  from_status  text,
  to_status    text not null,
  note         text,
  actor_id     uuid,
  occurred_at  timestamptz not null default now(),
  foreign key (vehicle_id, org_id) references public.vehicles(id, org_id) on delete cascade
);
create index vehicle_status_events_vehicle_idx on public.vehicle_status_events(vehicle_id, occurred_at desc);

create trigger vehicle_status_events_immutable before update or delete on public.vehicle_status_events
  for each row execute function app.forbid_mutation();

create or replace function app.vehicles_status_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(current_setting('app.status_note', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_status_events (org_id, vehicle_id, dimension, from_status, to_status, note, actor_id) values
      (new.org_id, new.id, 'physical',   null, new.physical_status,   'Alta de unidad', auth.uid()),
      (new.org_id, new.id, 'commercial', null, new.commercial_status, 'Alta de unidad', auth.uid());
    return new;
  end if;
  if new.physical_status is distinct from old.physical_status then
    insert into public.vehicle_status_events (org_id, vehicle_id, dimension, from_status, to_status, note, actor_id)
    values (new.org_id, new.id, 'physical', old.physical_status, new.physical_status, v_note, auth.uid());
  end if;
  if new.commercial_status is distinct from old.commercial_status then
    insert into public.vehicle_status_events (org_id, vehicle_id, dimension, from_status, to_status, note, actor_id)
    values (new.org_id, new.id, 'commercial', old.commercial_status, new.commercial_status, v_note, auth.uid());
  end if;
  if new.contract_status is distinct from old.contract_status then
    insert into public.vehicle_status_events (org_id, vehicle_id, dimension, from_status, to_status, note, actor_id)
    values (new.org_id, new.id, 'contract', old.contract_status, new.contract_status, v_note, auth.uid());
  end if;
  if new.prep_status is distinct from old.prep_status then
    insert into public.vehicle_status_events (org_id, vehicle_id, dimension, from_status, to_status, note, actor_id)
    values (new.org_id, new.id, 'prep', old.prep_status, new.prep_status, v_note, auth.uid());
  end if;
  if new.doc_status is distinct from old.doc_status then
    insert into public.vehicle_status_events (org_id, vehicle_id, dimension, from_status, to_status, note, actor_id)
    values (new.org_id, new.id, 'doc', old.doc_status, new.doc_status, v_note, auth.uid());
  end if;
  return new;
end $$;

create trigger vehicles_status_log after insert or update on public.vehicles
  for each row execute function app.vehicles_status_log();

create trigger vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Costes atribuibles por unidad
-- -----------------------------------------------------------------------------
create table public.vehicle_costs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  vehicle_id          uuid not null,
  kind                text not null check (kind in ('adquisicion','transporte','importacion','reparacion',
                                                     'preparacion','documentacion','comision','otro')),
  description         text not null,
  amount              numeric(18,2) not null check (amount >= 0),
  currency            char(3) not null references public.currencies(code),
  fx_rate_to_base     numeric(18,6) not null default 1 check (fx_rate_to_base > 0),
  amount_base         numeric(18,2) not null,
  is_estimate         boolean not null default false,
  incurred_on         date not null,
  supplier_id         uuid,
  supplier_invoice_id uuid,
  created_by          uuid references public.user_profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, org_id),
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id) on delete cascade,
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  check (app.money_ok(amount, currency))
);
create index vehicle_costs_vehicle_idx on public.vehicle_costs(vehicle_id);
comment on column public.vehicle_costs.is_estimate is
  'true = coste presupuestado aún no facturado (gasto pendiente). Se distingue en márgenes y alertas.';
comment on column public.vehicle_costs.amount_base is
  'Importe convertido a la moneda base de la organización con fx_rate_to_base.';

create or replace function app.vehicle_costs_compute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base char(3);
begin
  select base_currency into v_base from public.organizations where id = new.org_id;
  if new.currency = v_base then
    new.fx_rate_to_base := 1;
  end if;
  new.amount_base := app.round_money(new.amount * new.fx_rate_to_base, v_base);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if not app.is_trusted()
       and not app.has_perm(new.org_id, 'inventory.costs.edit_history') then
      raise exception 'Corregir un coste registrado requiere autorización (inventory.costs.edit_history)'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger vehicle_costs_compute before insert or update on public.vehicle_costs
  for each row execute function app.vehicle_costs_compute();
create trigger vehicle_costs_audit after insert or update or delete on public.vehicle_costs
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Documentos (Supabase Storage privado) y fotografías
-- -----------------------------------------------------------------------------
create table public.document_types (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('vehicle','customer','deal','contract','payment',
                                                    'supplier_invoice','trade_in','expense','cash_movement')),
  name        text not null,
  is_required boolean not null default false,
  applies_to_condition text check (applies_to_condition in ('nuevo','usado')),
  unique (org_id, entity_type, name)
);
comment on table public.document_types is
  'Tipos de documento configurables por entidad. is_required alimenta la alerta de documentación incompleta.';

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  entity_type   text not null check (entity_type in ('vehicle','customer','deal','contract','payment',
                                                      'supplier_invoice','trade_in','expense','cash_movement')),
  entity_id     uuid not null,
  document_type_id uuid references public.document_types(id),
  title         text not null,
  storage_bucket text not null default 'documents',
  storage_path  text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  is_restricted boolean not null default false,
  uploaded_by   uuid references public.user_profiles(id),
  uploaded_at   timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index documents_entity_idx on public.documents(entity_type, entity_id);

create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function app.audit_row();

-- Documentos de vehículos con su estado de verificación
create table public.vehicle_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  vehicle_id       uuid not null,
  document_type_id uuid not null references public.document_types(id),
  document_id      uuid references public.documents(id) on delete set null,
  status           text not null default 'pendiente' check (status in ('pendiente','recibido','verificado','observado')),
  notes            text,
  updated_by       uuid references public.user_profiles(id),
  updated_at       timestamptz not null default now(),
  foreign key (vehicle_id, org_id) references public.vehicles(id, org_id) on delete cascade,
  unique (vehicle_id, document_type_id)
);

create table public.vehicle_photos (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  vehicle_id    uuid not null,
  storage_path  text not null,
  sort_order    smallint not null default 0,
  is_cover      boolean not null default false,
  uploaded_by   uuid references public.user_profiles(id),
  uploaded_at   timestamptz not null default now(),
  foreign key (vehicle_id, org_id) references public.vehicles(id, org_id) on delete cascade
);
create unique index vehicle_photos_cover_uq on public.vehicle_photos(vehicle_id) where is_cover;
