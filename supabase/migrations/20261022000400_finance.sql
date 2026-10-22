-- =============================================================================
-- Da Silva OS — Contratos, financiación, cobros, cobranzas, caja y proveedores
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cuentas de caja / bancos (saldo REGISTRADO; sin integración bancaria)
-- -----------------------------------------------------------------------------
create table public.cash_accounts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  kind             text not null check (kind in ('caja','banco','billetera')),
  currency         char(3) not null references public.currencies(code),
  bank_name        text,
  account_ref      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id),
  unique (id, currency)
);
comment on table public.cash_accounts is
  'Cuentas registradas por la empresa. Sus saldos son registros internos y requieren conciliación manual contra extractos.';

create table public.reconciliations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null,
  account_id         uuid not null,
  period_end         date not null,
  statement_balance  numeric(18,2) not null,
  system_balance     numeric(18,2) not null,
  difference         numeric(18,2) generated always as (statement_balance - system_balance) stored,
  status             text not null default 'abierta' check (status in ('abierta','cerrada')),
  notes              text,
  created_by         uuid references public.user_profiles(id),
  created_at         timestamptz not null default now(),
  closed_by          uuid references public.user_profiles(id),
  closed_at          timestamptz,
  unique (id, org_id),
  foreign key (account_id, org_id) references public.cash_accounts(id, org_id)
);

create table public.cash_movements (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  account_id           uuid not null,
  occurred_on          date not null,
  direction            text not null check (direction in ('ingreso','egreso')),
  kind                 text not null check (kind in ('cobro_cliente','pago_proveedor','gasto','transferencia',
                                                     'ajuste','apertura','reversion','otro')),
  amount               numeric(18,2) not null check (amount > 0),
  currency             char(3) not null,
  description          text not null,
  reference            text,
  counterparty         text,
  customer_payment_id  uuid,
  supplier_payment_id  uuid,
  expense_id           uuid,
  reverses_id          uuid unique references public.cash_movements(id),
  status               text not null default 'registrado' check (status in ('registrado','conciliado')),
  reconciliation_id    uuid references public.reconciliations(id),
  created_by           uuid references public.user_profiles(id),
  created_at           timestamptz not null default now(),
  unique (id, org_id),
  foreign key (account_id, org_id)   references public.cash_accounts(id, org_id),
  foreign key (account_id, currency) references public.cash_accounts(id, currency),
  check (app.money_ok(amount, currency))
);
create index cash_movements_account_idx on public.cash_movements(account_id, occurred_on);
create index cash_movements_dup_idx on public.cash_movements(account_id, amount, occurred_on);

-- Los movimientos no se borran ni se modifican; sólo pueden pasar a conciliado.
create or replace function app.cash_movements_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los movimientos de caja no se borran. Registre una reversión.' using errcode = '55000';
  end if;
  if (to_jsonb(new) - 'status' - 'reconciliation_id') <> (to_jsonb(old) - 'status' - 'reconciliation_id') then
    raise exception 'Los movimientos de caja no se modifican. Registre una reversión.' using errcode = '55000';
  end if;
  if not app.is_trusted() then
    raise exception 'La conciliación se registra mediante el proceso de conciliación' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger cash_movements_guard before update or delete on public.cash_movements
  for each row execute function app.cash_movements_guard();
create trigger cash_movements_audit after insert or update on public.cash_movements
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Contratos y versiones
-- -----------------------------------------------------------------------------
create table public.contracts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  number           text not null,
  deal_id          uuid not null unique,
  customer_id      uuid not null,
  vehicle_id       uuid not null,
  currency         char(3) not null references public.currencies(code),
  sale_price       numeric(18,2) not null check (sale_price >= 0),
  trade_in_value   numeric(18,2) not null default 0,
  down_payment     numeric(18,2) not null default 0,
  financed_amount  numeric(18,2) not null default 0 check (financed_amount >= 0),
  status           text not null default 'vigente' check (status in ('vigente','saldado','anulado')),
  signed_on        date not null,
  current_version  integer not null default 1,
  collector_id     uuid references public.user_profiles(id),
  created_by       uuid references public.user_profiles(id),
  created_at       timestamptz not null default now(),
  unique (org_id, number),
  unique (id, org_id),
  foreign key (deal_id, org_id)     references public.deals(id, org_id),
  foreign key (customer_id, org_id) references public.customers(id, org_id),
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id),
  check (sale_price = trade_in_value + down_payment + financed_amount),
  check (app.money_ok(sale_price, currency) and app.money_ok(financed_amount, currency))
);
create index contracts_customer_idx on public.contracts(customer_id);
create index contracts_collector_idx on public.contracts(org_id, collector_id);

create trigger contracts_audit after insert or update on public.contracts
  for each row execute function app.audit_row();

create table public.financing_plans (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  contract_id      uuid not null,
  version_no       integer not null,
  method           text not null check (method in ('frances','aleman','sin_financiacion')),
  principal        numeric(18,2) not null check (principal >= 0),
  rate_input       numeric(12,6) not null default 0 check (rate_input >= 0),
  rate_convention  text not null check (rate_convention in ('nominal_annual','effective_annual','monthly')),
  monthly_rate     numeric(20,12) not null check (monthly_rate >= 0),
  term_months      integer not null check (term_months >= 0 and term_months <= 120),
  first_due_date   date,
  balloons         jsonb not null default '[]'::jsonb,
  total_interest   numeric(18,2) not null default 0,
  total_payable    numeric(18,2) not null default 0,
  created_by       uuid references public.user_profiles(id),
  created_at       timestamptz not null default now(),
  unique (id, org_id),
  unique (contract_id, version_no),
  foreign key (contract_id, org_id) references public.contracts(id, org_id)
);
comment on column public.financing_plans.rate_input is 'Tasa ingresada en porcentaje (p. ej. 18 = 18%), interpretada según rate_convention.';
comment on column public.financing_plans.monthly_rate is 'Tasa mensual efectiva derivada (fracción, p. ej. 0.015).';

create table public.contract_versions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  contract_id      uuid not null,
  version_no       integer not null,
  reason           text not null,
  terms            jsonb not null,
  financing_plan_id uuid references public.financing_plans(id),
  approval_id      uuid references public.approvals(id),
  created_by       uuid references public.user_profiles(id),
  created_at       timestamptz not null default now(),
  unique (contract_id, version_no),
  foreign key (contract_id, org_id) references public.contracts(id, org_id)
);
create trigger contract_versions_immutable before update or delete on public.contract_versions
  for each row execute function app.forbid_mutation();

create table public.installments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  contract_id       uuid not null,
  plan_id           uuid,
  seq               integer not null check (seq >= 0),
  kind              text not null check (kind in ('entrega_usado','entrega_inicial','cuota','refuerzo','recargo')),
  description       text,
  due_date          date not null,
  currency          char(3) not null,
  principal         numeric(18,2) not null default 0 check (principal >= 0),
  interest          numeric(18,2) not null default 0 check (interest >= 0),
  fee               numeric(18,2) not null default 0 check (fee >= 0),
  amount            numeric(18,2) generated always as (principal + interest + fee) stored,
  amount_cancelled  numeric(18,2) not null default 0 check (amount_cancelled >= 0),
  status            text not null default 'vigente' check (status in ('vigente','reemplazada')),
  approval_id       uuid references public.approvals(id),
  created_at        timestamptz not null default now(),
  unique (id, org_id),
  unique (contract_id, seq),
  foreign key (contract_id, org_id) references public.contracts(id, org_id),
  foreign key (plan_id, org_id)     references public.financing_plans(id, org_id),
  check (app.money_ok(principal, currency) and app.money_ok(interest, currency) and app.money_ok(fee, currency)),
  check (amount_cancelled <= principal + interest + fee),
  check (principal + interest + fee > 0)
);
create index installments_due_idx on public.installments(org_id, due_date) where status = 'vigente';
create index installments_contract_idx on public.installments(contract_id, seq);

-- Las cuotas sólo se generan/modifican mediante funciones transaccionales.
create or replace function app.installments_guard()
returns trigger
language plpgsql
as $$
begin
  if not app.is_trusted() then
    raise exception 'Las cuotas sólo se generan o modifican mediante el motor de financiación' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and
     (new.principal, new.interest, new.fee, new.due_date, new.contract_id, new.seq)
     is distinct from (old.principal, old.interest, old.fee, old.due_date, old.contract_id, old.seq) then
    raise exception 'El importe y vencimiento de una cuota no se modifican; utilice refinanciación' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Las cuotas no se borran' using errcode = '55000';
  end if;
  return coalesce(new, old);
end $$;

create trigger installments_guard before insert or update or delete on public.installments
  for each row execute function app.installments_guard();

-- -----------------------------------------------------------------------------
-- Pagos de clientes, aplicaciones y reversiones
-- -----------------------------------------------------------------------------
create table public.customer_payments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  number                text not null,
  customer_id           uuid not null,
  contract_id           uuid,
  reservation_id        uuid,
  received_on           date not null,
  method                text not null check (method in ('efectivo','transferencia','deposito','cheque','tarjeta',
                                                         'trade_in','nota_credito')),
  cash_account_id       uuid,
  currency              char(3) not null references public.currencies(code),
  amount                numeric(18,2) not null check (amount > 0),
  contract_currency     char(3) references public.currencies(code),
  fx_rate_to_contract   numeric(18,6) check (fx_rate_to_contract > 0),
  amount_contract       numeric(18,2) check (amount_contract > 0),
  reference             text,
  notes                 text,
  status                text not null default 'registrado'
                        check (status in ('registrado','confirmado','revertido','anulado')),
  evidence_document_id  uuid references public.documents(id),
  approval_id           uuid references public.approvals(id),
  registered_by         uuid references public.user_profiles(id),
  registered_at         timestamptz not null default now(),
  confirmed_by          uuid references public.user_profiles(id),
  confirmed_at          timestamptz,
  unique (org_id, number),
  unique (id, org_id),
  foreign key (customer_id, org_id)    references public.customers(id, org_id),
  foreign key (contract_id, org_id)    references public.contracts(id, org_id),
  foreign key (reservation_id, org_id) references public.reservations(id, org_id),
  foreign key (cash_account_id, currency) references public.cash_accounts(id, currency),
  check (app.money_ok(amount, currency)),
  check (contract_currency is null or app.money_ok(amount_contract, contract_currency)),
  check (method in ('trade_in','nota_credito') or cash_account_id is not null),
  check (method not in ('trade_in','nota_credito') or cash_account_id is null),
  check (contract_id is not null or reservation_id is not null),
  check ((status in ('confirmado','revertido')) = (confirmed_at is not null))
);
create index customer_payments_contract_idx on public.customer_payments(contract_id);
create index customer_payments_status_idx on public.customer_payments(org_id, status, received_on);
create index customer_payments_dup_idx on public.customer_payments(org_id, amount, received_on);

comment on column public.customer_payments.status is
  'registrado = informado, aún no cuenta como cobro; confirmado = cobro efectivo aplicado a cuotas; revertido = anulado mediante reversión auditada.';

create or replace function app.customer_payments_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los pagos no se borran' using errcode = '55000';
  end if;
  if not app.is_trusted() then
    raise exception 'Los pagos se modifican sólo mediante las acciones de cobro' using errcode = '42501';
  end if;
  if old.status in ('confirmado','revertido') and
     (new.amount, new.currency, new.customer_id, new.received_on, new.method, new.cash_account_id)
     is distinct from (old.amount, old.currency, old.customer_id, old.received_on, old.method, old.cash_account_id) then
    raise exception 'Un pago confirmado no se modifica; utilice una reversión' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger customer_payments_guard before update or delete on public.customer_payments
  for each row execute function app.customer_payments_guard();
create trigger customer_payments_audit after insert or update on public.customer_payments
  for each row execute function app.audit_row();

create table public.payment_reversals (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  payment_id        uuid not null unique,
  reason            text not null check (length(trim(reason)) >= 5),
  cash_movement_id  uuid references public.cash_movements(id),
  reversed_by       uuid references public.user_profiles(id),
  reversed_at       timestamptz not null default now(),
  unique (id, org_id),
  foreign key (payment_id, org_id) references public.customer_payments(id, org_id)
);
create trigger payment_reversals_immutable before update or delete on public.payment_reversals
  for each row execute function app.forbid_mutation();

-- Un pago puede cubrir varias cuotas y una cuota recibir varios pagos.
-- Importe en moneda del contrato. Las reversiones insertan filas negativas.
create table public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  payment_id      uuid not null,
  installment_id  uuid not null,
  amount          numeric(18,2) not null check (amount <> 0),
  reversal_id     uuid,
  created_by      uuid references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  foreign key (payment_id, org_id)     references public.customer_payments(id, org_id),
  foreign key (installment_id, org_id) references public.installments(id, org_id),
  foreign key (reversal_id, org_id)    references public.payment_reversals(id, org_id),
  check ((amount < 0) = (reversal_id is not null))
);
create index payment_allocations_installment_idx on public.payment_allocations(installment_id);
create index payment_allocations_payment_idx on public.payment_allocations(payment_id);

create trigger payment_allocations_immutable before update or delete on public.payment_allocations
  for each row execute function app.forbid_mutation();

-- Verificación diferida: ninguna cuota queda sobre-aplicada ni con saldo
-- negativo, y ningún pago aplica más que su importe.
create or replace function app.check_allocation_bounds()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inst_amount numeric; v_inst_cancel numeric; v_inst_alloc numeric;
  v_pay_amount numeric; v_pay_alloc numeric;
begin
  select i.amount, i.amount_cancelled into v_inst_amount, v_inst_cancel
  from public.installments i where i.id = new.installment_id;
  select coalesce(sum(a.amount), 0) into v_inst_alloc
  from public.payment_allocations a where a.installment_id = new.installment_id;
  if v_inst_alloc < 0 or v_inst_alloc > v_inst_amount - v_inst_cancel then
    raise exception 'Aplicación inválida: la cuota % quedaría con % aplicado sobre % exigible',
      new.installment_id, v_inst_alloc, v_inst_amount - v_inst_cancel using errcode = '23514';
  end if;
  select p.amount_contract into v_pay_amount from public.customer_payments p where p.id = new.payment_id;
  select coalesce(sum(a.amount), 0) into v_pay_alloc
  from public.payment_allocations a where a.payment_id = new.payment_id;
  if v_pay_alloc < 0 or v_pay_alloc > coalesce(v_pay_amount, 0) then
    raise exception 'Aplicación inválida: el pago % aplicaría % sobre un importe de %',
      new.payment_id, v_pay_alloc, v_pay_amount using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger payment_allocations_bounds
  after insert on public.payment_allocations
  deferrable initially deferred
  for each row execute function app.check_allocation_bounds();

-- -----------------------------------------------------------------------------
-- Cuenta corriente del contrato (libro append-only)
-- -----------------------------------------------------------------------------
create table public.contract_ledger_entries (
  id              bigint generated always as identity primary key,
  org_id          uuid not null,
  contract_id     uuid not null,
  entry_date      date not null,
  kind            text not null check (kind in ('cuota_generada','recargo','pago','nota_credito',
                                                 'reversion_pago','baja_refinanciacion')),
  description     text not null,
  debit           numeric(18,2) not null default 0 check (debit >= 0),
  credit          numeric(18,2) not null default 0 check (credit >= 0),
  installment_id  uuid references public.installments(id),
  payment_id      uuid references public.customer_payments(id),
  approval_id     uuid references public.approvals(id),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  foreign key (contract_id, org_id) references public.contracts(id, org_id),
  check ((debit > 0) <> (credit > 0))
);
create index contract_ledger_contract_idx on public.contract_ledger_entries(contract_id, entry_date, id);

create trigger contract_ledger_immutable before update or delete on public.contract_ledger_entries
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Gestión de cobranza
-- -----------------------------------------------------------------------------
create table public.collection_actions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  customer_id      uuid not null,
  contract_id      uuid,
  channel          text not null check (channel in ('llamada','whatsapp','visita','email','sms','otro')),
  result           text not null check (result in ('contactado','sin_respuesta','numero_erroneo','promesa_pago',
                                                   'pago_informado','negativa','otro')),
  notes            text,
  promise_amount   numeric(18,2) check (promise_amount > 0),
  promise_currency char(3) references public.currencies(code),
  promise_date     date,
  next_action      text,
  next_action_at   date,
  user_id          uuid not null references public.user_profiles(id),
  occurred_at      timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers(id, org_id),
  foreign key (contract_id, org_id) references public.contracts(id, org_id),
  check ((result = 'promesa_pago') = (promise_amount is not null and promise_date is not null and promise_currency is not null)),
  check (app.money_ok(promise_amount, promise_currency))
);
create index collection_actions_contract_idx on public.collection_actions(contract_id, occurred_at desc);
create index collection_actions_next_idx on public.collection_actions(org_id, next_action_at);
comment on column public.collection_actions.promise_amount is
  'Compromiso de pago. NO es dinero recibido; sólo los pagos confirmados cuentan como cobro.';

create trigger collection_actions_immutable before update or delete on public.collection_actions
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Proveedores: facturas y pagos
-- -----------------------------------------------------------------------------
create table public.supplier_invoices (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  supplier_id     uuid not null,
  invoice_number  text not null,
  timbrado        text,
  issue_date      date not null,
  due_date        date not null,
  currency        char(3) not null references public.currencies(code),
  amount          numeric(18,2) not null check (amount > 0),
  tax_amount      numeric(18,2) not null default 0 check (tax_amount >= 0),
  concept         text not null,
  category        text not null check (category in ('vehiculo','transporte','reparacion','documentacion','general')),
  vehicle_id      uuid,
  status          text not null default 'pendiente_aprobacion'
                  check (status in ('pendiente_aprobacion','aprobada','rechazada','anulada')),
  approval_id     uuid references public.approvals(id),
  document_id     uuid references public.documents(id),
  created_by      uuid references public.user_profiles(id),
  created_at      timestamptz not null default now(),
  unique (org_id, supplier_id, invoice_number),
  unique (id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  foreign key (vehicle_id, org_id)  references public.vehicles(id, org_id),
  check (due_date >= issue_date),
  check (tax_amount <= amount),
  check (app.money_ok(amount, currency) and app.money_ok(tax_amount, currency))
);
create index supplier_invoices_due_idx on public.supplier_invoices(org_id, due_date) where status = 'aprobada';

create trigger supplier_invoices_audit after insert or update on public.supplier_invoices
  for each row execute function app.audit_row();

alter table public.vehicle_costs
  add foreign key (supplier_invoice_id, org_id) references public.supplier_invoices(id, org_id);

create table public.supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  supplier_id      uuid not null,
  invoice_id       uuid not null,
  paid_on          date not null,
  amount           numeric(18,2) not null check (amount > 0),
  currency         char(3) not null,
  cash_account_id  uuid not null,
  reference        text,
  status           text not null default 'registrado' check (status in ('registrado','confirmado','revertido','anulado')),
  cash_movement_id uuid references public.cash_movements(id),
  created_by       uuid references public.user_profiles(id),
  created_at       timestamptz not null default now(),
  confirmed_by     uuid references public.user_profiles(id),
  confirmed_at     timestamptz,
  unique (id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  foreign key (invoice_id, org_id)  references public.supplier_invoices(id, org_id),
  foreign key (cash_account_id, currency) references public.cash_accounts(id, currency),
  check (app.money_ok(amount, currency))
);
create index supplier_payments_invoice_idx on public.supplier_payments(invoice_id);

create trigger supplier_payments_audit after insert or update on public.supplier_payments
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Gastos generales (no atribuibles a una unidad)
-- -----------------------------------------------------------------------------
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  number            text not null,
  expense_date      date not null,
  category          text not null check (category in ('alquiler','servicios','sueldos','comisiones','marketing',
                                                       'impuestos','mantenimiento','combustible','oficina','otro')),
  description       text not null,
  amount            numeric(18,2) not null check (amount > 0),
  currency          char(3) not null references public.currencies(code),
  supplier_id       uuid,
  status            text not null default 'pendiente_aprobacion'
                    check (status in ('pendiente_aprobacion','aprobado','rechazado','pagado','anulado')),
  approval_id       uuid references public.approvals(id),
  cash_account_id   uuid,
  cash_movement_id  uuid references public.cash_movements(id),
  created_by        uuid references public.user_profiles(id),
  created_at        timestamptz not null default now(),
  unique (org_id, number),
  unique (id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers(id, org_id),
  check (app.money_ok(amount, currency))
);

create trigger expenses_audit after insert or update on public.expenses
  for each row execute function app.audit_row();
