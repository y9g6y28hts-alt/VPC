-- =============================================================================
-- Motor Haus · 0005 CRM
-- Expediente único por cliente. Los identificadores personales se protegen con
-- privilegios de columna: solo se leen mediante una función que exige
-- customer.pii.read y deja constancia en auditoría.
-- =============================================================================

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  kind                text not null check (kind in ('individual','company','trust','other')),
  display_name        text not null check (length(trim(display_name)) >= 2),
  legal_name          text,
  document_type       text check (document_type in ('ci','ruc','passport','foreign_id','other')),
  document_number     text,
  document_normalized text generated always as (
                        nullif(upper(regexp_replace(coalesce(document_number, ''), '[^A-Za-z0-9]', '', 'g')), '')
                      ) stored,
  tax_id              text,
  email               text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone               text,
  city                text,
  country             text,
  address             text,
  preferences         jsonb not null default '{}'::jsonb,
  tags                text[] not null default '{}',
  owner_user_id       uuid references public.user_profiles(id),
  status              text not null default 'active' check (status in ('prospect','active','inactive')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  unique (organization_id, id),
  check ((document_number is null) = (document_type is null))
);
-- Evita expedientes duplicados por documento.
create unique index customers_document_unique_idx
  on public.customers(organization_id, document_type, document_normalized)
  where document_normalized is not null;
create index customers_name_idx on public.customers using gin (to_tsvector('simple', display_name || ' ' || coalesce(legal_name, '')));
create index customers_owner_idx on public.customers(organization_id, owner_user_id);
create trigger customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();
-- La auditoría excluye los identificadores personales completos.
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function app.audit_row('document_number', 'document_normalized', 'tax_id', 'address');

create table public.customer_interactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  channel         text not null check (channel in ('in_person','phone','whatsapp','email','video','event','other')),
  kind            text not null check (kind in ('inquiry','visit','test_drive','follow_up','proposal','complaint','note')),
  summary         text not null check (length(trim(summary)) >= 3),
  unit_id         uuid references public.units(id),
  deal_id         uuid,
  occurred_at     timestamptz not null default now(),
  user_id         uuid references public.user_profiles(id),
  created_at      timestamptz not null default now()
);
create index customer_interactions_customer_idx on public.customer_interactions(customer_id, occurred_at desc);

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid references public.customers(id),
  contact_name    text not null,
  contact_info    text,
  source          text not null check (source in ('walk_in','referral','web','social','event','broker','other')),
  interest        text,
  unit_id         uuid references public.units(id),
  status          text not null default 'new' check (status in ('new','contacted','qualified','converted','discarded')),
  owner_user_id   uuid references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.sales_opportunities (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  customer_id       uuid not null references public.customers(id),
  unit_id           uuid references public.units(id),
  stage             text not null default 'interest' check (stage in ('interest','proposal','negotiation','won','lost')),
  expected_value    numeric(18,2) check (expected_value >= 0),
  currency          char(3) references public.currencies(code),
  owner_user_id     uuid references public.user_profiles(id),
  expected_close_on date,
  lost_reason       text,
  deal_id           uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
