-- =============================================================================
-- Motor Haus · Shim local de Supabase
-- -----------------------------------------------------------------------------
-- SOLO para PostgreSQL local sin Supabase. Un proyecto Supabase ya provee los
-- roles anon/authenticated/service_role, el esquema auth y auth.uid().
-- Este archivo NUNCA debe ejecutarse contra un proyecto Supabase real.
-- =============================================================================

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Sin BYPASSRLS: no se usa para eludir RLS y así funciona en Postgres gestionado sin superusuario.
    create role service_role nologin noinherit;
  end if;
  -- Rol de conexión del servidor Next.js. NOINHERIT: sin SET ROLE no tiene
  -- ningún privilegio sobre las tablas; el gateway siempre ejecuta
  -- SET LOCAL ROLE authenticated, igual que PostgREST en Supabase.
  if not exists (select 1 from pg_roles where rolname = 'mh_app') then
    create role mh_app login noinherit password 'mh_app_local_only';
  end if;
end $$;

grant authenticated to mh_app;
grant anon to mh_app;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Igual que Supabase: el sujeto proviene de los claims JWT de la transacción.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- Verificación de credenciales para el modo de autenticación local de
-- desarrollo. Supabase Auth realiza esta verificación en su propio servicio.
create schema if not exists auth_local;
revoke all on schema auth_local from public;
grant usage on schema auth_local to mh_app;

create or replace function auth_local.verify_password(p_email text, p_password text)
returns uuid
language sql stable security definer set search_path = auth, public as $$
  select u.id from auth.users u
  where lower(u.email) = lower(p_email)
    and u.encrypted_password is not null
    and u.encrypted_password = crypt(p_password, u.encrypted_password)
$$;
revoke all on function auth_local.verify_password(text, text) from public;
grant execute on function auth_local.verify_password(text, text) to mh_app;

create or replace function auth_local.create_user(p_email text, p_password text, p_name text)
returns uuid
language sql security definer set search_path = auth, public as $$
  insert into auth.users (email, encrypted_password, raw_user_meta_data)
  values (lower(p_email), crypt(p_password, gen_salt('bf', 10)), jsonb_build_object('full_name', p_name))
  on conflict (email) do update set encrypted_password = excluded.encrypted_password
  returning id
$$;
revoke all on function auth_local.create_user(text, text, text) from public;
