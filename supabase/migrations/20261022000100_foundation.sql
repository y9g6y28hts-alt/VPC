-- =============================================================================
-- Da Silva OS — Fundación: organizaciones, usuarios, roles, permisos, auditoría
-- =============================================================================
-- Convenciones:
--   * Importes: numeric(18,2) + código de moneda explícito (ISO 4217).
--     PYG no admite decimales; USD admite 2 (ver app.currency_decimals).
--   * Estados: text + CHECK (más fácil de evolucionar que los ENUM nativos).
--   * Toda tabla de negocio lleva org_id y RLS habilitado.
--   * Las operaciones críticas se ejecutan mediante funciones transaccionales
--     (ver *_rpc.sql); las tablas financieras son append-only.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;
comment on schema app is 'Funciones internas de Da Silva OS (no expuestas por la API de datos).';

-- Nadie fuera de los propietarios puede crear objetos en public.
revoke create on schema public from public;

-- -----------------------------------------------------------------------------
-- Monedas
-- -----------------------------------------------------------------------------
create table public.currencies (
  code      char(3) primary key,
  name      text not null,
  decimals  smallint not null check (decimals between 0 and 4),
  symbol    text not null
);

insert into public.currencies (code, name, decimals, symbol) values
  ('PYG', 'Guaraní paraguayo', 0, '₲'),
  ('USD', 'Dólar estadounidense', 2, 'US$');

-- Inmutable para poder usarse en CHECK. Agregar una moneda requiere migración.
create or replace function app.currency_decimals(p_currency text)
returns smallint language sql immutable parallel safe as $$
  select case p_currency when 'PYG' then 0::smallint when 'USD' then 2::smallint else null end
$$;

create or replace function app.money_ok(p_amount numeric, p_currency text)
returns boolean language sql immutable parallel safe as $$
  select p_amount is null
      or (app.currency_decimals(p_currency) is not null
          and p_amount = round(p_amount, app.currency_decimals(p_currency)))
$$;

create or replace function app.round_money(p_amount numeric, p_currency text)
returns numeric language sql immutable parallel safe as $$
  select round(p_amount, app.currency_decimals(p_currency))
$$;

-- -----------------------------------------------------------------------------
-- Organizaciones y sucursales
-- -----------------------------------------------------------------------------
create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  legal_name      text,
  tax_id          text,                       -- RUC
  base_currency   char(3) not null default 'PYG' references public.currencies(code),
  timezone        text not null default 'America/Asuncion',
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now()
);
comment on column public.organizations.is_demo is
  'Organización de demostración. Sus datos están aislados de las organizaciones reales y la interfaz lo indica.';

create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);

-- -----------------------------------------------------------------------------
-- Usuarios
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.roles (
  key          text primary key,
  name         text not null,
  description  text not null,
  sort_order   smallint not null
);

insert into public.roles (key, name, description, sort_order) values
  ('director',           'Director',              'Propietario o dirección general. Acceso total y aprobaciones.', 1),
  ('administracion',     'Administración',        'Contratos, documentación, pagos y proveedores.', 2),
  ('gerencia_comercial', 'Gerencia comercial',    'Equipo de ventas, precios, descuentos y tasaciones.', 3),
  ('vendedor',           'Vendedor',              'Clientes propios, oportunidades, propuestas y reservas.', 4),
  ('cobranzas',          'Cobranzas',             'Cartera, mora, gestiones y registro de cobros.', 5),
  ('inventario',         'Inventario',            'Altas de unidades, costes, preparación y documentación.', 6),
  ('finanzas',           'Finanzas',              'Caja, conciliación, cuentas por pagar y reportes.', 7),
  ('auditor',            'Auditor',               'Lectura completa y auditoría. Sin permisos de escritura.', 8),
  ('admin_tecnico',      'Administrador técnico', 'Usuarios, configuración y auditoría técnica. Sin datos financieros.', 9);

create table public.permissions (
  key          text primary key,
  module       text not null,
  description  text not null
);

insert into public.permissions (key, module, description) values
  ('dashboard.view',              'direccion',   'Ver el tablero de dirección con indicadores financieros'),
  ('inventory.view',              'inventario',  'Ver unidades, precios de lista y disponibilidad'),
  ('inventory.create',            'inventario',  'Dar de alta unidades'),
  ('inventory.edit',              'inventario',  'Editar ficha técnica, ubicación y estados físicos'),
  ('inventory.pricing.edit',      'inventario',  'Modificar precio de lista y precio mínimo'),
  ('inventory.costs.view',        'inventario',  'Ver costes, coste total y márgenes'),
  ('inventory.costs.create',      'inventario',  'Registrar costes atribuibles a una unidad'),
  ('inventory.costs.edit_history','inventario',  'Corregir costes ya registrados (queda auditado)'),
  ('customers.view',              'clientes',    'Ver clientes asignados o creados por el usuario'),
  ('customers.view_all',          'clientes',    'Ver todos los clientes'),
  ('customers.create',            'clientes',    'Crear clientes'),
  ('customers.edit',              'clientes',    'Editar clientes'),
  ('crm.manage',                  'clientes',    'Gestionar oportunidades, interacciones y etapas'),
  ('deals.view',                  'ventas',      'Ver operaciones propias'),
  ('deals.view_all',              'ventas',      'Ver todas las operaciones'),
  ('deals.create',                'ventas',      'Crear y editar operaciones en borrador'),
  ('deals.approve',               'ventas',      'Aprobar descuentos y precios bajo el mínimo'),
  ('deals.formalize',             'ventas',      'Formalizar ventas (contrato y plan de pagos)'),
  ('deals.deliver',               'ventas',      'Registrar entrega física'),
  ('deals.cancel',                'ventas',      'Anular operaciones'),
  ('reservations.manage',         'ventas',      'Crear y anular reservas'),
  ('contracts.view',              'financiacion','Ver contratos, planes y cuotas'),
  ('contracts.adjust',            'financiacion','Solicitar recargos, notas de crédito, ajustes y refinanciaciones'),
  ('contracts.approve',           'financiacion','Aprobar recargos, notas de crédito, ajustes y refinanciaciones'),
  ('payments.view',               'cobranzas',   'Ver pagos de clientes'),
  ('payments.register',           'cobranzas',   'Registrar pagos recibidos (pendientes de confirmación)'),
  ('payments.confirm',            'cobranzas',   'Confirmar pagos y aplicarlos a cuotas'),
  ('payments.reverse',            'cobranzas',   'Revertir pagos confirmados'),
  ('collections.view',            'cobranzas',   'Ver cartera, mora y gestiones'),
  ('collections.manage',          'cobranzas',   'Registrar gestiones y compromisos de pago'),
  ('collections.assign',          'cobranzas',   'Asignar responsables de cobranza'),
  ('tradein.view',                'tradein',     'Ver tasaciones'),
  ('tradein.create',              'tradein',     'Registrar tasaciones e inspecciones'),
  ('tradein.approve',             'tradein',     'Aprobar o rechazar tasaciones'),
  ('tradein.acquire',             'tradein',     'Formalizar la adquisición e ingresar al inventario'),
  ('suppliers.view',              'compras',     'Ver proveedores'),
  ('suppliers.manage',            'compras',     'Crear y editar proveedores'),
  ('payables.view',               'compras',     'Ver facturas y cuentas por pagar'),
  ('payables.create',             'compras',     'Registrar facturas de proveedores'),
  ('payables.approve',            'compras',     'Aprobar facturas de proveedores'),
  ('payables.pay',                'compras',     'Registrar y confirmar pagos a proveedores'),
  ('expenses.view',               'gastos',      'Ver gastos'),
  ('expenses.create',             'gastos',      'Registrar gastos'),
  ('expenses.approve',            'gastos',      'Aprobar gastos'),
  ('cash.view',                   'caja',        'Ver cuentas y movimientos registrados'),
  ('cash.register',               'caja',        'Registrar movimientos manuales'),
  ('cash.reverse',                'caja',        'Revertir movimientos'),
  ('cash.reconcile',              'caja',        'Conciliar cuentas'),
  ('reports.view',                'reportes',    'Ver reportes de dirección'),
  ('reports.export',              'reportes',    'Exportar reportes'),
  ('audit.view',                  'auditoria',   'Consultar la auditoría'),
  ('documents.view_restricted',   'documentos',  'Ver documentos marcados como restringidos'),
  ('settings.manage',             'configuracion','Modificar configuración de la organización'),
  ('users.manage',                'configuracion','Gestionar usuarios y roles');

create table public.role_permissions (
  role        text not null references public.roles(key) on delete cascade,
  permission  text not null references public.permissions(key) on delete cascade,
  primary key (role, permission)
);

-- Matriz inicial. Fuente de verdad única; src/domain/permissions la refleja y
-- una prueba verifica que ambas coincidan.
insert into public.role_permissions (role, permission)
select 'director', key from public.permissions;

insert into public.role_permissions (role, permission)
select 'auditor', key from public.permissions
where key like '%.view' or key like '%.view_all' or key in ('reports.export', 'documents.view_restricted');

insert into public.role_permissions (role, permission) select 'administracion', unnest(array[
  'dashboard.view','inventory.view','inventory.costs.view','inventory.costs.create',
  'customers.view','customers.view_all','customers.create','customers.edit',
  'deals.view','deals.view_all','deals.formalize','deals.deliver',
  'contracts.view','contracts.adjust','payments.view','payments.register','payments.confirm',
  'collections.view','tradein.view','suppliers.view','suppliers.manage',
  'payables.view','payables.create','expenses.view','expenses.create',
  'cash.view','cash.register','reports.view','documents.view_restricted']);

insert into public.role_permissions (role, permission) select 'gerencia_comercial', unnest(array[
  'dashboard.view','inventory.view','inventory.pricing.edit','inventory.costs.view',
  'customers.view','customers.view_all','customers.create','customers.edit','crm.manage',
  'deals.view','deals.view_all','deals.create','deals.approve','deals.formalize','deals.deliver','deals.cancel',
  'reservations.manage','contracts.view','payments.view','collections.view',
  'tradein.view','tradein.create','tradein.approve','reports.view']);

insert into public.role_permissions (role, permission) select 'vendedor', unnest(array[
  'inventory.view','customers.view','customers.create','customers.edit','crm.manage',
  'deals.view','deals.create','reservations.manage','tradein.view','tradein.create']);

insert into public.role_permissions (role, permission) select 'cobranzas', unnest(array[
  'customers.view','customers.view_all','contracts.view','payments.view','payments.register',
  'collections.view','collections.manage','collections.assign']);

insert into public.role_permissions (role, permission) select 'inventario', unnest(array[
  'inventory.view','inventory.create','inventory.edit','inventory.costs.view','inventory.costs.create',
  'tradein.view','tradein.acquire','suppliers.view','payables.view','payables.create','expenses.view']);

insert into public.role_permissions (role, permission) select 'finanzas', unnest(array[
  'dashboard.view','inventory.view','inventory.costs.view','inventory.costs.edit_history',
  'customers.view','customers.view_all','deals.view','deals.view_all',
  'contracts.view','contracts.adjust','contracts.approve',
  'payments.view','payments.register','payments.confirm','payments.reverse',
  'collections.view','collections.assign','tradein.view','tradein.acquire',
  'suppliers.view','suppliers.manage','payables.view','payables.create','payables.approve','payables.pay',
  'expenses.view','expenses.create','expenses.approve',
  'cash.view','cash.register','cash.reverse','cash.reconcile',
  'reports.view','reports.export','documents.view_restricted']);

insert into public.role_permissions (role, permission) select 'admin_tecnico', unnest(array[
  'audit.view','settings.manage','users.manage']);

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  role        text not null references public.roles(key),
  branch_id   uuid,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (branch_id, org_id) references public.branches(id, org_id)
);
create index memberships_user_idx on public.memberships(user_id) where is_active;

-- -----------------------------------------------------------------------------
-- Helpers de seguridad
-- -----------------------------------------------------------------------------
create or replace function app.uid()
returns uuid language sql stable as $$ select auth.uid() $$;

-- ¿La sentencia se ejecuta dentro de una función transaccional del sistema?
-- Dentro de una función SECURITY DEFINER, current_user es su propietario; en
-- DML directo de un usuario es "authenticated" (o "anon"). No es falsificable
-- desde la sesión del usuario, a diferencia de una variable de configuración.
-- No debe declararse SECURITY DEFINER.
create or replace function app.is_trusted()
returns boolean language sql stable as $$
  select current_user not in ('authenticated', 'anon')
$$;

-- ¿El usuario actual tiene el permiso en la organización?
create or replace function app.has_perm(p_org uuid, p_perm text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    join public.user_profiles u on u.id = m.user_id and u.is_active
    join public.role_permissions rp on rp.role = m.role
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.is_active
      and rp.permission = p_perm
  )
$$;

create or replace function app.is_member(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    join public.user_profiles u on u.id = m.user_id and u.is_active
    where m.org_id = p_org and m.user_id = auth.uid() and m.is_active
  )
$$;

create or replace function app.user_role(p_org uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = auth.uid() and m.is_active
$$;

-- Lanza una excepción legible si falta el permiso. Usado por las RPC.
create or replace function app.require_perm(p_org uuid, p_perm text)
returns void
language plpgsql stable
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida' using errcode = '28000';
  end if;
  if not app.has_perm(p_org, p_perm) then
    raise exception 'No tiene permiso para esta operación (%)', p_perm using errcode = '42501';
  end if;
end $$;

create or replace function app.org_today(p_org uuid)
returns date
language sql stable
set search_path = public, pg_temp
as $$
  select (now() at time zone coalesce((select timezone from public.organizations where id = p_org), 'America/Asuncion'))::date
$$;

-- -----------------------------------------------------------------------------
-- Auditoría (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id           bigint generated always as identity primary key,
  org_id       uuid references public.organizations(id) on delete cascade,
  actor_id     uuid,
  action       text not null,                 -- insert | update | delete | <acción de negocio>
  entity_type  text not null,
  entity_id    text,
  summary      text,
  before_data  jsonb,
  after_data   jsonb,
  occurred_at  timestamptz not null default now()
);
create index audit_events_org_time_idx on public.audit_events(org_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id);

create or replace function app.audit(p_org uuid, p_action text, p_entity_type text, p_entity_id text,
                                     p_summary text, p_before jsonb default null, p_after jsonb default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, summary, before_data, after_data)
  values (p_org, auth.uid(), p_action, p_entity_type, p_entity_id, p_summary, p_before, p_after)
$$;

-- Trigger genérico para tablas sensibles. Registra el diff completo.
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_id  text;
begin
  if tg_op = 'DELETE' then
    v_org := (to_jsonb(old) ->> 'org_id')::uuid;
    v_id  := to_jsonb(old) ->> 'id';
  else
    v_org := (to_jsonb(new) ->> 'org_id')::uuid;
    v_id  := to_jsonb(new) ->> 'id';
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (v_org, auth.uid(), lower(tg_op), tg_table_name, v_id,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Impide UPDATE/DELETE en tablas append-only.
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los registros de % no se pueden modificar ni borrar. Utilice una reversión auditable.', tg_table_name
    using errcode = '55000';
end $$;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function app.forbid_mutation();

-- updated_at automático
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger user_profiles_touch before update on public.user_profiles
  for each row execute function app.touch_updated_at();

create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Numeración de documentos (sin huecos dentro de una transacción confirmada)
-- -----------------------------------------------------------------------------
create table public.document_sequences (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null,
  year        integer not null,
  last_value  integer not null default 0,
  primary key (org_id, kind, year)
);

create or replace function app.next_number(p_org uuid, p_kind text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from app.org_today(p_org))::integer;
  v_val  integer;
begin
  insert into public.document_sequences (org_id, kind, year, last_value)
  values (p_org, p_kind, v_year, 1)
  on conflict (org_id, kind, year) do update set last_value = public.document_sequences.last_value + 1
  returning last_value into v_val;
  return p_prefix || '-' || v_year || '-' || lpad(v_val::text, 5, '0');
end $$;

-- -----------------------------------------------------------------------------
-- Tipos de cambio (carga manual; sin integración externa)
-- -----------------------------------------------------------------------------
create table public.exchange_rates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  rate_date      date not null,
  from_currency  char(3) not null references public.currencies(code),
  to_currency    char(3) not null references public.currencies(code),
  rate           numeric(18,6) not null check (rate > 0),
  source         text not null default 'manual',
  created_by     uuid references public.user_profiles(id),
  created_at     timestamptz not null default now(),
  check (from_currency <> to_currency),
  unique (org_id, rate_date, from_currency, to_currency)
);
comment on table public.exchange_rates is
  'Tipos de cambio registrados manualmente por la organización. No provienen de una integración bancaria ni del BCP.';

-- Tipo de cambio vigente (último registrado hasta la fecha). Null si no hay.
create or replace function app.fx_rate(p_org uuid, p_from text, p_to text, p_date date)
returns numeric
language sql stable
set search_path = public, pg_temp
as $$
  select case
    when p_from = p_to then 1::numeric
    else coalesce(
      (select rate from public.exchange_rates
        where org_id = p_org and from_currency = p_from and to_currency = p_to and rate_date <= p_date
        order by rate_date desc limit 1),
      (select 1 / rate from public.exchange_rates
        where org_id = p_org and from_currency = p_to and to_currency = p_from and rate_date <= p_date
        order by rate_date desc limit 1))
  end
$$;

-- -----------------------------------------------------------------------------
-- Configuración de la organización
-- -----------------------------------------------------------------------------
create table public.org_settings (
  org_id                         uuid primary key references public.organizations(id) on delete cascade,
  max_discount_pct_without_approval numeric(5,2) not null default 3.00 check (max_discount_pct_without_approval between 0 and 100),
  reservation_default_days       integer not null default 7 check (reservation_default_days between 1 and 90),
  aging_alert_days               integer not null default 90 check (aging_alert_days > 0),
  proposal_validity_days         integer not null default 7 check (proposal_validity_days between 1 and 60),
  payables_due_soon_days         integer not null default 7 check (payables_due_soon_days between 1 and 60),
  default_rate_convention        text not null default 'nominal_annual'
                                 check (default_rate_convention in ('nominal_annual','effective_annual','monthly')),
  updated_at                     timestamptz not null default now()
);

create table public.aging_buckets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  label      text not null,
  min_days   integer not null check (min_days >= 0),
  max_days   integer check (max_days is null or max_days >= min_days),
  sort_order smallint not null,
  unique (org_id, sort_order)
);
comment on table public.aging_buckets is 'Tramos de mora configurables. min_days=0 representa "al día".';

-- Crea configuración y tramos por defecto al crear una organización.
create or replace function app.init_org_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_settings (org_id) values (new.id);
  insert into public.aging_buckets (org_id, label, min_days, max_days, sort_order) values
    (new.id, 'Al día',        0,  0,   1),
    (new.id, '1–30 días',     1,  30,  2),
    (new.id, '31–60 días',    31, 60,  3),
    (new.id, '61–90 días',    61, 90,  4),
    (new.id, 'Más de 90 días',91, null,5);
  return new;
end $$;

create trigger organizations_defaults after insert on public.organizations
  for each row execute function app.init_org_defaults();

create trigger org_settings_audit after update on public.org_settings
  for each row execute function app.audit_row();
