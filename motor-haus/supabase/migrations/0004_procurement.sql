-- =============================================================================
-- Motor Haus · 0004 Compras, importaciones y cuentas por pagar
-- =============================================================================

create table public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  kind            text not null check (kind in
                    ('vehicle_seller','logistics','customs_broker','workshop','services','operating','other')),
  tax_id          text,
  country         text,
  email           text,
  phone           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function app.audit_row();

create table public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          text not null,
  supplier_id     uuid not null references public.suppliers(id),
  order_date      date not null,
  currency        char(3) not null references public.currencies(code),
  status          text not null default 'draft'
                    check (status in ('draft','approved','partially_received','received','cancelled')),
  notes           text,
  created_by      uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, number),
  unique (id, currency)
);
create trigger purchase_orders_audit after insert or update or delete on public.purchase_orders
  for each row execute function app.audit_row();

create table public.purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null,
  currency          char(3) not null,
  unit_id           uuid references public.units(id),
  description       text not null,
  amount            numeric(18,2) not null check (amount > 0),
  foreign key (purchase_order_id, currency) references public.purchase_orders(id, currency) on delete cascade
);
create index purchase_order_lines_po_idx on public.purchase_order_lines(purchase_order_id);

create table public.shipments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  reference           text not null,
  purchase_order_id   uuid references public.purchase_orders(id),
  carrier_supplier_id uuid references public.suppliers(id),
  origin_country      text not null,
  origin_port         text,
  destination         text,
  transport_mode      text not null check (transport_mode in ('sea','air','land','other')),
  departed_on         date,
  eta_original        date,
  eta                 date,
  arrived_on          date,
  customs_cleared_on  date,
  status              text not null default 'planned' check (status in
                        ('planned','in_transit','arrived_port','in_customs','cleared','delivered','cancelled')),
  responsible_user_id uuid references public.user_profiles(id),
  tracking            text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, reference)
);
comment on column public.shipments.eta is 'Estimación sujeta a cambios; nunca una garantía.';
create trigger shipments_touch before update on public.shipments
  for each row execute function app.touch_updated_at();
create trigger shipments_audit after insert or update or delete on public.shipments
  for each row execute function app.audit_row();

create table public.shipment_units (
  shipment_id     uuid not null references public.shipments(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (shipment_id, unit_id)
);
create index shipment_units_unit_idx on public.shipment_units(unit_id);

create table public.import_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id     uuid not null references public.shipments(id) on delete cascade,
  event_type      text not null check (event_type in
                    ('status_change','eta_change','incident','document','note','receipt')),
  severity        text check (severity in ('info','warning','critical')),
  description     text not null,
  old_value       text,
  new_value       text,
  resolved        boolean not null default false,
  resolved_at     timestamptz,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid
);
create index import_events_shipment_idx on public.import_events(shipment_id, occurred_at desc);

-- Facturas de proveedores (supplier invoices) y su saldo pendiente.
create table public.supplier_payables (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  supplier_id       uuid not null references public.suppliers(id),
  document_type     text not null default 'invoice' check (document_type in ('invoice','receipt','debit_note','other')),
  document_number   text not null,
  concept           text not null,
  category          text not null check (category in
                      ('vehicle_purchase','logistics','customs','taxes','services','maintenance','operating','other')),
  unit_id           uuid references public.units(id),
  purchase_order_id uuid references public.purchase_orders(id),
  amount            numeric(18,2) not null check (amount > 0),
  currency          char(3) not null references public.currencies(code),
  issue_date        date not null,
  due_date          date not null,
  approval_status   text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  approved_by       uuid,
  approved_at       timestamptz,
  cancelled         boolean not null default false,
  cancel_reason     text,
  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  check (due_date >= issue_date),
  unique (organization_id, supplier_id, document_type, document_number),
  unique (id, currency)
);
create index supplier_payables_due_idx on public.supplier_payables(organization_id, due_date) where not cancelled;
create trigger supplier_payables_audit after insert or update or delete on public.supplier_payables
  for each row execute function app.audit_row();

alter table public.unit_costs
  add constraint unit_costs_payable_fk foreign key (supplier_payable_id) references public.supplier_payables(id);

create table public.payable_payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  payable_id        uuid not null,
  currency          char(3) not null,
  amount            numeric(18,2) not null check (amount > 0),
  paid_on           date not null,
  cash_account_id   uuid not null references public.cash_accounts(id),
  cash_amount       numeric(18,2) not null check (cash_amount > 0),
  fx_rate           numeric(20,8) check (fx_rate > 0),
  fx_date           date,
  fx_source         text,
  cash_movement_id  uuid references public.cash_movements(id),
  reference         text,
  status            text not null default 'posted' check (status in ('posted','reversed')),
  reversed_reason   text,
  reversed_at       timestamptz,
  reversed_by       uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  foreign key (payable_id, currency) references public.supplier_payables(id, currency)
);
create index payable_payments_payable_idx on public.payable_payments(payable_id) where status = 'posted';
create trigger payable_payments_audit after insert or update or delete on public.payable_payments
  for each row execute function app.audit_row();
