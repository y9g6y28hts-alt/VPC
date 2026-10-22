import type { Db } from "./gateway";

// Consultas de reportes compartidas por la página y la exportación CSV.
export interface ProfitFilters { orgId: string; currency: string; from: string; to: string }

export function profitabilityRows(db: Db, f: ProfitFilters) {
  return db.rows<Record<string, string | null>>(
    `select c.number contrato, c.contract_date fecha, cu.display_name cliente, p.full_name vendedor, u.stock_number stock,
            u.make || ' ' || u.model as unidad, u.category categoria, di.list_price precio_lista, di.negotiated_price precio_venta,
            di.list_price - di.negotiated_price descuento, di.cost_actual_snapshot coste_real_al_formalizar,
            di.cost_estimated_snapshot coste_estimado_al_formalizar,
            di.negotiated_price - di.cost_actual_snapshot margen_bruto_real,
            round((di.negotiated_price - di.cost_actual_snapshot) / nullif(di.negotiated_price, 0) * 100, 2) margen_pct,
            (select coalesce(sum(amount_unit_currency), 0) from public.unit_costs x where x.unit_id = u.id and x.status = 'active' and x.nature = 'actual'
               and x.created_at > c.created_at) costes_posteriores_a_la_venta,
            u.received_on recibida, c.contract_date - u.received_on dias_en_stock
       from public.sales_contracts c join public.deal_items di on di.deal_id = c.deal_id join public.units u on u.id = di.unit_id
       join public.customers cu on cu.id = c.customer_id join public.user_profiles p on p.id = c.salesperson_id
      where c.organization_id = $1 and c.currency = $2 and c.contract_date between $3 and $4 and c.status <> 'cancelled'
      order by c.contract_date desc`, [f.orgId, f.currency, f.from, f.to]);
}
