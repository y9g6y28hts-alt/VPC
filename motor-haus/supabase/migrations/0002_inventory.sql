-- =============================================================================
-- Motor Haus · 0002 Inventario de activos
-- La ficha de unidad modela por separado los estados de adquisición, logística,
-- preparación y comercialización. Los cambios de estado comercial que implican
-- obligaciones (reserva, venta, entrega) solo ocurren mediante funciones.
-- =============================================================================

create table public.locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid,
  code            text not null,
  name            text not null,
  kind            text not null check (kind in ('showroom','warehouse','workshop','port','customs','external')),
  active          boolean not null default true,
  unique (organization_id, code),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

-- Política de costes: qué conceptos integran el coste gerencial del inventario.
create table public.cost_concepts (
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  code                      text not null check (code ~ '^[a-z_]+$'),
  label                     text not null,
  include_in_inventory_cost boolean not null default true,
  sort_order                int not null default 100,
  primary key (organization_id, code)
);
comment on column public.cost_concepts.include_in_inventory_cost is
  'Definido según la política de la empresa y su asesor contable.';

create table public.units (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  branch_id           uuid,
  stock_number        text not null,
  category            text not null check (category in
                        ('supercar','premium_suv','sedan_gt','classic','motorcycle','boat','other')),
  make                text not null,
  model               text not null,
  version             text,
  year_built          smallint check (year_built between 1885 and 2100),
  model_year          smallint check (model_year between 1885 and 2101),
  usage_value         numeric(12,1) check (usage_value >= 0),
  usage_unit          text not null default 'km' check (usage_unit in ('km','mi','h')),
  exterior_color      text,
  interior_color      text,
  equipment           text[] not null default '{}',
  origin              text not null default 'local_purchase'
                        check (origin in ('import','local_purchase','trade_in','consignment')),
  origin_country      text,
  description         text,
  location_id         uuid references public.locations(id),
  responsible_user_id uuid references public.user_profiles(id),
  currency            char(3) not null references public.currencies(code),
  list_price          numeric(18,2) check (list_price >= 0),
  minimum_price       numeric(18,2) check (minimum_price >= 0),
  offer_price         numeric(18,2) check (offer_price >= 0),
  acquisition_status  text not null default 'evaluation'
                        check (acquisition_status in ('evaluation','approved','acquired','rejected')),
  logistics_status    text not null default 'pending'
                        check (logistics_status in ('pending','in_transit','in_customs','received')),
  preparation_status  text not null default 'not_started'
                        check (preparation_status in ('not_started','in_preparation','ready','in_service')),
  commercial_status   text not null default 'not_listed'
                        check (commercial_status in
                        ('not_listed','available','reserved','sold_pending_delivery','delivered','retired')),
  acquired_on         date,
  received_on         date,
  listed_on           date,
  sold_on             date,
  delivered_on        date,
  retired_on          date,
  retire_reason       text,
  source_appraisal_id uuid,
  row_version         int not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  unique (organization_id, stock_number),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  check (minimum_price is null or list_price is null or minimum_price <= list_price),
  -- Una unidad comercializable debe estar adquirida y recibida.
  check (commercial_status in ('not_listed','retired')
         or (acquisition_status = 'acquired' and logistics_status = 'received')),
  check (commercial_status <> 'available' or (list_price is not null and minimum_price is not null))
);
create index units_org_status_idx on public.units(organization_id, commercial_status);
create index units_org_category_idx on public.units(organization_id, category);
create index units_search_idx on public.units using gin (
  to_tsvector('simple', coalesce(stock_number,'') || ' ' || make || ' ' || model || ' ' || coalesce(version,'')));
create trigger units_touch before update on public.units
  for each row execute function app.touch_updated_at();
create trigger units_audit after insert or update or delete on public.units
  for each row execute function app.audit_row('row_version');

create or replace function app.bump_row_version() returns trigger
language plpgsql as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end $$;
create trigger units_row_version before update on public.units
  for each row execute function app.bump_row_version();

create table public.unit_identifiers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  unit_id           uuid not null references public.units(id) on delete cascade,
  kind              text not null check (kind in ('vin','chassis','engine','hull','registration','serial')),
  value             text not null check (length(trim(value)) > 0),
  normalized_value  text generated always as (upper(regexp_replace(value, '[\s\-\.]', '', 'g'))) stored,
  allow_duplicate   boolean not null default false,
  duplicate_reason  text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  check (not allow_duplicate or length(coalesce(duplicate_reason, '')) >= 10),
  unique (unit_id, kind)
);
-- Evita duplicar VIN/chasis/motor salvo excepciones documentadas (p. ej. clásicos).
create unique index unit_identifiers_unique_idx
  on public.unit_identifiers(organization_id, kind, normalized_value)
  where not allow_duplicate;
create index unit_identifiers_lookup_idx on public.unit_identifiers(organization_id, normalized_value);
create trigger unit_identifiers_audit after insert or update or delete on public.unit_identifiers
  for each row execute function app.audit_row();

create table public.unit_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  kind            text not null default 'photo' check (kind in ('photo','video')),
  storage_path    text not null,
  caption         text,
  sort_order      int not null default 100,
  is_cover        boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid
);
create unique index unit_media_one_cover_idx on public.unit_media(unit_id) where is_cover;

create table public.unit_costs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  unit_id               uuid not null references public.units(id) on delete cascade,
  concept_code          text not null,
  nature                text not null check (nature in ('estimated','actual')),
  amount                numeric(18,2) not null check (amount > 0),
  currency              char(3) not null references public.currencies(code),
  unit_currency         char(3) not null references public.currencies(code),
  fx_rate               numeric(20,8) check (fx_rate > 0),
  fx_date               date,
  fx_source             text,
  amount_unit_currency  numeric(18,2) not null check (amount_unit_currency > 0),
  incurred_on           date not null default current_date,
  description           text,
  supplier_payable_id   uuid,
  settles_estimate_id   uuid references public.unit_costs(id),
  status                text not null default 'active' check (status in ('active','settled','voided')),
  void_reason           text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  foreign key (organization_id, concept_code) references public.cost_concepts(organization_id, code),
  -- Nunca se mezclan monedas en silencio: otra moneda exige cotización trazable.
  check ((currency = unit_currency and fx_rate is null)
      or (currency <> unit_currency and fx_rate is not null and fx_date is not null and fx_source is not null)),
  check (status <> 'voided' or length(coalesce(void_reason, '')) >= 5),
  check (settles_estimate_id is null or nature = 'actual')
);
create index unit_costs_unit_idx on public.unit_costs(unit_id) where status = 'active';
create trigger unit_costs_audit after insert or update or delete on public.unit_costs
  for each row execute function app.audit_row();

create table public.unit_status_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  dimension       text not null check (dimension in ('acquisition','logistics','preparation','commercial')),
  from_status     text,
  to_status       text not null,
  source          text not null default 'manual',
  reason          text,
  actor_id        uuid,
  occurred_at     timestamptz not null default now()
);
create index unit_status_events_unit_idx on public.unit_status_events(unit_id, occurred_at desc);

create table public.unit_price_history (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  field           text not null check (field in ('list_price','minimum_price','offer_price')),
  old_value       numeric(18,2),
  new_value       numeric(18,2),
  currency        char(3) not null,
  reason          text not null,
  actor_id        uuid,
  changed_at      timestamptz not null default now()
);
create index unit_price_history_unit_idx on public.unit_price_history(unit_id, changed_at desc);

-- Historial de ubicación física.
create table public.unit_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  location_id     uuid not null references public.locations(id),
  moved_at        timestamptz not null default now(),
  moved_by        uuid,
  note            text
);
create index unit_locations_unit_idx on public.unit_locations(unit_id, moved_at desc);

create table public.unit_documents (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  unit_id           uuid not null references public.units(id) on delete cascade,
  doc_type          text not null,
  label             text not null,
  required_for_sale boolean not null default true,
  status            text not null default 'pending' check (status in ('pending','received','verified','not_applicable')),
  storage_path      text,
  notes             text,
  received_on       date,
  verified_by       uuid,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (unit_id, doc_type)
);
create trigger unit_documents_audit after insert or update or delete on public.unit_documents
  for each row execute function app.audit_row();

-- Conteos físicos para detectar diferencias con el inventario registrado.
create table public.physical_counts (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  unit_id              uuid not null references public.units(id) on delete cascade,
  counted_on           date not null default current_date,
  found                boolean not null,
  observed_location_id uuid references public.locations(id),
  expected_location_id uuid references public.locations(id),
  notes                text,
  counted_by           uuid,
  created_at           timestamptz not null default now()
);
create index physical_counts_unit_idx on public.physical_counts(unit_id, counted_on desc, created_at desc);

-- Flujo de estados configurable. Las transiciones con via_function = true solo
-- las ejecutan funciones de negocio (reserva, venta, entrega, recepción).
create table public.status_transitions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dimension       text not null check (dimension in ('acquisition','logistics','preparation','commercial')),
  from_status     text not null,
  to_status       text not null,
  via_function    boolean not null default false,
  label           text not null,
  primary key (organization_id, dimension, from_status, to_status)
);

-- Documentación exigida según la procedencia de la unidad (configurable).
create table public.unit_document_requirements (
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  origin            text not null check (origin in ('import','local_purchase','trade_in','consignment')),
  doc_type          text not null,
  label             text not null,
  required_for_sale boolean not null default true,
  primary key (organization_id, origin, doc_type)
);
