-- =============================================================================
-- Motor Haus · 0006 Tasaciones (trade-in)
-- Una tasación nunca crea inventario por sí misma: la incorporación ocurre
-- mediante app.acquire_trade_in() una vez formalizada la adquisición.
-- =============================================================================

create table public.trade_in_appraisals (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations(id) on delete cascade,
  number                      text not null,
  customer_id                 uuid not null references public.customers(id),
  deal_id                     uuid,
  category                    text not null default 'other' check (category in
                                ('supercar','premium_suv','sedan_gt','classic','motorcycle','boat','other')),
  make                        text not null,
  model                       text not null,
  version                     text,
  year_built                  smallint check (year_built between 1885 and 2100),
  usage_value                 numeric(12,1) check (usage_value >= 0),
  usage_unit                  text not null default 'km' check (usage_unit in ('km','mi','h')),
  identifier_kind             text check (identifier_kind in ('vin','chassis','hull','serial')),
  identifier_value            text,
  history_notes               text,
  documentation_status        text not null default 'pending'
                                check (documentation_status in ('pending','incomplete','complete','issues')),
  body_condition              text check (body_condition in ('excellent','good','fair','poor')),
  interior_condition          text check (interior_condition in ('excellent','good','fair','poor')),
  tires_condition             text check (tires_condition in ('excellent','good','fair','poor')),
  mechanical_condition        text check (mechanical_condition in ('excellent','good','fair','poor')),
  inspection_notes            text,
  inspector_report            text,
  currency                    char(3) not null references public.currencies(code),
  market_value_estimate       numeric(18,2) check (market_value_estimate > 0),
  market_value_source         text,
  market_value_date           date,
  proposed_acquisition_price  numeric(18,2) check (proposed_acquisition_price > 0),
  expected_resale_price       numeric(18,2) check (expected_resale_price >= 0),
  uncertainty                 text check (uncertainty in ('low','medium','high')),
  max_authorized_price        numeric(18,2) check (max_authorized_price > 0),
  lien_payoff_amount          numeric(18,2) not null default 0 check (lien_payoff_amount >= 0),
  accepted_value              numeric(18,2) check (accepted_value > 0),
  status                      text not null default 'draft' check (status in
                                ('draft','inspected','valued','pending_approval','approved','rejected',
                                 'accepted','acquired','withdrawn')),
  decision_note               text,
  appraiser_id                uuid references public.user_profiles(id),
  acquired_unit_id            uuid references public.units(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,
  unique (organization_id, number),
  -- Un valor de mercado siempre declara su fuente y fecha de referencia.
  check (market_value_estimate is null or (market_value_source is not null and market_value_date is not null)),
  check (status not in ('valued','pending_approval','approved','accepted','acquired')
         or (proposed_acquisition_price is not null and expected_resale_price is not null
             and market_value_estimate is not null and uncertainty is not null))
);
create index trade_in_appraisals_customer_idx on public.trade_in_appraisals(customer_id);
create trigger trade_in_appraisals_touch before update on public.trade_in_appraisals
  for each row execute function app.touch_updated_at();
create trigger trade_in_appraisals_audit after insert or update or delete on public.trade_in_appraisals
  for each row execute function app.audit_row();

create table public.appraisal_inspections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appraisal_id    uuid not null references public.trade_in_appraisals(id) on delete cascade,
  item            text not null,
  result          text not null check (result in ('ok','attention','fail','not_checked')),
  notes           text,
  inspected_by    uuid,
  inspected_at    timestamptz not null default now(),
  unique (appraisal_id, item)
);

create table public.appraisal_costs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  appraisal_id    uuid not null references public.trade_in_appraisals(id) on delete cascade,
  concept         text not null check (concept in ('reconditioning','repairs','tires','documentation','transport','preparation','other')),
  description     text,
  amount          numeric(18,2) not null check (amount > 0),
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index appraisal_costs_appraisal_idx on public.appraisal_costs(appraisal_id);
create trigger appraisal_costs_audit after insert or update or delete on public.appraisal_costs
  for each row execute function app.audit_row();
