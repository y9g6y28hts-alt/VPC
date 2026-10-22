-- =============================================================================
-- Da Silva OS — Row Level Security y privilegios
--
-- Defensa en profundidad:
--   1. El servidor verifica permisos antes de cada acción.
--   2. Las RPC verifican permisos de nuevo (app.require_perm).
--   3. RLS impide leer o escribir filas sin permiso aunque se acceda
--      directamente a la API de datos de Supabase con el JWT del usuario.
--   4. anon no tiene ningún privilegio.
-- =============================================================================

-- Privilegios base ------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all functions in schema app from public;

grant usage on schema public to authenticated, service_role;
grant usage on schema app to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- Las tablas append-only no admiten UPDATE/DELETE ni siquiera con RLS.
revoke update, delete on public.audit_events, public.vehicle_status_events, public.deal_events,
  public.contract_ledger_entries, public.payment_allocations, public.payment_reversals,
  public.collection_actions, public.contract_versions, public.proposals,
  public.opportunity_stage_events from authenticated;
-- Tablas que sólo escriben las funciones transaccionales.
revoke insert, update, delete on public.contracts, public.financing_plans, public.installments,
  public.customer_payments, public.payment_allocations, public.payment_reversals, public.contract_ledger_entries,
  public.cash_movements, public.reconciliations, public.reservations, public.approvals,
  public.supplier_payments, public.contract_versions, public.document_sequences, public.audit_events,
  public.vehicle_status_events, public.deal_events, public.opportunity_stage_events
  from authenticated;
revoke delete on all tables in schema public from authenticated;
grant delete on public.vehicle_photos, public.appraisal_inspections, public.documents to authenticated;

-- Habilitar RLS en todas las tablas ------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Catálogos globales (lectura para usuarios autenticados) ----------------------
create policy currencies_read on public.currencies for select to authenticated using (true);
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- Organización y usuarios ------------------------------------------------------
create policy organizations_read on public.organizations for select to authenticated using (app.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_perm(id, 'settings.manage')) with check (app.has_perm(id, 'settings.manage'));

create policy branches_read on public.branches for select to authenticated using (app.is_member(org_id));
create policy branches_write on public.branches for insert to authenticated with check (app.has_perm(org_id, 'settings.manage'));
create policy branches_update on public.branches for update to authenticated
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create or replace function app.shares_org(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid() and a.is_active and b.user_id = p_user
  )
$$;

create policy user_profiles_read on public.user_profiles for select to authenticated
  using (id = auth.uid() or app.shares_org(id));
create policy user_profiles_update_self on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_read on public.memberships for select to authenticated using (app.is_member(org_id));
create policy memberships_insert on public.memberships for insert to authenticated with check (app.has_perm(org_id, 'users.manage'));
create policy memberships_update on public.memberships for update to authenticated
  using (app.has_perm(org_id, 'users.manage')) with check (app.has_perm(org_id, 'users.manage'));

-- Un usuario no puede cambiarse su propio rol ni desactivarse a sí mismo.
create or replace function app.memberships_guard()
returns trigger language plpgsql as $$
begin
  if not app.is_trusted() and new.user_id = auth.uid() and
     (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'No puede modificar su propio rol o estado' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger memberships_guard before update on public.memberships
  for each row execute function app.memberships_guard();

create policy audit_read on public.audit_events for select to authenticated using (app.has_perm(org_id, 'audit.view'));

create policy exchange_rates_read on public.exchange_rates for select to authenticated using (app.is_member(org_id));
create policy exchange_rates_insert on public.exchange_rates for insert to authenticated
  with check (app.has_perm(org_id, 'settings.manage') or app.has_perm(org_id, 'cash.reconcile'));

create policy org_settings_read on public.org_settings for select to authenticated using (app.is_member(org_id));
create policy org_settings_update on public.org_settings for update to authenticated
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create policy aging_buckets_read on public.aging_buckets for select to authenticated using (app.is_member(org_id));
create policy aging_buckets_write on public.aging_buckets for update to authenticated
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create policy document_sequences_none on public.document_sequences for select to authenticated using (false);

-- Inventario -------------------------------------------------------------------
create policy brands_read on public.brands for select to authenticated using (app.is_member(org_id));
create policy brands_insert on public.brands for insert to authenticated with check (app.has_perm(org_id, 'settings.manage'));
create policy brands_update on public.brands for update to authenticated
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create policy categories_read on public.vehicle_categories for select to authenticated using (app.is_member(org_id));
create policy categories_insert on public.vehicle_categories for insert to authenticated with check (app.has_perm(org_id, 'settings.manage'));

create policy vehicles_read on public.vehicles for select to authenticated using (app.has_perm(org_id, 'inventory.view'));
-- Cobranzas/finanzas ven las unidades vinculadas a contratos (no todo el inventario).
create policy vehicles_read_contracted on public.vehicles for select to authenticated
  using ((app.has_perm(org_id, 'contracts.view') or app.has_perm(org_id, 'collections.view'))
         and exists (select 1 from public.contracts k where k.vehicle_id = vehicles.id));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (app.has_perm(org_id, 'inventory.create') and commercial_status = 'disponible' and contract_status = 'sin_contrato');
create policy vehicles_update on public.vehicles for update to authenticated
  using (app.has_perm(org_id, 'inventory.edit') or app.has_perm(org_id, 'inventory.pricing.edit'))
  with check (app.has_perm(org_id, 'inventory.edit') or app.has_perm(org_id, 'inventory.pricing.edit'));

create policy vehicle_status_events_read on public.vehicle_status_events for select to authenticated
  using (app.has_perm(org_id, 'inventory.view'));

create policy vehicle_costs_read on public.vehicle_costs for select to authenticated
  using (app.has_perm(org_id, 'inventory.costs.view'));
create policy vehicle_costs_insert on public.vehicle_costs for insert to authenticated
  with check (app.has_perm(org_id, 'inventory.costs.create'));
create policy vehicle_costs_update on public.vehicle_costs for update to authenticated
  using (app.has_perm(org_id, 'inventory.costs.edit_history')) with check (app.has_perm(org_id, 'inventory.costs.edit_history'));

create policy document_types_read on public.document_types for select to authenticated using (app.is_member(org_id));
create policy document_types_write on public.document_types for insert to authenticated with check (app.has_perm(org_id, 'settings.manage'));

-- Lectura de documentos: según el módulo de la entidad; restringidos requieren permiso extra.
create or replace function app.can_read_entity(p_org uuid, p_entity_type text)
returns boolean language sql stable as $$
  select case p_entity_type
    when 'vehicle'          then app.has_perm(p_org, 'inventory.view')
    when 'customer'         then app.has_perm(p_org, 'customers.view') or app.has_perm(p_org, 'customers.view_all')
    when 'deal'             then app.has_perm(p_org, 'deals.view') or app.has_perm(p_org, 'deals.view_all')
    when 'contract'         then app.has_perm(p_org, 'contracts.view')
    when 'payment'          then app.has_perm(p_org, 'payments.view')
    when 'supplier_invoice' then app.has_perm(p_org, 'payables.view')
    when 'trade_in'         then app.has_perm(p_org, 'tradein.view')
    when 'expense'          then app.has_perm(p_org, 'expenses.view')
    when 'cash_movement'    then app.has_perm(p_org, 'cash.view')
    else false end
$$;

create or replace function app.can_write_entity(p_org uuid, p_entity_type text)
returns boolean language sql stable as $$
  select case p_entity_type
    when 'vehicle'          then app.has_perm(p_org, 'inventory.edit') or app.has_perm(p_org, 'inventory.create')
    when 'customer'         then app.has_perm(p_org, 'customers.edit')
    when 'deal'             then app.has_perm(p_org, 'deals.create') or app.has_perm(p_org, 'deals.formalize')
    when 'contract'         then app.has_perm(p_org, 'deals.formalize') or app.has_perm(p_org, 'contracts.adjust')
    when 'payment'          then app.has_perm(p_org, 'payments.register')
    when 'supplier_invoice' then app.has_perm(p_org, 'payables.create')
    when 'trade_in'         then app.has_perm(p_org, 'tradein.create')
    when 'expense'          then app.has_perm(p_org, 'expenses.create')
    when 'cash_movement'    then app.has_perm(p_org, 'cash.register')
    else false end
$$;

create policy documents_read on public.documents for select to authenticated
  using (app.can_read_entity(org_id, entity_type)
         and (not is_restricted or app.has_perm(org_id, 'documents.view_restricted')));
create policy documents_insert on public.documents for insert to authenticated
  with check (app.can_write_entity(org_id, entity_type) and uploaded_by = auth.uid());
create policy documents_delete on public.documents for delete to authenticated
  using (uploaded_by = auth.uid() and uploaded_at > now() - interval '1 hour' and app.can_write_entity(org_id, entity_type));

create policy vehicle_documents_read on public.vehicle_documents for select to authenticated using (app.has_perm(org_id, 'inventory.view'));
create policy vehicle_documents_insert on public.vehicle_documents for insert to authenticated with check (app.has_perm(org_id, 'inventory.edit'));
create policy vehicle_documents_update on public.vehicle_documents for update to authenticated
  using (app.has_perm(org_id, 'inventory.edit')) with check (app.has_perm(org_id, 'inventory.edit'));

create policy vehicle_photos_read on public.vehicle_photos for select to authenticated using (app.has_perm(org_id, 'inventory.view'));
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated with check (app.has_perm(org_id, 'inventory.edit'));
create policy vehicle_photos_update on public.vehicle_photos for update to authenticated
  using (app.has_perm(org_id, 'inventory.edit')) with check (app.has_perm(org_id, 'inventory.edit'));
create policy vehicle_photos_delete on public.vehicle_photos for delete to authenticated using (app.has_perm(org_id, 'inventory.edit'));

create policy suppliers_read on public.suppliers for select to authenticated
  using (app.has_perm(org_id, 'suppliers.view') or app.has_perm(org_id, 'inventory.costs.view'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (app.has_perm(org_id, 'suppliers.manage'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (app.has_perm(org_id, 'suppliers.manage')) with check (app.has_perm(org_id, 'suppliers.manage'));

-- Clientes y CRM ---------------------------------------------------------------
create policy customers_read on public.customers for select to authenticated
  using (app.can_see_customer(org_id, assigned_seller_id, created_by));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_perm(org_id, 'customers.create') and created_by = auth.uid());
create policy customers_update on public.customers for update to authenticated
  using (app.has_perm(org_id, 'customers.edit') and app.can_see_customer(org_id, assigned_seller_id, created_by))
  with check (app.has_perm(org_id, 'customers.edit')
              and (app.has_perm(org_id, 'customers.view_all') or assigned_seller_id = auth.uid() or assigned_seller_id is null));

-- Sólo quien gestiona cobranzas reasigna el responsable de cobranza.
create or replace function app.customers_guard()
returns trigger language plpgsql as $$
begin
  if not app.is_trusted() and new.collector_id is distinct from old.collector_id
     and not app.has_perm(new.org_id, 'collections.assign') then
    raise exception 'No tiene permiso para asignar responsables de cobranza' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger customers_guard before update on public.customers
  for each row execute function app.customers_guard();

create policy customer_interactions_read on public.customer_interactions for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));
create policy customer_interactions_insert on public.customer_interactions for insert to authenticated
  with check (user_id = auth.uid() and (app.has_perm(org_id, 'crm.manage') or app.has_perm(org_id, 'collections.manage'))
              and exists (select 1 from public.customers c where c.id = customer_id));

create policy leads_read on public.leads for select to authenticated
  using (app.has_perm(org_id, 'customers.view_all') or (app.has_perm(org_id, 'crm.manage') and (assigned_to = auth.uid() or created_by = auth.uid() or assigned_to is null)));
create policy leads_insert on public.leads for insert to authenticated with check (app.has_perm(org_id, 'crm.manage'));
create policy leads_update on public.leads for update to authenticated
  using (app.has_perm(org_id, 'crm.manage')) with check (app.has_perm(org_id, 'crm.manage'));

create policy pipeline_stages_read on public.pipeline_stages for select to authenticated using (app.is_member(org_id));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

create policy opportunities_read on public.opportunities for select to authenticated
  using (app.has_perm(org_id, 'customers.view_all') or (app.has_perm(org_id, 'crm.manage') and seller_id = auth.uid()));
create policy opportunities_insert on public.opportunities for insert to authenticated with check (app.has_perm(org_id, 'crm.manage'));
create policy opportunities_update on public.opportunities for update to authenticated
  using (app.has_perm(org_id, 'crm.manage') and (app.has_perm(org_id, 'customers.view_all') or seller_id = auth.uid()))
  with check (app.has_perm(org_id, 'crm.manage'));

create policy opportunity_stage_events_read on public.opportunity_stage_events for select to authenticated
  using (exists (select 1 from public.opportunities o where o.id = opportunity_id));

-- Aprobaciones: visibles para quien puede decidir su tipo o quien las solicitó.
create policy approvals_read on public.approvals for select to authenticated
  using (requested_by = auth.uid() or app.has_perm(org_id, app.approval_permission(kind)) or app.has_perm(org_id, 'audit.view'));

-- Tasaciones -------------------------------------------------------------------
create policy trade_in_read on public.trade_in_appraisals for select to authenticated using (app.has_perm(org_id, 'tradein.view'));
create policy trade_in_insert on public.trade_in_appraisals for insert to authenticated
  with check (app.has_perm(org_id, 'tradein.create') and status = 'borrador' and created_by = auth.uid());
create policy trade_in_update on public.trade_in_appraisals for update to authenticated
  using (app.has_perm(org_id, 'tradein.create') and status in ('borrador','rechazada'))
  with check (status in ('borrador','rechazada'));

create policy appraisal_inspections_read on public.appraisal_inspections for select to authenticated using (app.has_perm(org_id, 'tradein.view'));
create policy appraisal_inspections_write on public.appraisal_inspections for insert to authenticated
  with check (app.has_perm(org_id, 'tradein.create')
              and exists (select 1 from public.trade_in_appraisals t where t.id = appraisal_id and t.status in ('borrador','rechazada')));
create policy appraisal_inspections_update on public.appraisal_inspections for update to authenticated
  using (app.has_perm(org_id, 'tradein.create')
         and exists (select 1 from public.trade_in_appraisals t where t.id = appraisal_id and t.status in ('borrador','rechazada')))
  with check (app.has_perm(org_id, 'tradein.create'));
create policy appraisal_inspections_delete on public.appraisal_inspections for delete to authenticated
  using (app.has_perm(org_id, 'tradein.create')
         and exists (select 1 from public.trade_in_appraisals t where t.id = appraisal_id and t.status in ('borrador','rechazada')));

-- Ventas -----------------------------------------------------------------------
create policy deals_read on public.deals for select to authenticated using (app.can_see_deal(org_id, seller_id));
create policy deals_insert on public.deals for insert to authenticated
  with check (app.has_perm(org_id, 'deals.create') and status = 'borrador'
              and (seller_id = auth.uid() or app.has_perm(org_id, 'deals.view_all')));
create policy deals_update on public.deals for update to authenticated
  using (app.has_perm(org_id, 'deals.create') and app.can_see_deal(org_id, seller_id))
  with check (app.has_perm(org_id, 'deals.create') and (seller_id = auth.uid() or app.has_perm(org_id, 'deals.view_all')));

create policy deal_events_read on public.deal_events for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id));

create policy reservations_read on public.reservations for select to authenticated
  using (app.has_perm(org_id, 'inventory.view'));

create policy proposals_read on public.proposals for select to authenticated
  using (created_by = auth.uid() or app.has_perm(org_id, 'deals.view_all'));
create policy proposals_insert on public.proposals for insert to authenticated
  with check (app.has_perm(org_id, 'deals.create') and created_by = auth.uid());
grant insert on public.proposals to authenticated;

-- Contratos, cuotas y cobros (sólo lectura directa) -----------------------------
create policy contracts_read on public.contracts for select to authenticated
  using (app.has_perm(org_id, 'contracts.view') or app.has_perm(org_id, 'collections.view'));
create policy contract_versions_read on public.contract_versions for select to authenticated
  using (app.has_perm(org_id, 'contracts.view'));
create policy financing_plans_read on public.financing_plans for select to authenticated
  using (app.has_perm(org_id, 'contracts.view'));
create policy installments_read on public.installments for select to authenticated
  using (app.has_perm(org_id, 'contracts.view') or app.has_perm(org_id, 'collections.view'));
create policy customer_payments_read on public.customer_payments for select to authenticated
  using (app.has_perm(org_id, 'payments.view'));
create policy payment_allocations_read on public.payment_allocations for select to authenticated
  using (app.has_perm(org_id, 'payments.view') or app.has_perm(org_id, 'collections.view'));
create policy payment_reversals_read on public.payment_reversals for select to authenticated
  using (app.has_perm(org_id, 'payments.view'));
create policy contract_ledger_read on public.contract_ledger_entries for select to authenticated
  using (app.has_perm(org_id, 'contracts.view') or app.has_perm(org_id, 'collections.view'));

create policy collection_actions_read on public.collection_actions for select to authenticated
  using (app.has_perm(org_id, 'collections.view'));
create policy collection_actions_insert on public.collection_actions for insert to authenticated
  with check (app.has_perm(org_id, 'collections.manage') and user_id = auth.uid());
grant insert on public.collection_actions to authenticated;

-- Proveedores, gastos y caja ----------------------------------------------------
create policy supplier_invoices_read on public.supplier_invoices for select to authenticated
  using (app.has_perm(org_id, 'payables.view'));
create policy supplier_payments_read on public.supplier_payments for select to authenticated
  using (app.has_perm(org_id, 'payables.view'));
revoke insert, update on public.supplier_invoices from authenticated;

create policy expenses_read on public.expenses for select to authenticated using (app.has_perm(org_id, 'expenses.view'));
revoke insert, update on public.expenses from authenticated;

create policy cash_accounts_read on public.cash_accounts for select to authenticated
  using (app.has_perm(org_id, 'cash.view') or app.has_perm(org_id, 'payments.register') or app.has_perm(org_id, 'payables.pay'));
create policy cash_accounts_insert on public.cash_accounts for insert to authenticated
  with check (app.has_perm(org_id, 'settings.manage') or app.has_perm(org_id, 'cash.reconcile'));
create policy cash_accounts_update on public.cash_accounts for update to authenticated
  using (app.has_perm(org_id, 'settings.manage') or app.has_perm(org_id, 'cash.reconcile'))
  with check (app.has_perm(org_id, 'settings.manage') or app.has_perm(org_id, 'cash.reconcile'));

create policy cash_movements_read on public.cash_movements for select to authenticated using (app.has_perm(org_id, 'cash.view'));
create policy reconciliations_read on public.reconciliations for select to authenticated using (app.has_perm(org_id, 'cash.view'));

-- Vistas: lectura (aplican el RLS de las tablas base por security_invoker) -------
grant select on public.v_installment_balances, public.v_contract_balances, public.v_payment_promises,
  public.v_vehicle_economics, public.v_supplier_invoice_balances, public.v_cash_account_balances to authenticated;
revoke all on public.v_installment_balances, public.v_contract_balances, public.v_payment_promises,
  public.v_vehicle_economics, public.v_supplier_invoice_balances, public.v_cash_account_balances from anon;
