-- =============================================================================
-- Motor Haus · 0017 Row Level Security y privilegios
-- Principio: lectura filtrada por permisos; escrituras financieras y de estado
-- solo mediante funciones SECURITY DEFINER que verifican permisos y estado.
-- Ocultar un botón en la interfaz no es una política de seguridad: esto sí.
-- =============================================================================

-- Habilitar RLS en todas las tablas del esquema público
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Privilegios base: nada para anon; lectura para authenticated (filtrada por RLS)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon;
grant usage on schema public to authenticated;

grant select on all tables in schema public to authenticated;
revoke select on public.number_sequences from authenticated;

-- Datos personales del cliente: privilegios de columna.
revoke select on public.customers from authenticated;
grant select (id, organization_id, kind, display_name, legal_name, document_type, email, phone, city, country,
              preferences, tags, owner_user_id, status, notes, created_at, updated_at, created_by)
  on public.customers to authenticated;
grant insert (organization_id, kind, display_name, legal_name, email, phone, city, country, preferences, tags,
              owner_user_id, status, notes, created_by)
  on public.customers to authenticated;
grant update (kind, display_name, legal_name, email, phone, city, country, preferences, tags, owner_user_id, status, notes)
  on public.customers to authenticated;

-- Escrituras directas permitidas (protegidas por RLS y triggers de guarda)
grant update (category, make, model, version, year_built, model_year, usage_value, usage_unit, exterior_color,
              interior_color, equipment, origin_country, description, responsible_user_id, branch_id, stock_number)
  on public.units to authenticated;
grant insert, delete on public.unit_identifiers to authenticated;
grant insert, update, delete on public.unit_media to authenticated;
grant insert on public.unit_documents to authenticated;
grant insert, update on public.locations to authenticated;
grant insert, update on public.suppliers to authenticated;
grant insert, update on public.purchase_orders to authenticated;
grant insert, update, delete on public.purchase_order_lines to authenticated;
grant insert, update on public.shipments to authenticated;
grant insert, delete on public.shipment_units to authenticated;
grant insert, update on public.import_events to authenticated;
grant insert on public.customer_interactions to authenticated;
grant insert, update on public.leads to authenticated;
grant insert, update on public.sales_opportunities to authenticated;
grant update (history_notes, inspection_notes, inspector_report, version, usage_value, identifier_kind, identifier_value, category)
  on public.trade_in_appraisals to authenticated;
grant insert, update on public.service_orders to authenticated;
grant insert on public.inspections to authenticated;
grant insert on public.preparation_tasks to authenticated;
grant insert (organization_id, name, kind, currency, bank_name, account_number_masked, opening_balance, opening_date)
  on public.cash_accounts to authenticated;
grant update (name, active, bank_name, account_number_masked) on public.cash_accounts to authenticated;
grant insert on public.exchange_rates to authenticated;
grant update on public.org_policies to authenticated;
grant update (include_in_inventory_cost, label, sort_order) on public.cost_concepts to authenticated;
grant insert, delete on public.org_holidays to authenticated;
grant insert, update, delete on public.sales_targets to authenticated;
grant update (full_name, title) on public.user_profiles to authenticated;
grant update (name, legal_name, tax_id, address, phone, email) on public.organizations to authenticated;

-- Funciones expuestas (RPC) y auxiliares usadas por RLS/vistas
grant execute on all functions in schema public to authenticated;
grant execute on function app.uid(), app.is_member(uuid), app.has_perm(uuid, text), app.today(),
  app.exigible_date(uuid, date), app.unit_display_status(text, text, text, text), app.round_money(numeric, char),
  app.can_read_deal(uuid, uuid), app.can_read_contract(uuid), app.can_read_receivables_of_contract(uuid),
  app.can_read_entity(text, uuid), app.deal_economics(uuid), app.op_id(), app.is_direct_client()
  to authenticated;

-- -----------------------------------------------------------------------------
-- Catálogos globales
-- -----------------------------------------------------------------------------
create policy currencies_read on public.currencies for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy roles_read on public.roles for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Organización y configuración
-- -----------------------------------------------------------------------------
create policy organizations_read on public.organizations for select to authenticated using (app.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_perm(id, 'admin.policies')) with check (app.has_perm(id, 'admin.policies'));

create policy user_profiles_read on public.user_profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.memberships m1 join public.memberships m2 on m2.organization_id = m1.organization_id
    where m1.user_id = auth.uid() and m1.active and m2.user_id = user_profiles.id));
create policy user_profiles_update_self on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_read on public.memberships for select to authenticated using (app.is_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array['branches','cost_concepts','status_transitions','unit_document_requirements',
                           'preparation_templates','org_holidays','org_policies','document_templates'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (app.is_member(organization_id))', t);
  end loop;
end $$;
create policy org_policies_update on public.org_policies for update to authenticated
  using (app.has_perm(organization_id, 'admin.policies')) with check (app.has_perm(organization_id, 'admin.policies'));
create policy cost_concepts_update on public.cost_concepts for update to authenticated
  using (app.has_perm(organization_id, 'admin.policies')) with check (app.has_perm(organization_id, 'admin.policies'));
create policy org_holidays_write on public.org_holidays for insert to authenticated
  with check (app.has_perm(organization_id, 'admin.policies'));
create policy org_holidays_delete on public.org_holidays for delete to authenticated
  using (app.has_perm(organization_id, 'admin.policies'));

-- -----------------------------------------------------------------------------
-- Inventario
-- -----------------------------------------------------------------------------
create policy locations_read on public.locations for select to authenticated using (app.is_member(organization_id));
create policy locations_write on public.locations for insert to authenticated with check (app.has_perm(organization_id, 'inventory.write'));
create policy locations_update on public.locations for update to authenticated
  using (app.has_perm(organization_id, 'inventory.write')) with check (app.has_perm(organization_id, 'inventory.write'));

create policy units_read on public.units for select to authenticated using (app.has_perm(organization_id, 'inventory.read'));
create policy units_update on public.units for update to authenticated
  using (app.has_perm(organization_id, 'inventory.write')) with check (app.has_perm(organization_id, 'inventory.write'));

do $$
declare t text;
begin
  foreach t in array array['unit_identifiers','unit_media','unit_status_events','unit_price_history',
                           'unit_locations','unit_documents','physical_counts'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (app.has_perm(organization_id, ''inventory.read''))', t);
  end loop;
end $$;
create policy unit_identifiers_insert on public.unit_identifiers for insert to authenticated
  with check (app.has_perm(organization_id, 'inventory.write'));
create policy unit_identifiers_delete on public.unit_identifiers for delete to authenticated
  using (app.has_perm(organization_id, 'inventory.write'));
create policy unit_media_write on public.unit_media for all to authenticated
  using (app.has_perm(organization_id, 'inventory.write')) with check (app.has_perm(organization_id, 'inventory.write'));
create policy unit_documents_insert on public.unit_documents for insert to authenticated
  with check (app.has_perm(organization_id, 'inventory.write'));

create policy unit_costs_read on public.unit_costs for select to authenticated
  using (app.has_perm(organization_id, 'inventory.cost.read'));

-- -----------------------------------------------------------------------------
-- Compras, importaciones, proveedores
-- -----------------------------------------------------------------------------
create policy suppliers_read on public.suppliers for select to authenticated using (
  app.has_perm(organization_id, 'payable.read') or app.has_perm(organization_id, 'import.read')
  or app.has_perm(organization_id, 'service.read') or app.has_perm(organization_id, 'inventory.cost.read'));
create policy suppliers_write on public.suppliers for insert to authenticated with check (
  app.has_perm(organization_id, 'payable.write') or app.has_perm(organization_id, 'import.write'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (app.has_perm(organization_id, 'payable.write') or app.has_perm(organization_id, 'import.write'))
  with check (app.has_perm(organization_id, 'payable.write') or app.has_perm(organization_id, 'import.write'));

do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_lines','shipments','shipment_units','import_events'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (app.has_perm(organization_id, ''import.read''))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.has_perm(organization_id, ''import.write''))', t);
  end loop;
  foreach t in array array['purchase_orders','purchase_order_lines','shipments','import_events'] loop
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (app.has_perm(organization_id, ''import.write'')) with check (app.has_perm(organization_id, ''import.write''))', t);
  end loop;
  foreach t in array array['purchase_order_lines','shipment_units'] loop
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (app.has_perm(organization_id, ''import.write''))', t);
  end loop;
end $$;

create policy supplier_payables_read on public.supplier_payables for select to authenticated
  using (app.has_perm(organization_id, 'payable.read'));
create policy payable_payments_read on public.payable_payments for select to authenticated
  using (app.has_perm(organization_id, 'payable.read'));

-- -----------------------------------------------------------------------------
-- Tesorería
-- -----------------------------------------------------------------------------
create policy cash_accounts_read on public.cash_accounts for select to authenticated using (
  app.has_perm(organization_id, 'treasury.read') or app.has_perm(organization_id, 'payment.create')
  or app.has_perm(organization_id, 'payable.pay'));
create policy cash_accounts_insert on public.cash_accounts for insert to authenticated
  with check (app.has_perm(organization_id, 'treasury.reconcile'));
create policy cash_accounts_update on public.cash_accounts for update to authenticated
  using (app.has_perm(organization_id, 'treasury.reconcile')) with check (app.has_perm(organization_id, 'treasury.reconcile'));
create policy cash_movements_read on public.cash_movements for select to authenticated
  using (app.has_perm(organization_id, 'treasury.read'));
create policy bank_reconciliations_read on public.bank_reconciliations for select to authenticated
  using (app.has_perm(organization_id, 'treasury.read'));
create policy exchange_rates_read on public.exchange_rates for select to authenticated using (app.is_member(organization_id));
create policy exchange_rates_insert on public.exchange_rates for insert to authenticated
  with check (app.has_perm(organization_id, 'treasury.write'));

-- -----------------------------------------------------------------------------
-- CRM
-- -----------------------------------------------------------------------------
create policy customers_read on public.customers for select to authenticated using (app.has_perm(organization_id, 'customer.read'));
create policy customers_insert on public.customers for insert to authenticated with check (app.has_perm(organization_id, 'customer.write'));
create policy customers_update on public.customers for update to authenticated
  using (app.has_perm(organization_id, 'customer.write')) with check (app.has_perm(organization_id, 'customer.write'));

create policy customer_interactions_read on public.customer_interactions for select to authenticated
  using (app.has_perm(organization_id, 'customer.read'));
create policy customer_interactions_insert on public.customer_interactions for insert to authenticated
  with check (app.has_perm(organization_id, 'customer.write') and user_id = auth.uid());
create policy leads_read on public.leads for select to authenticated using (app.has_perm(organization_id, 'customer.read'));
create policy leads_write on public.leads for insert to authenticated with check (app.has_perm(organization_id, 'customer.write'));
create policy leads_update on public.leads for update to authenticated
  using (app.has_perm(organization_id, 'customer.write')) with check (app.has_perm(organization_id, 'customer.write'));
create policy sales_opportunities_read on public.sales_opportunities for select to authenticated
  using (app.has_perm(organization_id, 'deal.read') or (app.has_perm(organization_id, 'deal.read_own') and owner_user_id = auth.uid()));
create policy sales_opportunities_write on public.sales_opportunities for insert to authenticated
  with check (app.has_perm(organization_id, 'deal.write'));
create policy sales_opportunities_update on public.sales_opportunities for update to authenticated
  using (app.has_perm(organization_id, 'deal.write')) with check (app.has_perm(organization_id, 'deal.write'));

-- -----------------------------------------------------------------------------
-- Tasaciones
-- -----------------------------------------------------------------------------
create policy trade_in_appraisals_read on public.trade_in_appraisals for select to authenticated
  using (app.has_perm(organization_id, 'tradein.read'));
create policy trade_in_appraisals_update on public.trade_in_appraisals for update to authenticated
  using (app.has_perm(organization_id, 'tradein.write')) with check (app.has_perm(organization_id, 'tradein.write'));
create policy appraisal_inspections_read on public.appraisal_inspections for select to authenticated
  using (app.has_perm(organization_id, 'tradein.read'));
create policy appraisal_costs_read on public.appraisal_costs for select to authenticated
  using (app.has_perm(organization_id, 'tradein.read'));

-- -----------------------------------------------------------------------------
-- Negociaciones y contratos
-- -----------------------------------------------------------------------------
create policy deals_read on public.deals for select to authenticated using (app.can_read_deal(organization_id, salesperson_id));
create policy deal_items_read on public.deal_items for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_id and app.can_read_deal(d.organization_id, d.salesperson_id)));
create policy deal_trade_ins_read on public.deal_trade_ins for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_id and app.can_read_deal(d.organization_id, d.salesperson_id)));
create policy financing_plans_read on public.financing_plans for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_id and app.can_read_deal(d.organization_id, d.salesperson_id)));
create policy financing_plan_versions_read on public.financing_plan_versions for select to authenticated using (
  exists (select 1 from public.financing_plans p join public.deals d on d.id = p.deal_id
          where p.id = plan_id and app.can_read_deal(d.organization_id, d.salesperson_id)));
create policy reservations_read on public.reservations for select to authenticated
  using (app.has_perm(organization_id, 'inventory.read'));
create policy approvals_read on public.approvals for select to authenticated using (
  app.has_perm(organization_id, required_permission) or requested_by = auth.uid()
  or (entity_type = 'deal' and app.can_read_entity('deal', entity_id)));

create policy sales_contracts_read on public.sales_contracts for select to authenticated using (app.can_read_contract(id));
create policy contract_versions_read on public.contract_versions for select to authenticated using (app.can_read_contract(contract_id));
create policy receivable_installments_read on public.receivable_installments for select to authenticated
  using (app.can_read_receivables_of_contract(contract_id));
create policy installment_adjustments_read on public.installment_adjustments for select to authenticated using (
  exists (select 1 from public.receivable_installments i where i.id = installment_id
          and app.can_read_receivables_of_contract(i.contract_id)));

-- -----------------------------------------------------------------------------
-- Pagos y cobranzas
-- -----------------------------------------------------------------------------
create policy customer_payments_read on public.customer_payments for select to authenticated using (
  app.has_perm(organization_id, 'payment.read')
  or (contract_id is not null and app.can_read_receivables_of_contract(contract_id)));
create policy payment_allocations_read on public.payment_allocations for select to authenticated using (
  app.has_perm(organization_id, 'payment.read')
  or exists (select 1 from public.receivable_installments i where i.id = installment_id
             and app.can_read_receivables_of_contract(i.contract_id)));
create policy payment_reversals_read on public.payment_reversals for select to authenticated
  using (app.has_perm(organization_id, 'payment.read'));
create policy collection_actions_read on public.collection_actions for select to authenticated using (
  app.has_perm(organization_id, 'receivable.read') or app.has_perm(organization_id, 'collections.write'));

-- -----------------------------------------------------------------------------
-- Servicio
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['service_orders','inspections','preparation_tasks'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (app.has_perm(organization_id, ''service.read''))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (app.has_perm(organization_id, ''service.write''))', t);
  end loop;
end $$;
create policy service_orders_update on public.service_orders for update to authenticated
  using (app.has_perm(organization_id, 'service.write')) with check (app.has_perm(organization_id, 'service.write'));

-- -----------------------------------------------------------------------------
-- Documentos, notificaciones, objetivos y auditoría
-- -----------------------------------------------------------------------------
create policy documents_read on public.documents for select to authenticated using (
  app.has_perm(organization_id, 'document.read') and app.can_read_entity(entity_type,
    case when kind = 'reservation' then (select unit_id from public.reservations r where r.id = entity_id) else entity_id end));
create policy notification_events_read on public.notification_events for select to authenticated using (
  app.has_perm(organization_id, 'collections.write') or app.has_perm(organization_id, 'receivable.read'));
create policy sales_targets_read on public.sales_targets for select to authenticated using (
  app.has_perm(organization_id, 'report.read') or app.has_perm(organization_id, 'deal.read'));
create policy sales_targets_write on public.sales_targets for all to authenticated
  using (app.has_perm(organization_id, 'admin.policies')) with check (app.has_perm(organization_id, 'admin.policies'));
create policy audit_events_read on public.audit_events for select to authenticated
  using (organization_id is not null and app.has_perm(organization_id, 'audit.read'));

-- Las vistas se conceden explícitamente (security_invoker aplica el RLS anterior).
grant select on public.unit_cost_summary, public.unit_overview, public.installment_status, public.contract_balances,
  public.payment_status, public.payable_status, public.cash_account_balances, public.collection_promises to authenticated;
