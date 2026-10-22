-- =============================================================================
-- SÓLO DESARROLLO LOCAL / PRUEBAS. En Supabase estos roles y esquemas ya existen.
-- Reproduce los roles de Supabase para que RLS se comporte igual que en producción.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole password 'auth_dev_only';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dasilva_app') then
    -- Rol con el que se conecta el servidor Next.js en local. No es superusuario
    -- ni BYPASSRLS: para operar como usuario hace SET LOCAL ROLE authenticated.
    create role dasilva_app login password 'dasilva_app_dev_only';
  end if;
end $$;

grant anon, authenticated, service_role to dasilva_app;

create schema if not exists auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role, dasilva_app;
grant create on database current_database_placeholder to supabase_auth_admin;
