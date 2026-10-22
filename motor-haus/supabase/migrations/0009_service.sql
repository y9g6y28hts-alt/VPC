-- =============================================================================
-- Motor Haus · 0009 Preparación y servicio
-- Una unidad solo pasa a "lista" cuando todas sus tareas obligatorias
-- están completadas (o exentas con motivo).
-- =============================================================================

create table public.service_orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  number              text not null,
  unit_id             uuid not null references public.units(id),
  kind                text not null check (kind in ('preparation','repair','maintenance','pre_delivery')),
  status              text not null default 'open' check (status in ('open','in_progress','completed','cancelled')),
  supplier_id         uuid references public.suppliers(id),
  responsible_user_id uuid references public.user_profiles(id),
  description         text not null,
  due_on              date,
  completed_on        date,
  estimated_cost      numeric(18,2) check (estimated_cost >= 0),
  currency            char(3) references public.currencies(code),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (organization_id, number),
  check (estimated_cost is null or currency is not null)
);
create index service_orders_unit_idx on public.service_orders(unit_id);
create trigger service_orders_audit after insert or update or delete on public.service_orders
  for each row execute function app.audit_row();

create table public.inspections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  kind            text not null check (kind in ('intake','mechanical','pre_delivery')),
  result          text not null check (result in ('pass','pass_with_observations','fail')),
  checklist       jsonb not null default '[]'::jsonb,
  notes           text,
  inspector_id    uuid references public.user_profiles(id),
  inspected_on    date not null default current_date,
  created_at      timestamptz not null default now()
);
create index inspections_unit_idx on public.inspections(unit_id, inspected_on desc);

create table public.preparation_tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  unit_id          uuid not null references public.units(id) on delete cascade,
  service_order_id uuid references public.service_orders(id),
  title            text not null,
  mandatory        boolean not null default true,
  status           text not null default 'pending' check (status in ('pending','done','waived')),
  waive_reason     text,
  assignee_id      uuid references public.user_profiles(id),
  due_on           date,
  done_by          uuid,
  done_at          timestamptz,
  sort_order       int not null default 100,
  created_at       timestamptz not null default now(),
  check (status <> 'waived' or length(coalesce(waive_reason, '')) >= 5)
);
create index preparation_tasks_unit_idx on public.preparation_tasks(unit_id);
create trigger preparation_tasks_audit after insert or update or delete on public.preparation_tasks
  for each row execute function app.audit_row();

-- Plantilla de tareas que se crean al recibir físicamente una unidad.
create table public.preparation_templates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null,
  mandatory       boolean not null default true,
  sort_order      int not null default 100,
  primary key (organization_id, title)
);
