-- =============================================================================
-- Da Silva OS — Administración: usuarios, configuración, exportaciones
-- =============================================================================

-- Auditoría de catálogos y parámetros sensibles -------------------------------
create trigger aging_buckets_audit after insert or update or delete on public.aging_buckets
  for each row execute function app.audit_row();
create trigger exchange_rates_audit after insert or update or delete on public.exchange_rates
  for each row execute function app.audit_row();
create trigger cash_accounts_audit after insert or update on public.cash_accounts
  for each row execute function app.audit_row();
create trigger brands_audit after insert or update on public.brands
  for each row execute function app.audit_row();
create trigger branches_audit after insert or update on public.branches
  for each row execute function app.audit_row();
create trigger organizations_audit after update on public.organizations
  for each row execute function app.audit_row();

-- Moneda base: no se cambia una vez que existen importes convertidos a ella.
create or replace function app.organizations_guard()
returns trigger language plpgsql as $$
begin
  if new.base_currency is distinct from old.base_currency and not app.is_trusted()
     and (exists (select 1 from public.vehicle_costs where org_id = new.id)
          or exists (select 1 from public.deals where org_id = new.id)) then
    raise exception 'La moneda base no puede cambiarse: ya existen importes registrados en %', old.base_currency
      using errcode = '23514';
  end if;
  if new.is_demo is distinct from old.is_demo and not app.is_trusted() then
    raise exception 'El indicador de demostración no puede modificarse' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger organizations_guard before update on public.organizations
  for each row execute function app.organizations_guard();

-- Rol de director y último director ------------------------------------------
-- Sólo un director asigna o retira el rol de director, y la organización no
-- puede quedarse sin un director activo.
create or replace function app.memberships_role_guard()
returns trigger language plpgsql as $$
declare
  v_remaining integer;
begin
  if app.is_trusted() then
    return coalesce(new, old);
  end if;
  if (new.role = 'director' or (tg_op = 'UPDATE' and old.role = 'director'))
     and coalesce(app.user_role(new.org_id), '') <> 'director' then
    raise exception 'Sólo un director puede asignar o retirar el rol de director' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'director' and old.is_active
     and (new.role <> 'director' or not new.is_active) then
    select count(*) into v_remaining from public.memberships
    where org_id = old.org_id and role = 'director' and is_active and id <> old.id;
    if v_remaining = 0 then
      raise exception 'La organización debe conservar al menos un director activo' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger memberships_role_guard before insert or update on public.memberships
  for each row execute function app.memberships_role_guard();

-- Alta de miembro ---------------------------------------------------------------
-- La cuenta de acceso se crea en Supabase Auth desde el servidor (service role).
-- Esta función crea el perfil y la membresía, verificando el permiso.
create or replace function public.rpc_member_add(p_org uuid, p_user uuid, p_full_name text, p_role text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform app.require_perm(p_org, 'users.manage');
  if p_role = 'director' and coalesce(app.user_role(p_org), '') <> 'director' then
    perform app.fail('Sólo un director puede asignar el rol de director');
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    perform app.fail('La cuenta de acceso no existe');
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 then
    perform app.fail('Indique el nombre completo');
  end if;
  insert into public.user_profiles (id, full_name) values (p_user, trim(p_full_name))
  on conflict (id) do nothing;
  insert into public.memberships (org_id, user_id, role) values (p_org, p_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role, is_active = true
  returning id into v_id;
  perform app.audit(p_org, 'usuario_alta', 'membership', v_id::text,
                    'Alta de ' || trim(p_full_name) || ' con rol ' || p_role, null, null);
  return v_id;
end $$;

-- Registro de exportaciones ---------------------------------------------------
create or replace function public.rpc_report_export_log(p_org uuid, p_report text, p_filters jsonb, p_rows integer)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform app.require_perm(p_org, 'reports.export');
  perform app.audit(p_org, 'reporte_exportado', 'report', p_report,
                    'Exportación de «' || p_report || '» (' || p_rows || ' filas)', null, p_filters);
end $$;

-- Configuración de la organización: actualización atómica de tramos ----------
create or replace function public.rpc_aging_buckets_set(p_org uuid, p_limits integer[])
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  i integer;
  v_prev integer := 0;
  v_n integer := coalesce(array_length(p_limits, 1), 0);
begin
  perform app.require_perm(p_org, 'settings.manage');
  if v_n < 1 or v_n > 8 then
    perform app.fail('Defina entre 1 y 8 límites de tramo');
  end if;
  for i in 1 .. v_n loop
    if p_limits[i] is null or p_limits[i] <= v_prev then
      perform app.fail('Los límites deben ser crecientes y mayores que cero');
    end if;
    v_prev := p_limits[i];
  end loop;
  delete from public.aging_buckets where org_id = p_org;
  insert into public.aging_buckets (org_id, label, min_days, max_days, sort_order) values (p_org, 'Al día', 0, 0, 1);
  v_prev := 0;
  for i in 1 .. v_n loop
    insert into public.aging_buckets (org_id, label, min_days, max_days, sort_order)
    values (p_org, (v_prev + 1) || '–' || p_limits[i] || ' días', v_prev + 1, p_limits[i], i + 1);
    v_prev := p_limits[i];
  end loop;
  insert into public.aging_buckets (org_id, label, min_days, max_days, sort_order)
  values (p_org, 'Más de ' || v_prev || ' días', v_prev + 1, null, v_n + 2);
end $$;

revoke all on function public.rpc_member_add(uuid, uuid, text, text) from public, anon;
revoke all on function public.rpc_report_export_log(uuid, text, jsonb, integer) from public, anon;
revoke all on function public.rpc_aging_buckets_set(uuid, integer[]) from public, anon;
grant execute on function public.rpc_member_add(uuid, uuid, text, text) to authenticated;
grant execute on function public.rpc_report_export_log(uuid, text, jsonb, integer) to authenticated;
grant execute on function public.rpc_aging_buckets_set(uuid, integer[]) to authenticated;

-- Tipos de documento: marcar o desmarcar como obligatorio.
create policy document_types_update on public.document_types for update to authenticated
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));
create trigger document_types_audit after insert or update on public.document_types
  for each row execute function app.audit_row();

-- Correos de los miembros (auth.users no es legible por usuarios autenticados).
create or replace function public.rpc_member_emails(p_org uuid)
returns table (user_id uuid, email text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform app.require_perm(p_org, 'users.manage');
  return query select m.user_id, u.email::text from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = p_org;
end $$;
revoke all on function public.rpc_member_emails(uuid) from public, anon;
grant execute on function public.rpc_member_emails(uuid) to authenticated;
