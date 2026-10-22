import "server-only";
import type { AppContext } from "@/server/auth/context";

export interface VehicleRow {
  id: string;
  stock_code: string;
  brand: string;
  brand_id: string;
  model: string;
  version: string | null;
  year_model: number;
  mileage_km: number;
  color: string | null;
  condition: "nuevo" | "usado";
  origin: string;
  price_currency: "PYG" | "USD";
  list_price: string | null;
  min_price: string | null;
  commercial_status: string;
  physical_status: string;
  prep_status: string;
  doc_status: string;
  contract_status: string;
  location: string | null;
  acquisition_date: string | null;
  days_in_stock: number;
  base_currency: "PYG" | "USD";
  total_cost_base: string | null;
  estimated_cost_base: string | null;
  estimated_margin_base: string | null;
  price_fx_rate: string | null;
  cover_photo_id: string | null;
  reserved_until: Date | null;
  reserved_for: string | null;
}

export interface InventoryFilters {
  q?: string;
  brand?: string;
  status?: string;
  condition?: string;
  aged?: boolean;
  sort: { field: string; dir: "asc" | "desc" };
}

const SORTS: Record<string, string> = {
  dias: "e.days_in_stock",
  precio: "v.list_price",
  margen: "e.estimated_margin_base",
  coste: "e.total_cost_base",
  modelo: "v.model",
  codigo: "v.stock_code",
  anio: "v.year_model",
};
export const INVENTORY_SORTS = Object.keys(SORTS);

export async function listVehicles(ctx: AppContext, f: InventoryFilters, agingDays: number): Promise<VehicleRow[]> {
  await ctx.db((tx) => tx`select public.rpc_housekeeping(${ctx.org.id})`);
  const order = SORTS[f.sort.field] ?? "e.days_in_stock";
  return ctx.db((tx) => tx<VehicleRow[]>`
    select v.id, v.stock_code, b.name as brand, v.brand_id, v.model, v.version, v.year_model, v.mileage_km, v.color,
           v.condition, v.origin, v.price_currency, v.list_price, v.min_price, v.commercial_status, v.physical_status,
           v.prep_status, v.doc_status, v.contract_status, v.location, v.acquisition_date,
           e.days_in_stock, e.base_currency, e.total_cost_base, e.estimated_cost_base, e.estimated_margin_base, e.price_fx_rate,
           (select p.id from public.vehicle_photos p where p.vehicle_id = v.id order by p.is_cover desc, p.sort_order limit 1) as cover_photo_id,
           r.expires_at as reserved_until, rc.full_name as reserved_for
    from public.vehicles v
    join public.brands b on b.id = v.brand_id
    join public.v_vehicle_economics e on e.vehicle_id = v.id
    left join public.reservations r on r.vehicle_id = v.id and r.status = 'activa'
    left join public.customers rc on rc.id = r.customer_id
    where v.org_id = ${ctx.org.id}
      ${f.q ? tx`and (v.stock_code ilike ${"%" + f.q + "%"} or v.model ilike ${"%" + f.q + "%"} or v.version ilike ${"%" + f.q + "%"}
                     or v.vin ilike ${"%" + f.q + "%"} or v.plate ilike ${"%" + f.q + "%"} or v.color ilike ${"%" + f.q + "%"})` : tx``}
      ${f.brand ? tx`and v.brand_id = ${f.brand}` : tx``}
      ${f.status === "stock" ? tx`and v.commercial_status in ('disponible','reservado')`
        : f.status ? tx`and v.commercial_status = ${f.status}` : tx`and v.commercial_status <> 'entregado'`}
      ${f.condition ? tx`and v.condition = ${f.condition}` : tx``}
      ${f.aged ? tx`and e.days_in_stock > ${agingDays} and v.commercial_status in ('disponible','reservado')` : tx``}
    order by ${tx.unsafe(order)} ${tx.unsafe(f.sort.dir === "asc" ? "asc nulls first" : "desc nulls last")}, v.stock_code
    limit 500`);
}

export interface InventorySummary {
  units: number;
  available: number;
  reserved: number;
  pendingDelivery: number;
  capitalBase: string | null;
  estimatedMarginBase: string | null;
  aged: number;
  missingRates: number;
}

/** Resumen de stock (unidades no entregadas ni retiradas). */
export async function inventorySummary(ctx: AppContext, agingDays: number): Promise<InventorySummary> {
  const [r] = await ctx.db((tx) => tx<InventorySummary[]>`
    select count(*)::int as units,
           count(*) filter (where v.commercial_status = 'disponible')::int as available,
           count(*) filter (where v.commercial_status = 'reservado')::int as reserved,
           count(*) filter (where v.commercial_status = 'vendido_pendiente_entrega')::int as "pendingDelivery",
           sum(e.total_cost_base) filter (where v.commercial_status in ('disponible','reservado')) as "capitalBase",
           sum(e.estimated_margin_base) filter (where v.commercial_status in ('disponible','reservado')) as "estimatedMarginBase",
           count(*) filter (where e.days_in_stock > ${agingDays} and v.commercial_status in ('disponible','reservado'))::int as aged,
           count(*) filter (where e.price_fx_rate is null and v.commercial_status in ('disponible','reservado'))::int as "missingRates"
    from public.vehicles v join public.v_vehicle_economics e on e.vehicle_id = v.id
    where v.org_id = ${ctx.org.id} and v.commercial_status in ('disponible','reservado','vendido_pendiente_entrega')`);
  return r!;
}

export async function getVehicle(ctx: AppContext, id: string) {
  const [v] = await ctx.db((tx) => tx<(VehicleRow & {
    vin: string | null; engine_number: string | null; plate: string | null; fuel: string; transmission: string;
    year_manufacture: number; category: string | null; category_id: string | null; branch: string | null; branch_id: string | null;
    supplier: string | null; supplier_id: string | null; responsible: string | null; responsible_id: string | null;
    description: string | null; registered_cost_base: string | null; acquisition_cost_base: string | null; row_version: number;
  })[]>`
    select v.*, b.name as brand, c.name as category, br.name as branch, s.name as supplier, u.full_name as responsible,
           e.days_in_stock, e.base_currency, e.total_cost_base, e.estimated_cost_base, e.registered_cost_base, e.acquisition_cost_base,
           e.estimated_margin_base, e.price_fx_rate, null as cover_photo_id,
           r.expires_at as reserved_until, rc.full_name as reserved_for
    from public.vehicles v
    join public.brands b on b.id = v.brand_id
    join public.v_vehicle_economics e on e.vehicle_id = v.id
    left join public.vehicle_categories c on c.id = v.category_id
    left join public.branches br on br.id = v.branch_id
    left join public.suppliers s on s.id = v.supplier_id
    left join public.user_profiles u on u.id = v.responsible_id
    left join public.reservations r on r.vehicle_id = v.id and r.status = 'activa'
    left join public.customers rc on rc.id = r.customer_id
    where v.id = ${id} and v.org_id = ${ctx.org.id}`);
  return v ?? null;
}

export async function vehicleCosts(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{
    id: string; kind: string; description: string; amount: string; currency: "PYG" | "USD"; fx_rate_to_base: string;
    amount_base: string; is_estimate: boolean; incurred_on: string; supplier: string | null; invoice: string | null; created_by: string | null;
  }[]>`
    select vc.id, vc.kind, vc.description, vc.amount, vc.currency, vc.fx_rate_to_base, vc.amount_base, vc.is_estimate,
           vc.incurred_on, s.name as supplier, si.invoice_number as invoice, u.full_name as created_by
    from public.vehicle_costs vc
    left join public.suppliers s on s.id = vc.supplier_id
    left join public.supplier_invoices si on si.id = vc.supplier_invoice_id
    left join public.user_profiles u on u.id = vc.created_by
    where vc.vehicle_id = ${id}
    order by vc.incurred_on, vc.created_at`);
}

export async function vehicleStatusHistory(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: number; dimension: string; from_status: string | null; to_status: string; note: string | null; actor: string | null; occurred_at: Date }[]>`
    select e.id, e.dimension, e.from_status, e.to_status, e.note, u.full_name as actor, e.occurred_at
    from public.vehicle_status_events e left join public.user_profiles u on u.id = e.actor_id
    where e.vehicle_id = ${id} order by e.occurred_at desc, e.id desc limit 100`);
}

export async function vehicleReservations(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; number: string; customer: string; customer_id: string; status: string; deposit_amount: string; currency: string; expires_at: Date; created_at: Date; close_reason: string | null }[]>`
    select r.id, r.number, c.full_name as customer, c.id as customer_id, r.status, r.deposit_amount, r.currency, r.expires_at, r.created_at, r.close_reason
    from public.reservations r join public.customers c on c.id = r.customer_id
    where r.vehicle_id = ${id} order by r.created_at desc`);
}

export async function vehicleDeals(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; number: string; customer: string; status: string; sale_price: string; currency: string; seller: string; created_at: Date }[]>`
    select d.id, d.number, c.full_name as customer, d.status, d.sale_price, d.currency, u.full_name as seller, d.created_at
    from public.deals d join public.customers c on c.id = d.customer_id join public.user_profiles u on u.id = d.seller_id
    where d.vehicle_id = ${id} order by d.created_at desc`);
}

export async function vehicleDocuments(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; title: string; mime_type: string; size_bytes: string; is_restricted: boolean; uploaded_at: Date; uploaded_by: string | null; type_name: string | null }[]>`
    select d.id, d.title, d.mime_type, d.size_bytes, d.is_restricted, d.uploaded_at, u.full_name as uploaded_by, t.name as type_name
    from public.documents d left join public.user_profiles u on u.id = d.uploaded_by left join public.document_types t on t.id = d.document_type_id
    where d.entity_type = 'vehicle' and d.entity_id = ${id} order by d.uploaded_at desc`);
}

export async function vehicleRequiredDocs(ctx: AppContext, id: string, condition: string) {
  return ctx.db((tx) => tx<{ id: string; name: string; is_required: boolean; present: boolean }[]>`
    select t.id, t.name, t.is_required,
           exists (select 1 from public.documents d where d.entity_type = 'vehicle' and d.entity_id = ${id} and d.document_type_id = t.id) as present
    from public.document_types t
    where t.org_id = ${ctx.org.id} and t.entity_type = 'vehicle' and (t.applies_to_condition is null or t.applies_to_condition = ${condition})
    order by t.is_required desc, t.name`);
}

export async function vehiclePhotos(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; is_cover: boolean }[]>`
    select id, is_cover from public.vehicle_photos where vehicle_id = ${id} order by is_cover desc, sort_order, uploaded_at`);
}

/** Opciones de unidades vendibles para selects (ventas, simulador). */
export async function sellableVehicles(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; label: string; price_currency: "PYG" | "USD"; list_price: string | null; min_price: string | null; commercial_status: string }[]>`
    select v.id, v.stock_code || ' · ' || b.name || ' ' || v.model || coalesce(' ' || v.version, '') || ' ' || v.year_model as label,
           v.price_currency, v.list_price, v.min_price, v.commercial_status
    from public.vehicles v join public.brands b on b.id = v.brand_id
    where v.org_id = ${ctx.org.id} and v.commercial_status in ('disponible','reservado')
    order by b.name, v.model`);
}
