-- =============================================================================
-- Motor Haus · 0003 Tesorería
-- Cuentas financieras y movimientos. Sin integración bancaria, todo movimiento
-- se identifica como registrado manualmente (data_origin = 'manual').
-- Los movimientos contabilizados no se editan: se corrigen con contrapartidas.
-- =============================================================================

create table public.cash_accounts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  name                  text not null,
  kind                  text not null check (kind in ('bank','cash','card_processor','other')),
  currency              char(3) not null references public.currencies(code),
  bank_name             text,
  account_number_masked text,
  opening_balance       numeric(18,2) not null default 0,
  opening_date          date not null default current_date,
  data_origin           text not null default 'manual' check (data_origin in ('manual','bank_feed')),
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, currency)
);
comment on column public.cash_accounts.data_origin is
  'manual: saldos registrados por usuarios. bank_feed solo cuando exista integración bancaria real.';
create trigger cash_accounts_audit after insert or update or delete on public.cash_accounts
  for each row execute function app.audit_row();

create table public.bank_reconciliations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  cash_account_id   uuid not null references public.cash_accounts(id),
  statement_date    date not null,
  statement_balance numeric(18,2) not null,
  book_balance      numeric(18,2) not null,
  difference        numeric(18,2) generated always as (statement_balance - book_balance) stored,
  notes             text,
  reconciled_by     uuid,
  created_at        timestamptz not null default now()
);

create table public.cash_movements (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  cash_account_id       uuid not null,
  currency              char(3) not null,
  movement_date         date not null,
  amount                numeric(18,2) not null check (amount <> 0),
  category              text not null check (category in (
                          'customer_payment','customer_payment_reversal','supplier_payment',
                          'supplier_payment_reversal','operating_expense','payroll','tax','transfer',
                          'owner_contribution','owner_withdrawal','financing','adjustment','other_income')),
  status                text not null default 'posted' check (status in ('pending','posted')),
  description           text,
  reference             text,
  counterparty          text,
  source_type           text not null default 'manual'
                          check (source_type in ('manual','customer_payment','payment_reversal','payable_payment','payable_payment_reversal','reversal')),
  source_id             uuid,
  reverses_movement_id  uuid references public.cash_movements(id),
  data_origin           text not null default 'manual' check (data_origin in ('manual','bank_feed')),
  reconciliation_status text not null default 'unreconciled' check (reconciliation_status in ('unreconciled','reconciled')),
  reconciliation_id     uuid references public.bank_reconciliations(id),
  document_ref          text,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  -- La moneda del movimiento es siempre la de la cuenta.
  foreign key (cash_account_id, currency) references public.cash_accounts(id, currency)
);
create index cash_movements_account_idx on public.cash_movements(cash_account_id, movement_date);
create index cash_movements_org_date_idx on public.cash_movements(organization_id, movement_date);
create unique index cash_movements_one_reversal_idx on public.cash_movements(reverses_movement_id)
  where reverses_movement_id is not null;
create trigger cash_movements_audit after insert or update or delete on public.cash_movements
  for each row execute function app.audit_row();

-- Inmutabilidad de importes: solo se permite cambiar conciliación y estado pendiente→contabilizado.
create or replace function app.cash_movement_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MH_FORBIDDEN: los movimientos financieros no se eliminan; registre una contrapartida';
  end if;
  if new.amount <> old.amount or new.currency <> old.currency or new.cash_account_id <> old.cash_account_id
     or new.movement_date <> old.movement_date or new.category <> old.category
     or (old.status = 'posted' and new.status <> 'posted') then
    raise exception 'MH_FORBIDDEN: un movimiento registrado no se modifica; registre una contrapartida';
  end if;
  return new;
end $$;
create trigger cash_movements_guard before update or delete on public.cash_movements
  for each row execute function app.cash_movement_guard();

-- Cotizaciones explícitas. Se usan solo cuando el usuario elige convertir.
create table public.exchange_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  base_currency   char(3) not null references public.currencies(code),
  quote_currency  char(3) not null references public.currencies(code),
  rate            numeric(20,8) not null check (rate > 0),
  rate_date       date not null,
  source          text not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  check (base_currency <> quote_currency),
  unique (organization_id, base_currency, quote_currency, rate_date, source)
);
comment on table public.exchange_rates is
  'rate = unidades de quote_currency por 1 base_currency. Nunca se aplica de forma implícita.';
