-- =============================================================================
-- Motor Haus · 0008 Pagos de clientes, asignaciones, reversiones y cobranzas
-- Un pago puede cubrir varias cuotas y una cuota puede recibir varios pagos.
-- Solo los pagos confirmados (no revertidos) cuentan como cobrados.
-- =============================================================================

create table public.customer_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  number           text not null,
  customer_id      uuid not null references public.customers(id),
  contract_id      uuid references public.sales_contracts(id),
  amount           numeric(18,2) not null check (amount > 0),
  currency         char(3) not null references public.currencies(code),
  effective_date   date not null,
  method           text not null check (method in ('transfer','cash','card','check','other')),
  reference        text,
  cash_account_id  uuid not null,
  status           text not null default 'pending_reconciliation'
                     check (status in ('pending_reconciliation','confirmed','rejected','reversed')),
  idempotency_key  text not null check (length(idempotency_key) between 8 and 128),
  notes            text,
  recorded_by      uuid,
  recorded_at      timestamptz not null default now(),
  confirmed_by     uuid,
  confirmed_at     timestamptz,
  rejected_by      uuid,
  rejected_at      timestamptz,
  rejected_reason  text,
  cash_movement_id uuid references public.cash_movements(id),
  unique (organization_id, number),
  unique (id, currency),
  -- Protección frente a envíos repetidos del mismo formulario.
  unique (organization_id, idempotency_key),
  -- La moneda del pago debe ser la de la cuenta receptora.
  foreign key (cash_account_id, currency) references public.cash_accounts(id, currency),
  check (method = 'cash' or reference is not null),
  check (status <> 'confirmed' or (confirmed_by is not null and cash_movement_id is not null))
);
-- Una misma referencia bancaria no puede registrarse dos veces en la misma cuenta.
create unique index customer_payments_reference_idx
  on public.customer_payments(organization_id, cash_account_id, upper(reference))
  where reference is not null and status in ('pending_reconciliation','confirmed','reversed');
create index customer_payments_customer_idx on public.customer_payments(customer_id);
create index customer_payments_status_idx on public.customer_payments(organization_id, status);
create trigger customer_payments_audit after insert or update or delete on public.customer_payments
  for each row execute function app.audit_row();

create or replace function app.customer_payment_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MH_FORBIDDEN: los pagos no se eliminan; rechace o revierta el pago';
  end if;
  if new.amount <> old.amount or new.currency <> old.currency or new.customer_id <> old.customer_id
     or new.effective_date <> old.effective_date then
    raise exception 'MH_FORBIDDEN: el importe, la moneda, el cliente y la fecha de un pago no se modifican';
  end if;
  if old.status in ('rejected','reversed') then
    raise exception 'MH_STATE: el pago está % y no admite cambios', old.status;
  end if;
  if old.status = 'confirmed' and new.status not in ('confirmed','reversed') then
    raise exception 'MH_STATE: un pago confirmado solo puede revertirse';
  end if;
  return new;
end $$;
create trigger customer_payments_guard before update or delete on public.customer_payments
  for each row execute function app.customer_payment_guard();

create table public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id      uuid not null,
  installment_id  uuid not null,
  currency        char(3) not null,
  amount          numeric(18,2) not null check (amount > 0),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (payment_id, installment_id),
  -- Ambas referencias exigen la misma moneda: nunca se mezclan importes.
  foreign key (payment_id, currency) references public.customer_payments(id, currency),
  foreign key (installment_id, currency) references public.receivable_installments(id, currency)
);
create index payment_allocations_installment_idx on public.payment_allocations(installment_id);
create trigger payment_allocations_audit after insert or update or delete on public.payment_allocations
  for each row execute function app.audit_row();

-- Las asignaciones de pagos confirmados o revertidos son inmutables.
create or replace function app.payment_allocation_guard() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.customer_payments
  where id = coalesce(old.payment_id, new.payment_id);
  if v_status <> 'pending_reconciliation' then
    raise exception 'MH_FORBIDDEN: las asignaciones de un pago % no se modifican', v_status;
  end if;
  return coalesce(new, old);
end $$;
create trigger payment_allocations_guard before update or delete on public.payment_allocations
  for each row execute function app.payment_allocation_guard();

create table public.payment_reversals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  payment_id       uuid not null unique references public.customer_payments(id),
  reason           text not null check (length(trim(reason)) >= 5),
  cash_movement_id uuid references public.cash_movements(id),
  reversed_by      uuid not null,
  reversed_at      timestamptz not null default now()
);
create trigger payment_reversals_guard before update or delete on public.payment_reversals
  for each row execute function app.immutable_row();

create table public.collection_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  customer_id      uuid not null references public.customers(id),
  contract_id      uuid references public.sales_contracts(id),
  channel          text not null check (channel in ('phone','whatsapp','email','in_person','letter','other')),
  contacted_at     timestamptz not null default now(),
  user_id          uuid not null references public.user_profiles(id),
  outcome          text not null check (outcome in ('no_answer','contacted','promise','refused','wrong_contact','dispute','other')),
  promise_amount   numeric(18,2) check (promise_amount > 0),
  promise_currency char(3) references public.currencies(code),
  promise_date     date,
  next_action      text,
  next_action_date date,
  notes            text,
  created_at       timestamptz not null default now(),
  -- Un compromiso de pago siempre tiene importe, moneda y fecha; no es un pago.
  check ((outcome = 'promise') = (promise_amount is not null and promise_currency is not null and promise_date is not null))
);
create index collection_actions_customer_idx on public.collection_actions(customer_id, contacted_at desc);
create index collection_actions_next_idx on public.collection_actions(organization_id, next_action_date);
create trigger collection_actions_audit after insert or update or delete on public.collection_actions
  for each row execute function app.audit_row();
