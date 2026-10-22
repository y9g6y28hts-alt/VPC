-- =============================================================================
-- Motor Haus · 0007 Negociaciones, reservas, financiación, aprobaciones,
--                    contratos y obligaciones (cuotas)
-- Una operación puede incluir varias unidades y varios trade-ins.
-- =============================================================================

create table public.deals (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  branch_id             uuid,
  number                text not null,
  customer_id           uuid not null,
  salesperson_id        uuid not null references public.user_profiles(id),
  currency              char(3) not null references public.currencies(code),
  status                text not null default 'draft' check (status in
                          ('draft','pending_approval','approved','rejected','formalized','cancelled')),
  cash_down_payment     numeric(18,2) not null default 0 check (cash_down_payment >= 0),
  other_credits         numeric(18,2) not null default 0 check (other_credits >= 0),
  other_credits_note    text,
  financed_charges      numeric(18,2) not null default 0 check (financed_charges >= 0),
  financed_charges_note text,
  notes                 text,
  proposal_valid_until  date,
  selected_plan_id      uuid,
  terms_hash            text,
  submitted_at          timestamptz,
  decided_at            timestamptz,
  formalized_at         timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  row_version           int not null default 1,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, number),
  unique (id, currency),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  check ((other_credits = 0) or other_credits_note is not null),
  check ((financed_charges = 0) or financed_charges_note is not null)
);
create index deals_org_status_idx on public.deals(organization_id, status);
create index deals_customer_idx on public.deals(customer_id);
create index deals_salesperson_idx on public.deals(organization_id, salesperson_id);
create trigger deals_touch before update on public.deals
  for each row execute function app.touch_updated_at();
create trigger deals_row_version before update on public.deals
  for each row execute function app.bump_row_version();
create trigger deals_audit after insert or update or delete on public.deals
  for each row execute function app.audit_row('row_version');

alter table public.customer_interactions
  add constraint customer_interactions_deal_fk foreign key (deal_id) references public.deals(id);
alter table public.sales_opportunities
  add constraint sales_opportunities_deal_fk foreign key (deal_id) references public.deals(id);
alter table public.trade_in_appraisals
  add constraint trade_in_appraisals_deal_fk foreign key (deal_id) references public.deals(id);

create table public.deal_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  deal_id          uuid not null,
  currency         char(3) not null,
  unit_id          uuid not null,
  list_price       numeric(18,2) not null check (list_price >= 0),
  minimum_price    numeric(18,2) not null check (minimum_price >= 0),
  negotiated_price numeric(18,2) not null check (negotiated_price > 0),
  cost_actual_snapshot    numeric(18,2),
  cost_estimated_snapshot numeric(18,2),
  created_at       timestamptz not null default now(),
  unique (deal_id, unit_id),
  foreign key (deal_id, currency) references public.deals(id, currency) on delete cascade,
  foreign key (organization_id, unit_id) references public.units(organization_id, id)
);
create index deal_items_unit_idx on public.deal_items(unit_id);
create trigger deal_items_audit after insert or update or delete on public.deal_items
  for each row execute function app.audit_row();

create table public.deal_trade_ins (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  deal_id          uuid not null,
  currency         char(3) not null,
  appraisal_id     uuid not null references public.trade_in_appraisals(id),
  accepted_value   numeric(18,2) not null check (accepted_value > 0),
  lien_payoff_amount numeric(18,2) not null default 0 check (lien_payoff_amount >= 0),
  created_at       timestamptz not null default now(),
  unique (appraisal_id),
  foreign key (deal_id, currency) references public.deals(id, currency) on delete cascade
);
create trigger deal_trade_ins_audit after insert or update or delete on public.deal_trade_ins
  for each row execute function app.audit_row();

create table public.reservations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  unit_id             uuid not null references public.units(id),
  customer_id         uuid not null references public.customers(id),
  deal_id             uuid references public.deals(id),
  status              text not null default 'active' check (status in ('active','released','expired','converted')),
  expires_at          timestamptz not null,
  deposit_amount      numeric(18,2) not null default 0 check (deposit_amount >= 0),
  deposit_currency    char(3) references public.currencies(code),
  conditions          text not null,
  responsible_user_id uuid not null references public.user_profiles(id),
  created_at          timestamptz not null default now(),
  closed_at           timestamptz,
  close_reason        text,
  created_by          uuid,
  check (deposit_amount = 0 or deposit_currency is not null)
);
-- Garantía de base de datos: como máximo una reserva activa por unidad.
create unique index reservations_one_active_idx on public.reservations(unit_id) where status = 'active';
create index reservations_expiry_idx on public.reservations(organization_id, expires_at) where status = 'active';
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function app.audit_row();

create table public.financing_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id         uuid not null references public.deals(id) on delete cascade,
  label           text not null,
  status          text not null default 'scenario' check (status in ('scenario','selected','contracted','discarded')),
  current_version int not null default 1,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (deal_id, label)
);
create index financing_plans_deal_idx on public.financing_plans(deal_id);
alter table public.deals
  add constraint deals_selected_plan_fk foreign key (selected_plan_id) references public.financing_plans(id);

-- Cada versión conserva entradas, calendario y versión del motor utilizada.
create table public.financing_plan_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id         uuid not null references public.financing_plans(id) on delete cascade,
  version         int not null,
  engine_version  text not null,
  inputs          jsonb not null,
  summary         jsonb not null,
  schedule        jsonb not null,
  checksum        text not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (plan_id, version)
);

create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type     text not null check (entity_type in ('deal','trade_in_appraisal','supplier_payable','installment_adjustment')),
  entity_id       uuid not null,
  rule            text not null check (rule in (
                    'discount','min_price','min_margin','trade_in_value','financing_term','financing_rate',
                    'tradein_max_price','tradein_margin','payable','adjustment','exception')),
  required_permission text not null references public.permissions(code),
  limit_value     jsonb not null,
  requested_value jsonb not null,
  message         text not null,
  terms_hash      text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','void')),
  requested_by    uuid,
  requested_at    timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  check (status = 'pending' or status = 'void' or decided_by is not null)
);
create index approvals_pending_idx on public.approvals(organization_id, status) where status = 'pending';
create index approvals_entity_idx on public.approvals(entity_type, entity_id);
create trigger approvals_audit after insert or update or delete on public.approvals
  for each row execute function app.audit_row();

create table public.sales_contracts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  number             text not null,
  deal_id            uuid not null unique references public.deals(id),
  customer_id        uuid not null references public.customers(id),
  salesperson_id     uuid not null references public.user_profiles(id),
  currency           char(3) not null references public.currencies(code),
  contract_date      date not null,
  total_price        numeric(18,2) not null check (total_price > 0),
  upfront_total      numeric(18,2) not null check (upfront_total >= 0),
  financed_principal numeric(18,2) not null check (financed_principal >= 0),
  status             text not null default 'active' check (status in ('active','settled','cancelled')),
  current_version    int not null default 1,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  unique (organization_id, number),
  unique (id, currency)
);
create index sales_contracts_customer_idx on public.sales_contracts(customer_id);
create trigger sales_contracts_audit after insert or update or delete on public.sales_contracts
  for each row execute function app.audit_row();

create table public.contract_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id     uuid not null references public.sales_contracts(id) on delete cascade,
  version         int not null,
  reason          text not null,
  terms           jsonb not null,
  plan_version_id uuid references public.financing_plan_versions(id),
  plan_checksum   text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (contract_id, version)
);

create table public.receivable_installments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  contract_id      uuid not null,
  currency         char(3) not null,
  contract_version int not null,
  plan_version_id  uuid references public.financing_plan_versions(id),
  customer_id      uuid not null references public.customers(id),
  seq              int not null check (seq >= 0),
  kind             text not null check (kind in ('down_payment','installment','balloon','charge')),
  label            text not null,
  due_date         date not null,
  principal_amount numeric(18,2) not null check (principal_amount >= 0),
  interest_amount  numeric(18,2) not null default 0 check (interest_amount >= 0),
  amount_due       numeric(18,2) generated always as (principal_amount + interest_amount) stored,
  status           text not null default 'open' check (status in ('open','superseded','cancelled')),
  created_at       timestamptz not null default now(),
  unique (contract_id, contract_version, seq),
  unique (id, currency),
  foreign key (contract_id, currency) references public.sales_contracts(id, currency),
  check (principal_amount + interest_amount > 0)
);
create index receivable_installments_due_idx on public.receivable_installments(organization_id, due_date) where status = 'open';
create index receivable_installments_contract_idx on public.receivable_installments(contract_id);
create index receivable_installments_customer_idx on public.receivable_installments(customer_id);

-- Las obligaciones emitidas son inmutables en importes y fechas.
create or replace function app.installment_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MH_FORBIDDEN: las obligaciones emitidas no se eliminan; use ajustes o una nueva versión contractual';
  end if;
  if new.principal_amount <> old.principal_amount or new.interest_amount <> old.interest_amount
     or new.due_date <> old.due_date or new.currency <> old.currency or new.contract_id <> old.contract_id then
    raise exception 'MH_FORBIDDEN: los importes y vencimientos emitidos no se editan; registre un ajuste auditable';
  end if;
  return new;
end $$;
create trigger receivable_installments_guard before update or delete on public.receivable_installments
  for each row execute function app.installment_guard();
create trigger receivable_installments_audit after insert or update on public.receivable_installments
  for each row execute function app.audit_row();

create table public.installment_adjustments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  installment_id   uuid not null,
  currency         char(3) not null,
  kind             text not null check (kind in ('credit_note','late_fee','interest','discount','write_off','correction')),
  amount           numeric(18,2) not null check (amount <> 0),
  effective_date   date not null default current_date,
  reason           text not null check (length(trim(reason)) >= 5),
  approval_id      uuid references public.approvals(id),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  foreign key (installment_id, currency) references public.receivable_installments(id, currency),
  -- Notas de crédito, descuentos y castigos reducen la obligación; recargos e intereses la aumentan.
  check ((kind in ('credit_note','discount','write_off') and amount < 0)
      or (kind in ('late_fee','interest') and amount > 0)
      or kind = 'correction')
);
create index installment_adjustments_inst_idx on public.installment_adjustments(installment_id);
create or replace function app.immutable_row() returns trigger
language plpgsql as $$
begin
  raise exception 'MH_FORBIDDEN: % es un registro inmutable; registre una contrapartida', tg_table_name;
end $$;
create trigger installment_adjustments_guard before update or delete on public.installment_adjustments
  for each row execute function app.immutable_row();
create trigger installment_adjustments_audit after insert on public.installment_adjustments
  for each row execute function app.audit_row();
