-- =============================================================================
-- SÓLO PRUEBAS: sustituto mínimo del esquema auth de Supabase cuando no se
-- ejecuta Supabase Auth (GoTrue). Reproduce auth.users y auth.uid() con la
-- misma lectura de claims JWT que usa Supabase.
-- =============================================================================
create table if not exists auth.users (
  id          uuid primary key,
  email       text unique,
  created_at  timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant select on auth.users to service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
