-- =============================================================================
-- Motor Haus · 0015 Reportes ejecutivos y alertas de gestión
-- Todas las funciones son SECURITY INVOKER: el usuario solo ve lo que su RLS
-- permite. Las secciones sin permiso devuelven null (no cero) con el motivo.
-- =============================================================================

create or replace function public.management_alerts(p_org uuid)
returns table (
  alert_key text, kind text, severity text, entity_type text, entity_id uuid, title text, detail text,
  impact_amount numeric, currency char(3), age_days int, owner_id uuid, owner_name text, action text, href text
)
language sql stable set search_path = public, app as $$
  with pol as (select * from public.org_policies where organization_id = p_org),
  overdue as (
    select 'overdue:' || cb.contract_id as alert_key, 'overdue_installments'::text as kind,
      case when cb.max_days_past_due > (select aging_buckets[cardinality(aging_buckets)] from pol) then 'critical' else 'warning' end as severity,
      'contract'::text as entity_type, cb.contract_id as entity_id,
      format('%s · %s cuota(s) vencida(s)', cu.display_name, cb.overdue_count) as title,
      format('Contrato %s · atraso máximo %s días', cb.number, cb.max_days_past_due) as detail,
      cb.overdue_amount as impact_amount, cb.currency, cb.max_days_past_due::int as age_days,
      coalesce(last_ca.user_id, cu.owner_user_id) as owner_id,
      'Registrar gestión de cobranza'::text as action,
      '/receivables/' || cb.customer_id || '?contract=' || cb.contract_id as href
    from public.contract_balances cb
    join public.customers cu on cu.id = cb.customer_id
    left join lateral (select user_id from public.collection_actions ca where ca.customer_id = cb.customer_id
                       order by contacted_at desc limit 1) last_ca on true
    where cb.organization_id = p_org and cb.overdue_amount > 0 and cb.status <> 'cancelled'
  ),
  promises as (
    select distinct on (cp.customer_id)
      'promise:' || cp.id, 'broken_promise', 'warning', 'customer', cp.customer_id,
      format('Compromiso incumplido · %s', cu.display_name),
      format('Prometió %s %s para el %s', cp.promise_currency, cp.promise_amount, to_char(cp.promise_date, 'DD/MM/YYYY')),
      cp.promise_amount - cp.paid_since_promise, cp.promise_currency, (app.today() - cp.promise_date)::int, cp.user_id,
      'Contactar y reprogramar', '/receivables/' || cp.customer_id
    from public.collection_promises cp join public.customers cu on cu.id = cp.customer_id
    where cp.organization_id = p_org and cp.promise_status = 'broken'
      and not exists (select 1 from public.collection_actions later where later.customer_id = cp.customer_id
                      and later.contacted_at > cp.contacted_at)
    order by cp.customer_id, cp.contacted_at desc
  ),
  payables as (
    select 'payable:' || ps.id, case when ps.approval_status = 'pending' then 'payable_pending_approval' else 'payable_due' end,
      case when ps.due_date < app.today() then 'critical' else 'warning' end,
      'supplier_payable', ps.id,
      format('%s · %s %s', ps.supplier_name, ps.document_number,
             case when ps.approval_status = 'pending' then '(sin aprobar)' else '' end),
      case when ps.due_date < app.today() then format('Vencida hace %s días', app.today() - ps.due_date)
           else format('Vence el %s', to_char(ps.due_date, 'DD/MM/YYYY')) end,
      ps.outstanding, ps.currency, greatest(app.today() - ps.issue_date, 0)::int, ps.created_by,
      case when ps.approval_status = 'pending' then 'Aprobar o rechazar factura' else 'Programar pago' end,
      '/payables?focus=' || ps.id
    from public.payable_status ps, pol
    where ps.organization_id = p_org and ps.payable_state in ('open','overdue') and ps.approval_status <> 'rejected'
      and ps.due_date <= app.today() + pol.payable_due_soon_days
  ),
  reservations as (
    select 'reservation:' || r.id, 'reservation_expiring', 'warning', 'unit', r.unit_id,
      format('Reserva por vencer · %s %s %s', u.stock_number, u.make, u.model),
      format('%s · vence %s', cu.display_name, to_char(r.expires_at at time zone 'America/Asuncion', 'DD/MM HH24:MI')),
      u.list_price, u.currency, (app.today() - r.created_at::date)::int, r.responsible_user_id,
      'Formalizar, extender o liberar', '/inventory/' || r.unit_id
    from public.reservations r join public.units u on u.id = r.unit_id join public.customers cu on cu.id = r.customer_id, pol
    where r.organization_id = p_org and r.status = 'active'
      and r.expires_at <= now() + make_interval(hours => pol.reservation_expiry_alert_hours)
  ),
  imports as (
    select 'import:' || s.id, 'import_delayed',
      case when app.today() - s.eta > 2 * pol.import_delay_alert_days then 'critical' else 'warning' end,
      'shipment', s.id, format('Importación demorada · %s', s.reference),
      format('ETA %s (original %s) · %s', to_char(s.eta, 'DD/MM/YYYY'), to_char(coalesce(s.eta_original, s.eta), 'DD/MM/YYYY'), s.origin_country),
      (select sum(u.list_price) from public.shipment_units su join public.units u on u.id = su.unit_id where su.shipment_id = s.id),
      (select min(u.currency) from public.shipment_units su join public.units u on u.id = su.unit_id where su.shipment_id = s.id),
      (app.today() - s.eta)::int, s.responsible_user_id, 'Actualizar ETA o registrar incidencia', '/imports/' || s.id
    from public.shipments s, pol
    where s.organization_id = p_org and s.status not in ('delivered','cancelled') and s.eta is not null
      and s.eta + pol.import_delay_alert_days < app.today()
  ),
  stale as (
    select 'stale:' || uo.id, 'stale_inventory', 'warning', 'unit', uo.id,
      format('Inmovilizada %s días · %s %s %s', uo.days_in_stock, uo.stock_number, uo.make, uo.model),
      case when uo.cost_actual is not null then 'Capital inmovilizado (coste real registrado)' else 'Precio de lista (sin acceso a costes)' end,
      coalesce(uo.cost_actual, uo.list_price), uo.currency, uo.days_in_stock, uo.responsible_user_id,
      'Revisar precio o estrategia comercial', '/inventory/' || uo.id
    from public.unit_overview uo, pol
    where uo.organization_id = p_org and uo.in_stock and uo.days_in_stock > pol.stale_inventory_days
  ),
  pending_costs as (
    select 'costs:' || uo.id, 'pending_costs', case when uo.commercial_status in ('sold_pending_delivery','delivered') then 'warning' else 'info' end,
      'unit', uo.id, format('Costes estimados sin liquidar · %s %s %s', uo.stock_number, uo.make, uo.model),
      format('%s estimación(es) pendiente(s) de registrar como coste real', uo.pending_estimates),
      uo.cost_estimated_pending, uo.currency, coalesce(uo.days_in_stock, 0), uo.responsible_user_id,
      'Registrar coste real o anular estimación', '/inventory/' || uo.id || '#costs'
    from public.unit_overview uo
    where uo.organization_id = p_org and coalesce(uo.pending_estimates, 0) > 0
      and (uo.commercial_status in ('sold_pending_delivery','delivered') or coalesce(uo.days_in_stock, 0) > 30)
  ),
  approvals as (
    select 'approval:' || a.id, 'approval_pending', case when now() - a.requested_at > interval '2 days' then 'warning' else 'info' end,
      a.entity_type, a.entity_id, a.message,
      format('Solicitado por %s', coalesce(p.full_name, '—')),
      case a.rule when 'discount' then (a.requested_value ->> 'discount_amount')::numeric
                  when 'min_margin' then (a.requested_value ->> 'gross_margin')::numeric end,
      coalesce((select d.currency from public.deals d where d.id = a.entity_id),
               (select t.currency from public.trade_in_appraisals t where t.id = a.entity_id)),
      (now()::date - a.requested_at::date)::int, a.requested_by, 'Revisar y decidir', '/approvals'
    from public.approvals a left join public.user_profiles p on p.id = a.requested_by
    where a.organization_id = p_org and a.status = 'pending'
  ),
  unreconciled as (
    select 'payment:' || ps.id, 'payment_unreconciled', 'warning', 'customer_payment', ps.id,
      format('Pago sin conciliar · %s', ps.customer_name), format('%s · %s · registrado %s', ps.number, ps.method, to_char(ps.recorded_at, 'DD/MM')),
      ps.amount, ps.currency, (app.today() - ps.recorded_at::date)::int, ps.recorded_by, 'Conciliar con banco y confirmar', '/payments?focus=' || ps.id
    from public.payment_status ps, pol
    where ps.organization_id = p_org and ps.status = 'pending_reconciliation'
      and ps.recorded_at::date + pol.payment_reconciliation_alert_days <= app.today()
  ),
  unallocated as (
    select 'unallocated:' || ps.id, 'payment_unallocated', 'warning', 'customer_payment', ps.id,
      format('Pago sin asignar · %s', ps.customer_name), format('%s · %s sin asignar a cuotas', ps.number, ps.unallocated_amount),
      ps.unallocated_amount, ps.currency, (app.today() - ps.effective_date)::int, ps.recorded_by, 'Asignar a obligaciones', '/payments?focus=' || ps.id
    from public.payment_status ps
    where ps.organization_id = p_org and ps.status in ('confirmed','pending_reconciliation') and ps.unallocated_amount > 0
  ),
  discrepancies as (
    select 'discrepancy:' || cb.contract_id, 'schedule_discrepancy', 'critical', 'contract', cb.contract_id,
      format('Discrepancia contractual · %s', cb.number), 'El principal programado no coincide con entregas + capital financiado',
      abs(cb.schedule_discrepancy), cb.currency, (app.today() - cb.contract_date)::int, cb.salesperson_id,
      'Revisar contrato y obligaciones', '/contracts/' || cb.contract_id
    from public.contract_balances cb where cb.organization_id = p_org and cb.schedule_discrepancy <> 0
  ),
  low_margin as (
    select 'margin:' || d.id, 'low_margin_draft', 'info', 'deal', d.id,
      format('Margen bajo en negociación · %s', d.number),
      format('Margen estimado %s%% (mínimo %s%%)', (app.deal_economics(d.id) ->> 'gross_margin_pct'), pol.min_margin_pct),
      (app.deal_economics(d.id) ->> 'gross_margin_estimated')::numeric, d.currency, (app.today() - d.created_at::date)::int,
      d.salesperson_id, 'Revisar precio o solicitar autorización', '/deals/' || d.id
    from public.deals d, pol
    where d.organization_id = p_org and d.status = 'draft'
      and (app.deal_economics(d.id) ->> 'units_missing_purchase_cost')::int = 0
      and (app.deal_economics(d.id) ->> 'gross_margin_pct')::numeric < pol.min_margin_pct
  ),
  missing_docs as (
    select 'docs:' || uo.id, 'sale_missing_documents', 'warning', 'unit', uo.id,
      format('Venta con documentación incompleta · %s %s %s', uo.stock_number, uo.make, uo.model),
      format('%s documento(s) obligatorio(s) pendiente(s)', uo.required_docs_pending),
      uo.list_price, uo.currency, (app.today() - uo.sold_on)::int, uo.responsible_user_id,
      'Completar documentación antes de la entrega', '/inventory/' || uo.id || '#documents'
    from public.unit_overview uo
    where uo.organization_id = p_org and uo.commercial_status = 'sold_pending_delivery' and uo.required_docs_pending > 0
  ),
  counts as (
    select 'count:' || lc.id, 'physical_count_mismatch', case when not lc.found then 'critical' else 'warning' end, 'unit', lc.unit_id,
      format('Diferencia de inventario físico · %s %s %s', u.stock_number, u.make, u.model),
      case when not lc.found then 'No encontrada en el conteo del ' || to_char(lc.counted_on, 'DD/MM/YYYY')
           else 'Encontrada en una ubicación distinta a la registrada' end,
      u.list_price, u.currency, (app.today() - lc.counted_on)::int, lc.counted_by, 'Verificar ubicación física', '/inventory/' || u.id
    from (select distinct on (pc.unit_id) pc.* from public.physical_counts pc
          where pc.organization_id = p_org order by pc.unit_id, pc.counted_on desc, pc.created_at desc) lc
    join public.units u on u.id = lc.unit_id
    where u.commercial_status not in ('delivered','retired')
      and (not lc.found or lc.observed_location_id is distinct from lc.expected_location_id)
  ),
  all_alerts as (
    select * from overdue union all select * from promises union all select * from payables
    union all select * from reservations union all select * from imports union all select * from stale
    union all select * from pending_costs union all select * from approvals union all select * from unreconciled
    union all select * from unallocated union all select * from discrepancies union all select * from low_margin
    union all select * from missing_docs union all select * from counts
  )
  select a.alert_key, a.kind, a.severity, a.entity_type, a.entity_id, a.title, a.detail, a.impact_amount, a.currency,
         a.age_days, a.owner_id, p.full_name, a.action, a.href
  from all_alerts a left join public.user_profiles p on p.id = a.owner_id
  order by case a.severity when 'critical' then 1 when 'warning' then 2 else 3 end, a.impact_amount desc nulls last, a.age_days desc nulls last
$$;

-- -----------------------------------------------------------------------------
-- Antigüedad de deuda con tramos configurables
-- -----------------------------------------------------------------------------
create or replace function public.receivables_aging(p_org uuid, p_currency char(3), p_salesperson uuid default null)
returns table (bucket_order int, bucket_label text, min_days int, max_days int, amount numeric, installments bigint, contracts bigint)
language sql stable set search_path = public, app as $$
  with pol as (select aging_buckets b from public.org_policies where organization_id = p_org),
  buckets as (
    select 0 as ord, 'Al día (no vencido)' as label, null::int as lo, null::int as hi
    union all
    select i, case when i = 1 then format('1–%s días', b[1]) else format('%s–%s días', b[i-1] + 1, b[i]) end,
           case when i = 1 then 1 else b[i-1] + 1 end, b[i]
    from pol, generate_subscripts((select b from pol), 1) i
    union all
    select cardinality(b) + 1, format('Más de %s días', b[cardinality(b)]), b[cardinality(b)] + 1, null from pol
  ),
  inst as (
    select s.* from public.installment_status s
    join public.sales_contracts c on c.id = s.contract_id
    where s.organization_id = p_org and s.currency = p_currency and s.outstanding > 0 and c.status <> 'cancelled'
      and (p_salesperson is null or c.salesperson_id = p_salesperson)
  )
  select bk.ord, bk.label, bk.lo, bk.hi,
    coalesce(sum(i.outstanding), 0), count(i.id), count(distinct i.contract_id)
  from buckets bk
  left join inst i on (bk.ord = 0 and not i.is_overdue)
                   or (bk.ord > 0 and i.is_overdue and i.days_past_due >= bk.lo and (bk.hi is null or i.days_past_due <= bk.hi))
  group by bk.ord, bk.label, bk.lo, bk.hi
  order by bk.ord
$$;

-- -----------------------------------------------------------------------------
-- Proyección de caja: obligaciones contractuales, no movimientos realizados.
-- -----------------------------------------------------------------------------
create or replace function public.cash_projection(p_org uuid, p_currency char(3), p_months int default 6)
returns table (month date, expected_inflows numeric, expected_outflows numeric, pending_movements numeric, net numeric)
language sql stable set search_path = public, app as $$
  with months as (
    select (date_trunc('month', app.today()) + make_interval(months => g))::date as m
    from generate_series(0, greatest(p_months, 1) - 1) g
  ), calc as (
    select m.m,
      coalesce((select sum(s.outstanding) from public.installment_status s
                join public.sales_contracts c on c.id = s.contract_id
                where s.organization_id = p_org and s.currency = p_currency and s.outstanding > 0 and c.status <> 'cancelled'
                  and not s.is_overdue
                  and s.due_date >= greatest(m.m, app.today()) and s.due_date < (m.m + interval '1 month')::date), 0) as inflows,
      coalesce((select sum(ps.outstanding) from public.payable_status ps
                where ps.organization_id = p_org and ps.currency = p_currency and ps.payable_state = 'open'
                  and ps.approval_status <> 'rejected'
                  and ps.due_date >= greatest(m.m, app.today()) and ps.due_date < (m.m + interval '1 month')::date), 0) as outflows,
      coalesce((select sum(cm.amount) from public.cash_movements cm
                where cm.organization_id = p_org and cm.currency = p_currency and cm.status = 'pending'
                  and cm.movement_date >= m.m and cm.movement_date < (m.m + interval '1 month')::date), 0) as pending
    from months m
  )
  -- Cuotas ya vencidas y facturas vencidas no se proyectan: se informan aparte como vencidas.
  select m, inflows, outflows, pending, inflows - outflows + pending from calc order by m
$$;

-- -----------------------------------------------------------------------------
-- Resumen ejecutivo con filtros coherentes
-- -----------------------------------------------------------------------------
create or replace function public.executive_snapshot(
  p_org uuid, p_currency char(3), p_from date, p_to date,
  p_category text default null, p_salesperson uuid default null, p_branch uuid default null
) returns jsonb
language plpgsql stable set search_path = public, app as $$
declare
  v_days int := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  r jsonb := '{}'::jsonb;
  v jsonb;
  v_opex numeric; v_opex_count int;
begin
  if p_to < p_from then raise exception 'MH_VALIDATION: período inválido'; end if;
  r := r || jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days,
             'previous_from', v_prev_from, 'previous_to', v_prev_to), 'currency', p_currency, 'as_of', app.today());

  -- Caja (no se filtra por categoría ni vendedor)
  if app.has_perm(p_org, 'treasury.read') then
    select jsonb_build_object(
      'available', coalesce(sum(posted_balance), 0),
      'pending', coalesce(sum(pending_amount), 0),
      'accounts', count(*),
      'data_origin', case when bool_and(data_origin = 'manual') then 'manual' else 'mixed' end,
      'last_reconciled_on', min(last_reconciled_on))
    into v from public.cash_account_balances where organization_id = p_org and currency = p_currency and active;
    r := r || jsonb_build_object('cash', v);
  else
    r := r || jsonb_build_object('cash', null, 'cash_reason', 'Sin permiso treasury.read');
  end if;

  -- Cuentas por cobrar
  if app.has_perm(p_org, 'receivable.read') or app.has_perm(p_org, 'receivable.read_own') then
    select jsonb_build_object(
      'outstanding', coalesce(sum(cb.outstanding), 0),
      'overdue', coalesce(sum(cb.overdue_amount), 0),
      'future', coalesce(sum(cb.future_amount), 0),
      'pending_reconciliation', coalesce(sum(cb.pending_reconciliation), 0),
      'accounts_overdue', count(distinct cb.customer_id) filter (where cb.overdue_amount > 0),
      'contracts_active', count(*) filter (where cb.outstanding > 0),
      'overdue_ratio_pct', case when sum(cb.outstanding) > 0 then round(sum(cb.overdue_amount) / sum(cb.outstanding) * 100, 2) end,
      'top5_concentration_pct', (
        select case when sum(t.o) > 0 then round(sum(t.o) filter (where t.rn <= 5) / sum(t.o) * 100, 2) end
        from (select sum(cb2.outstanding) o, row_number() over (order by sum(cb2.outstanding) desc) rn
              from public.contract_balances cb2 where cb2.organization_id = p_org and cb2.currency = p_currency
                and cb2.status <> 'cancelled' and (p_salesperson is null or cb2.salesperson_id = p_salesperson)
              group by cb2.customer_id) t))
    into v from public.contract_balances cb
    where cb.organization_id = p_org and cb.currency = p_currency and cb.status <> 'cancelled'
      and (p_salesperson is null or cb.salesperson_id = p_salesperson);
    r := r || jsonb_build_object('receivables', v);

    -- Cobranza del período: pagos confirmados con fecha efectiva en el período.
    select jsonb_build_object(
      'collected_confirmed', coalesce(sum(cp.amount) filter (where cp.status = 'confirmed'), 0),
      'collected_pending_reconciliation', coalesce(sum(cp.amount) filter (where cp.status = 'pending_reconciliation'), 0),
      'reversed', coalesce(sum(cp.amount) filter (where cp.status = 'reversed'), 0))
    into v from public.customer_payments cp
    left join public.sales_contracts c on c.id = cp.contract_id
    where cp.organization_id = p_org and cp.currency = p_currency and cp.effective_date between p_from and p_to
      and (p_salesperson is null or c.salesperson_id = p_salesperson);
    r := r || jsonb_build_object('collections', v);

    -- Efectividad: lo cobrado (confirmado) sobre lo exigible en el período.
    select jsonb_build_object(
      'exigible', coalesce(sum(s.total_due), 0),
      'collected_on_exigible', coalesce(sum(least(s.paid_confirmed, s.total_due)), 0),
      'effectiveness_pct', case when sum(s.total_due) > 0 then round(sum(least(s.paid_confirmed, s.total_due)) / sum(s.total_due) * 100, 2) end)
    into v from public.installment_status s join public.sales_contracts c on c.id = s.contract_id
    where s.organization_id = p_org and s.currency = p_currency and s.due_date between p_from and least(p_to, app.today())
      and c.status <> 'cancelled' and (p_salesperson is null or c.salesperson_id = p_salesperson);
    r := r || jsonb_build_object('collection_effectiveness', v);
  else
    r := r || jsonb_build_object('receivables', null, 'receivables_reason', 'Sin permiso de cuentas por cobrar');
  end if;

  -- Cuentas por pagar
  if app.has_perm(p_org, 'payable.read') then
    select jsonb_build_object(
      'outstanding', coalesce(sum(outstanding) filter (where payable_state in ('open','overdue')), 0),
      'overdue', coalesce(sum(outstanding) filter (where payable_state = 'overdue'), 0),
      'due_next_30', coalesce(sum(outstanding) filter (where payable_state = 'open' and due_date <= app.today() + 30), 0),
      'pending_approval', count(*) filter (where approval_status = 'pending' and payable_state in ('open','overdue')))
    into v from public.payable_status where organization_id = p_org and currency = p_currency and approval_status <> 'rejected';
    r := r || jsonb_build_object('payables', v);
  else
    r := r || jsonb_build_object('payables', null, 'payables_reason', 'Sin permiso payable.read');
  end if;

  -- Inventario
  select jsonb_build_object(
    'units_in_stock', count(*) filter (where in_stock),
    'units_available', count(*) filter (where commercial_status = 'available'),
    'units_reserved', count(*) filter (where commercial_status = 'reserved'),
    'units_in_transit', count(*) filter (where logistics_status in ('in_transit','in_customs') and acquisition_status in ('approved','acquired')),
    'units_in_preparation', count(*) filter (where in_stock and display_status in ('in_preparation','ready_not_listed','in_service')),
    'units_sold_pending_delivery', count(*) filter (where commercial_status = 'sold_pending_delivery'),
    'stale_units', count(*) filter (where in_stock and days_in_stock > (select stale_inventory_days from public.org_policies where organization_id = p_org)),
    'avg_days_in_stock', round(avg(days_in_stock) filter (where in_stock and days_in_stock is not null)),
    'stock_value_list', coalesce(sum(list_price) filter (where in_stock), 0),
    'capital_invested', case when app.has_perm(p_org, 'inventory.cost.read') then coalesce(sum(cost_actual) filter (where in_stock), 0) end,
    'cost_estimated_pending', case when app.has_perm(p_org, 'inventory.cost.read') then coalesce(sum(cost_estimated_pending) filter (where in_stock), 0) end,
    'potential_margin', case when app.has_perm(p_org, 'inventory.cost.read') then coalesce(sum(potential_margin) filter (where in_stock and list_price is not null), 0) end,
    'units_without_list_price', count(*) filter (where in_stock and list_price is null))
  into v from public.unit_overview
  where organization_id = p_org and currency = p_currency
    and (p_category is null or category = p_category) and (p_branch is null or branch_id = p_branch);
  r := r || jsonb_build_object('inventory', v);

  -- Ventas formalizadas
  if app.has_perm(p_org, 'deal.read') or app.has_perm(p_org, 'deal.read_own') then
    with sales as (
      select c.id, c.contract_date, c.salesperson_id, di.negotiated_price, di.list_price, di.cost_actual_snapshot,
             di.cost_estimated_snapshot, u.category
      from public.sales_contracts c
      join public.deal_items di on di.deal_id = c.deal_id
      join public.units u on u.id = di.unit_id
      where c.organization_id = p_org and c.currency = p_currency and c.status <> 'cancelled'
        and (p_category is null or u.category = p_category)
        and (p_salesperson is null or c.salesperson_id = p_salesperson)
        and (p_branch is null or u.branch_id = p_branch)
    )
    select jsonb_build_object(
      'contracts', count(distinct id) filter (where contract_date between p_from and p_to),
      'units', count(*) filter (where contract_date between p_from and p_to),
      'revenue', coalesce(sum(negotiated_price) filter (where contract_date between p_from and p_to), 0),
      'discounts', coalesce(sum(list_price - negotiated_price) filter (where contract_date between p_from and p_to), 0),
      'gross_margin_realized', case when app.has_perm(p_org, 'report.read') then
          coalesce(sum(negotiated_price - cost_actual_snapshot) filter (where contract_date between p_from and p_to), 0) end,
      'cost_estimated_at_sale', case when app.has_perm(p_org, 'report.read') then
          coalesce(sum(cost_estimated_snapshot) filter (where contract_date between p_from and p_to), 0) end,
      'previous_revenue', coalesce(sum(negotiated_price) filter (where contract_date between v_prev_from and v_prev_to), 0),
      'previous_contracts', count(distinct id) filter (where contract_date between v_prev_from and v_prev_to),
      'avg_deal_value', round(avg(negotiated_price) filter (where contract_date between p_from and p_to), 2),
      'by_category', coalesce((select jsonb_agg(x order by x ->> 'category') from (
          select jsonb_build_object('category', category, 'units', count(*), 'revenue', sum(negotiated_price),
                 'margin', case when app.has_perm(p_org, 'report.read') then sum(negotiated_price - cost_actual_snapshot) end) x
          from sales where contract_date between p_from and p_to group by category) q), '[]'::jsonb),
      'by_salesperson', coalesce((select jsonb_agg(x order by (x ->> 'revenue')::numeric desc) from (
          select jsonb_build_object('salesperson_id', s.salesperson_id, 'name', p.full_name, 'contracts', count(distinct s.id),
                 'units', count(*), 'revenue', sum(s.negotiated_price), 'discounts', sum(s.list_price - s.negotiated_price),
                 'margin', case when app.has_perm(p_org, 'report.read') then sum(s.negotiated_price - s.cost_actual_snapshot) end) x
          from sales s left join public.user_profiles p on p.id = s.salesperson_id
          where s.contract_date between p_from and p_to group by s.salesperson_id, p.full_name) q), '[]'::jsonb),
      'monthly', coalesce((select jsonb_agg(x order by x ->> 'month') from (
          select jsonb_build_object('month', to_char(date_trunc('month', contract_date), 'YYYY-MM'),
                 'revenue', sum(negotiated_price), 'units', count(*)) x
          from sales where contract_date >= (date_trunc('month', p_to) - interval '11 months')::date and contract_date <= p_to
          group by date_trunc('month', contract_date)) q), '[]'::jsonb))
    into v from sales;
    r := r || jsonb_build_object('sales', v);

    select jsonb_build_object(
      'deals_created', count(*),
      'deals_with_proposal', count(*) filter (where exists (
          select 1 from public.documents doc where doc.entity_type = 'deal' and doc.entity_id = d.id and doc.kind = 'proposal')),
      'deals_formalized', count(*) filter (where d.status = 'formalized'),
      'conversion_pct', case when count(*) > 0 then round(count(*) filter (where d.status = 'formalized')::numeric / count(*) * 100, 1) end)
    into v from public.deals d
    where d.organization_id = p_org and d.currency = p_currency and d.created_at::date between p_from and p_to
      and (p_salesperson is null or d.salesperson_id = p_salesperson);
    r := r || jsonb_build_object('conversion', v);

    select jsonb_build_object('revenue', sum(target_revenue), 'units', sum(target_units), 'rows', count(*))
    into v from public.sales_targets t
    where t.organization_id = p_org and t.currency = p_currency
      and t.period_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
      and (p_salesperson is null or t.salesperson_id = p_salesperson)
      and (p_category is null or t.category = p_category)
      and (p_salesperson is not null or t.salesperson_id is null)
      and (p_category is not null or t.category is null);
    r := r || jsonb_build_object('targets', case when (v ->> 'rows')::int > 0 then v end);
  else
    r := r || jsonb_build_object('sales', null, 'sales_reason', 'Sin permiso de ventas');
  end if;

  -- Resultado operativo: solo si hay gastos operativos registrados en el período.
  if app.has_perm(p_org, 'treasury.read') and app.has_perm(p_org, 'report.read') then
    select coalesce(-sum(amount), 0), count(*) into v_opex, v_opex_count
    from public.cash_movements
    where organization_id = p_org and currency = p_currency and status = 'posted'
      and category in ('operating_expense','payroll','tax') and movement_date between p_from and p_to;
    if v_opex_count = 0 then
      r := r || jsonb_build_object('operating_result', null,
        'operating_result_reason', 'No hay gastos operativos registrados en el período; el resultado no puede calcularse');
    else
      r := r || jsonb_build_object('operating_result', jsonb_build_object(
        'operating_expenses_paid', v_opex, 'movements', v_opex_count,
        'value', coalesce((r -> 'sales' ->> 'gross_margin_realized')::numeric, 0) - v_opex,
        'basis', 'Margen bruto realizado − gastos operativos pagados en el período (base mixta, no sustituye al resultado contable)'));
    end if;
  end if;
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Estado de cuenta por contrato: saldo inicial, movimientos y saldo final
-- -----------------------------------------------------------------------------
create or replace function public.contract_statement(p_contract uuid, p_from date, p_to date)
returns table (entry_order int, entry_date date, entry_type text, description text, reference text,
               debit numeric, credit numeric, balance numeric)
language sql stable set search_path = public, app as $$
  with c as (select * from public.sales_contracts where id = p_contract),
  entries as (
    select (select contract_date from c) as d, 1 as o, 'obligations'::text as t,
      format('Obligaciones emitidas (%s): %s', count(*), string_agg(distinct kind, ', ')) as descr,
      (select number from c) as ref, sum(amount_due) as debit, 0::numeric as credit
    from public.receivable_installments where contract_id = p_contract and status = 'open'
    union all
    select a.effective_date, 2, case when a.amount > 0 then 'charge' else 'credit_note' end,
      format('%s: %s', a.kind, a.reason), null, greatest(a.amount, 0), greatest(-a.amount, 0)
    from public.installment_adjustments a join public.receivable_installments i on i.id = a.installment_id
    where i.contract_id = p_contract
    union all
    select cp.effective_date, 3, 'payment', format('Pago %s (%s)', cp.number, cp.method), cp.reference, 0, sum(pa.amount)
    from public.payment_allocations pa join public.customer_payments cp on cp.id = pa.payment_id
    join public.receivable_installments i on i.id = pa.installment_id
    where i.contract_id = p_contract and cp.status in ('confirmed','reversed')
    group by cp.id
    union all
    select pr.reversed_at::date, 4, 'reversal', format('Reversión de pago %s: %s', cp.number, pr.reason), cp.reference, sum(pa.amount), 0
    from public.payment_reversals pr join public.customer_payments cp on cp.id = pr.payment_id
    join public.payment_allocations pa on pa.payment_id = cp.id
    join public.receivable_installments i on i.id = pa.installment_id
    where i.contract_id = p_contract
    group by pr.id, cp.number, cp.reference
  ),
  opening as (
    select coalesce(sum(debit - credit), 0) as bal from entries where d < p_from
  ),
  period as (
    select row_number() over (order by d, o, ref)::int as rn, * from entries where d between p_from and p_to
  )
  select 0, p_from, 'opening', 'Saldo inicial del período', null::text, null::numeric, null::numeric, (select bal from opening)
  union all
  select p.rn, p.d, p.t, p.descr, p.ref, p.debit, p.credit,
    (select bal from opening) + sum(p.debit - p.credit) over (order by p.rn)
  from period p
  order by 1
$$;
