-- =============================================================================
-- Motor Haus · 0001 Fundamentos
-- Organizaciones, usuarios, roles, permisos, políticas, auditoría y numeración.
-- Compatible con Supabase (auth.users, auth.uid()).
-- Convención de errores: RAISE con mensaje 'MH_<CLASE>: <texto>'
--   MH_FORBIDDEN · MH_NOT_FOUND · MH_CONFLICT · MH_VALIDATION · MH_STATE
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Utilidades genéricas
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Identificador de operación: lo fija el gateway por request (app.op_id);
-- si no existe se deriva de la transacción, de modo que todos los eventos de
-- una misma transacción comparten identificador.
create or replace function app.op_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('app.op_id', true), '')::uuid,
    md5('tx:' || txid_current()::text)::uuid
  )
$$;

-- -----------------------------------------------------------------------------
-- Monedas
-- -----------------------------------------------------------------------------
create table public.currencies (
  code        char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name        text not null,
  minor_units smallint not null check (minor_units between 0 and 4),
  symbol      text not null
);

insert into public.currencies (code, name, minor_units, symbol) values
  ('USD', 'Dólar estadounidense', 2, 'US$'),
  ('PYG', 'Guaraní paraguayo', 0, '₲'),
  ('EUR', 'Euro', 2, '€'),
  ('BRL', 'Real brasileño', 2, 'R$'),
  ('ARS', 'Peso argentino', 2, 'AR$');

create or replace function app.round_money(p_amount numeric, p_currency char(3))
returns numeric
language sql stable as $$
  select round(p_amount, (select minor_units from public.currencies where code = p_currency))
$$;

-- -----------------------------------------------------------------------------
-- Organización
-- -----------------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  legal_name       text,
  tax_id           text,
  address          text,
  phone            text,
  email            text,
  default_currency char(3) not null references public.currencies(code),
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on column public.organizations.is_demo is
  'Cuando es true la interfaz muestra de forma permanente que los datos son de demostración.';
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

create table public.branches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code            text not null,
  name            text not null,
  address         text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

-- -----------------------------------------------------------------------------
-- Usuarios, roles y permisos
-- -----------------------------------------------------------------------------
create table public.user_profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_profiles_touch before update on public.user_profiles
  for each row execute function app.touch_updated_at();

create or replace function app.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_.]+$'),
  description text not null
);

create table public.roles (
  code        text primary key,
  name        text not null,
  description text not null,
  sort_order  int not null default 100
);

create table public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.user_profiles(id) on delete cascade,
  role_code       text not null references public.roles(code),
  branch_id       uuid,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  unique (organization_id, user_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);
create index memberships_user_idx on public.memberships(user_id) where active;

insert into public.permissions (code, description) values
  ('org.read',               'Ver datos generales de la organización'),
  ('inventory.read',         'Ver inventario y fichas de unidades'),
  ('inventory.write',        'Crear y editar fichas de unidades'),
  ('inventory.cost.read',    'Ver costes de adquisición y capital invertido'),
  ('inventory.cost.write',   'Registrar y anular costes de unidades'),
  ('inventory.price.write',  'Modificar precios de lista, mínimo y oferta'),
  ('inventory.status.write', 'Cambiar estados logísticos, de preparación y comerciales'),
  ('inventory.count',        'Registrar conteos físicos de inventario'),
  ('import.read',            'Ver importaciones y logística'),
  ('import.write',           'Gestionar órdenes de compra, embarques y recepciones'),
  ('service.read',           'Ver preparación y servicio'),
  ('service.write',          'Gestionar órdenes de servicio y tareas de preparación'),
  ('customer.read',          'Ver expedientes de clientes (sin datos sensibles)'),
  ('customer.write',         'Crear y editar clientes e interacciones'),
  ('customer.pii.read',      'Ver documentos de identidad y datos sensibles del cliente'),
  ('deal.read',              'Ver todas las negociaciones'),
  ('deal.read_own',          'Ver negociaciones propias'),
  ('deal.write',             'Crear y editar negociaciones'),
  ('deal.approve',           'Aprobar excepciones comerciales'),
  ('deal.formalize',         'Formalizar operaciones y generar obligaciones'),
  ('deal.cancel',            'Cancelar negociaciones y contratos'),
  ('deal.deliver',           'Registrar la entrega de unidades vendidas'),
  ('reservation.write',      'Crear y liberar reservas'),
  ('tradein.read',           'Ver tasaciones'),
  ('tradein.write',          'Registrar y valorar tasaciones'),
  ('tradein.approve',        'Aprobar tasaciones fuera de límites'),
  ('tradein.acquire',        'Incorporar unidades de parte de pago al inventario'),
  ('receivable.read',        'Ver toda la cartera de cuentas por cobrar'),
  ('receivable.read_own',    'Ver cuentas por cobrar de operaciones propias'),
  ('receivable.adjust',      'Registrar notas de crédito, recargos y ajustes'),
  ('collections.write',      'Registrar gestiones de cobranza y compromisos'),
  ('payment.read',           'Ver pagos recibidos'),
  ('payment.create',         'Registrar pagos recibidos y asignarlos'),
  ('payment.confirm',        'Confirmar o rechazar pagos (conciliación)'),
  ('payment.reverse',        'Revertir pagos confirmados'),
  ('treasury.read',          'Ver caja, bancos y proyecciones'),
  ('treasury.write',         'Registrar movimientos de caja y banco'),
  ('treasury.reconcile',     'Conciliar cuentas financieras'),
  ('payable.read',           'Ver cuentas por pagar'),
  ('payable.write',          'Registrar facturas de proveedores'),
  ('payable.approve',        'Aprobar facturas de proveedores'),
  ('payable.pay',            'Registrar pagos a proveedores'),
  ('report.read',            'Ver reportes de gestión y rentabilidad'),
  ('report.export',          'Exportar datos (acción auditada)'),
  ('document.read',          'Ver y descargar documentos emitidos'),
  ('document.issue',         'Emitir documentos desde plantillas'),
  ('audit.read',             'Consultar el registro de auditoría'),
  ('admin.users',            'Administrar usuarios y roles'),
  ('admin.policies',         'Configurar umbrales y políticas'),
  ('contract.backdate',      'Formalizar con fecha efectiva anterior (migraciones de datos)');

insert into public.roles (code, name, description, sort_order) values
  ('ceo',               'Director general',          'Visión completa y aprobaciones finales', 10),
  ('cfo',               'Director financiero',       'Finanzas, tesorería, cobranzas y políticas', 20),
  ('sales_manager',     'Gerente comercial',         'Ventas, precios, aprobaciones comerciales', 30),
  ('sales_advisor',     'Asesor de ventas',          'Clientes, negociaciones y tasaciones propias', 40),
  ('collections',       'Responsable de cobranzas',  'Cartera, gestiones y registro de pagos', 50),
  ('inventory_manager', 'Responsable de inventario', 'Unidades, costes, preparación y conteos', 60),
  ('imports_manager',   'Responsable de importaciones', 'Compras, embarques, aduana y recepción', 70),
  ('auditor',           'Auditor',                   'Lectura completa y auditoría, sin modificaciones', 80),
  ('tech_admin',        'Administrador técnico',     'Usuarios y configuración, sin datos financieros', 90);

-- Matriz de permisos por rol
insert into public.role_permissions (role_code, permission_code)
select 'ceo', code from public.permissions where code <> 'contract.backdate';

insert into public.role_permissions (role_code, permission_code)
select 'cfo', code from public.permissions where code not in ('admin.users');

insert into public.role_permissions (role_code, permission_code)
select 'sales_manager', unnest(array[
  'org.read','inventory.read','inventory.write','inventory.cost.read','inventory.price.write',
  'inventory.status.write','import.read','service.read','customer.read','customer.write',
  'customer.pii.read','deal.read','deal.write','deal.approve','deal.formalize','deal.cancel',
  'deal.deliver','reservation.write','tradein.read','tradein.write','tradein.approve',
  'tradein.acquire','receivable.read','payment.read','report.read','document.read','document.issue']);

insert into public.role_permissions (role_code, permission_code)
select 'sales_advisor', unnest(array[
  'org.read','inventory.read','service.read','customer.read','customer.write','deal.read_own',
  'deal.write','reservation.write','tradein.read','tradein.write','receivable.read_own',
  'document.read','document.issue']);

insert into public.role_permissions (role_code, permission_code)
select 'collections', unnest(array[
  'org.read','inventory.read','customer.read','customer.write','customer.pii.read','deal.read',
  'receivable.read','collections.write','payment.read','payment.create','report.read',
  'document.read','document.issue']);

insert into public.role_permissions (role_code, permission_code)
select 'inventory_manager', unnest(array[
  'org.read','inventory.read','inventory.write','inventory.cost.read','inventory.cost.write',
  'inventory.status.write','inventory.count','import.read','import.write','service.read',
  'service.write','tradein.read','tradein.acquire','payable.read','document.read','deal.deliver']);

insert into public.role_permissions (role_code, permission_code)
select 'imports_manager', unnest(array[
  'org.read','inventory.read','inventory.write','inventory.cost.read','inventory.cost.write',
  'import.read','import.write','service.read','payable.read','payable.write','document.read']);

insert into public.role_permissions (role_code, permission_code)
select 'auditor', code from public.permissions
where code like '%.read' or code like '%.read_own' or code in ('audit.read');

insert into public.role_permissions (role_code, permission_code)
select 'tech_admin', unnest(array['org.read','admin.users','admin.policies','audit.read']);

-- -----------------------------------------------------------------------------
-- Funciones de autorización (se usan en RLS y en funciones transaccionales)
-- -----------------------------------------------------------------------------
create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.active
  )
$$;

create or replace function app.has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_code = m.role_code
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.active
      and rp.permission_code = p_perm
  )
$$;

create or replace function app.require_perm(p_org uuid, p_perm text) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if auth.uid() is null then
    raise exception 'MH_FORBIDDEN: sesión no autenticada' using errcode = '42501';
  end if;
  if not app.has_perm(p_org, p_perm) then
    raise exception 'MH_FORBIDDEN: se requiere el permiso %', p_perm using errcode = '42501';
  end if;
end $$;

-- Permisos efectivos del usuario actual (para que la interfaz adapte acciones;
-- la autorización real siempre se verifica en RLS y en las funciones).
create or replace function public.my_permissions(p_org uuid) returns setof text
language sql stable security definer set search_path = public, app as $$
  select rp.permission_code
  from public.memberships m
  join public.role_permissions rp on rp.role_code = m.role_code
  where m.organization_id = p_org and m.user_id = auth.uid() and m.active
$$;

-- -----------------------------------------------------------------------------
-- Políticas configurables de la organización
-- -----------------------------------------------------------------------------
create table public.org_policies (
  organization_id                      uuid primary key references public.organizations(id) on delete cascade,
  max_discount_pct                     numeric(6,3) not null default 5     check (max_discount_pct between 0 and 100),
  min_margin_pct                       numeric(6,3) not null default 8     check (min_margin_pct between -100 and 100),
  max_financing_months                 int          not null default 48    check (max_financing_months between 1 and 240),
  min_effective_annual_rate            numeric(10,6) not null default 0    check (min_effective_annual_rate >= 0),
  reservation_default_hours            int          not null default 72    check (reservation_default_hours between 1 and 720),
  reservation_max_days                 int          not null default 15    check (reservation_max_days between 1 and 90),
  reservation_expiry_alert_hours       int          not null default 48,
  stale_inventory_days                 int          not null default 120   check (stale_inventory_days > 0),
  import_delay_alert_days              int          not null default 7     check (import_delay_alert_days >= 0),
  payment_reconciliation_alert_days    int          not null default 3     check (payment_reconciliation_alert_days >= 0),
  payable_due_soon_days                int          not null default 10    check (payable_due_soon_days >= 0),
  installment_due_soon_days            int          not null default 7     check (installment_due_soon_days >= 0),
  grace_days                           int          not null default 0     check (grace_days between 0 and 60),
  due_date_roll                        text         not null default 'none' check (due_date_roll in ('none','next_business_day')),
  aging_buckets                        int[]        not null default '{30,60,90}',
  require_down_payment_before_delivery boolean      not null default true,
  require_full_payment_before_delivery boolean      not null default false,
  approval_segregation                 boolean      not null default true,
  collections_priority                 text         not null default 'overdue_amount'
                                       check (collections_priority in ('overdue_amount','days_past_due','next_due')),
  updated_at                           timestamptz  not null default now(),
  updated_by                           uuid,
  check (cardinality(aging_buckets) between 1 and 8)
);
comment on table public.org_policies is
  'Umbrales y reglas explícitas. Ninguna alerta ni aprobación se dispara sin una regla de esta tabla.';

create table public.org_holidays (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  holiday_date    date not null,
  label           text not null,
  primary key (organization_id, holiday_date)
);

-- Fecha exigible: vencimiento contractual trasladado al siguiente día hábil
-- cuando la política lo indica. El período de gracia (grace_days) se aplica
-- aparte: una cuota está vencida cuando hoy > fecha exigible + gracia, y los
-- días de atraso se cuentan desde la fecha exigible.
create or replace function app.exigible_date(p_org uuid, p_due date) returns date
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_roll text;
  v_date date := p_due;
begin
  select due_date_roll into v_roll from public.org_policies where organization_id = p_org;
  if v_roll = 'next_business_day' then
    while extract(isodow from v_date) in (6, 7)
       or exists (select 1 from public.org_holidays h
                  where h.organization_id = p_org and h.holiday_date = v_date) loop
      v_date := v_date + 1;
    end loop;
  end if;
  return v_date;
end $$;

-- -----------------------------------------------------------------------------
-- Auditoría (protegida contra modificaciones ordinarias)
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  op_id           uuid not null,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  changed_fields  text[],
  before_data     jsonb,
  after_data      jsonb,
  context         jsonb
);
create index audit_events_org_time_idx on public.audit_events(organization_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id);
create index audit_events_op_idx on public.audit_events(op_id);

create or replace function app.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'MH_FORBIDDEN: el registro de auditoría no admite modificaciones';
end $$;

create trigger audit_events_no_update before update or delete on public.audit_events
  for each row execute function app.audit_immutable();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function app.audit_immutable();

-- Evento semántico (p. ej. 'payment.reverse') emitido por funciones de negocio.
create or replace function app.audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb default null, p_after jsonb default null, p_context jsonb default null
) returns void
language sql security definer set search_path = public, app as $$
  insert into public.audit_events
    (organization_id, actor_id, op_id, action, entity_type, entity_id, before_data, after_data, context)
  values
    (p_org, auth.uid(), app.op_id(), p_action, p_entity_type, p_entity_id, p_before, p_after, p_context)
$$;

-- Trigger genérico de filas. TG_ARGV = columnas excluidas (datos sensibles).
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_excl    text[] := coalesce(tg_argv::text[], '{}') || array['updated_at'];
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[];
  v_row     jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old) - v_excl; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new) - v_excl; end if;
  if tg_op = 'UPDATE' then
    if v_before = v_after then return new; end if;
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_after) a
    where v_before -> a.key is distinct from a.value;
    -- Solo se guardan los valores modificados para mantener el registro compacto.
    select jsonb_object_agg(k, v_before -> k) into v_before from unnest(v_changed) k;
    select jsonb_object_agg(k, v_after -> k) into v_after from unnest(v_changed) k;
  end if;
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  insert into public.audit_events
    (organization_id, actor_id, op_id, action, entity_type, entity_id, changed_fields, before_data, after_data)
  values (
    (v_row ->> 'organization_id')::uuid, auth.uid(), app.op_id(), lower(tg_op), tg_table_name,
    (v_row ->> 'id')::uuid, v_changed, v_before, v_after
  );
  return coalesce(new, old);
end $$;

create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_row();
create trigger org_policies_audit after insert or update on public.org_policies
  for each row execute function app.audit_row();

-- -----------------------------------------------------------------------------
-- Numeración consistente de documentos y operaciones
-- -----------------------------------------------------------------------------
create table public.number_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null,
  year            int  not null,
  last_number     int  not null default 0,
  primary key (organization_id, kind, year)
);

-- Numeración sin huecos por transacción: la fila se bloquea hasta el commit.
create or replace function app.next_number(p_org uuid, p_kind text, p_prefix text, p_date date default current_date)
returns text
language plpgsql security definer set search_path = public, app as $$
declare
  v_year int := extract(year from p_date);
  v_n    int;
begin
  insert into public.number_sequences (organization_id, kind, year, last_number)
  values (p_org, p_kind, v_year, 1)
  on conflict (organization_id, kind, year)
  do update set last_number = public.number_sequences.last_number + 1
  returning last_number into v_n;
  return p_prefix || '-' || v_year || '-' || lpad(v_n::text, 5, '0');
end $$;
