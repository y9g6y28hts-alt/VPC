import "server-only";
import type { AppContext } from "@/server/auth/context";

export interface AppraisalRow {
  id: string; number: string; status: string; customer: string; customer_id: string; brand_name: string; model: string; version: string | null;
  year_model: number; mileage_km: number; vin: string | null; plate: string | null; color: string | null; fuel: string | null; transmission: string | null;
  doc_status: string; doc_notes: string | null; currency: "PYG" | "USD"; market_value_estimate: string | null; market_value_source: string | null;
  market_value_date: string | null; offered_value: string | null; accepted_value: string | null; expected_resale_price: string | null;
  estimated_repair_costs: string; appraiser_notes: string | null; appraiser: string | null; vehicle_id: string | null; created_at: Date;
  deal_id: string | null; deal_number: string | null;
}

export async function listAppraisals(ctx: AppContext, status?: string) {
  return ctx.db((tx) => tx<AppraisalRow[]>`
    select t.*, c.full_name as customer, u.full_name as appraiser,
           (select d.id from public.deals d where d.trade_in_appraisal_id = t.id and d.status <> 'anulada' limit 1) as deal_id,
           (select d.number from public.deals d where d.trade_in_appraisal_id = t.id and d.status <> 'anulada' limit 1) as deal_number
    from public.trade_in_appraisals t join public.customers c on c.id = t.customer_id
    left join public.user_profiles u on u.id = t.appraiser_id
    where t.org_id = ${ctx.org.id} ${status ? tx`and t.status = ${status}` : tx`and t.status not in ('anulada','rechazada')`}
    order by t.created_at desc limit 300`);
}

export async function getAppraisal(ctx: AppContext, id: string) {
  const [t] = await ctx.db((tx) => tx<AppraisalRow[]>`
    select t.*, c.full_name as customer, u.full_name as appraiser,
           (select d.id from public.deals d where d.trade_in_appraisal_id = t.id and d.status <> 'anulada' limit 1) as deal_id,
           (select d.number from public.deals d where d.trade_in_appraisal_id = t.id and d.status <> 'anulada' limit 1) as deal_number
    from public.trade_in_appraisals t join public.customers c on c.id = t.customer_id
    left join public.user_profiles u on u.id = t.appraiser_id
    where t.id = ${id} and t.org_id = ${ctx.org.id}`);
  return t ?? null;
}

export async function appraisalInspections(ctx: AppContext, id: string) {
  return ctx.db((tx) => tx<{ id: string; area: string; rating: string; notes: string | null; repair_estimate: string; inspected_by: string | null; inspected_at: Date }[]>`
    select i.id, i.area, i.rating, i.notes, i.repair_estimate, u.full_name as inspected_by, i.inspected_at
    from public.appraisal_inspections i left join public.user_profiles u on u.id = i.inspected_by
    where i.appraisal_id = ${id} order by i.area`);
}
