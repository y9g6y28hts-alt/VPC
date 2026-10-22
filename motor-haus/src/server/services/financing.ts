import { buildPlan, ENGINE_VERSION, FinancingPlan, PlanInputs } from "@/domain/finance/engine";
import { CurrencyCode, Dec, moneyString } from "@/domain/finance/money";
import type { Db } from "../gateway";
import { DomainError } from "../errors";

export type ScenarioParams = Omit<PlanInputs, "principal" | "currency">;

export interface DealEconomics {
  deal_id: string;
  currency: CurrencyCode;
  total_list: number;
  total_negotiated: number;
  discount_amount: number;
  discount_pct: number;
  cost_actual: number;
  cost_estimated_pending: number;
  units_missing_purchase_cost: number;
  gross_margin_estimated: number;
  gross_margin_pct: number | null;
  gross_margin_actual_costs_only: number;
  financed_charges: number;
  cash_down_payment: number;
  other_credits: number;
  trade_in_credit: number;
  trade_in_estimated_margin: number;
  financed_principal: number;
  items: Array<{
    unit_id: string; stock_number: string; title: string; year: number | null; category: string;
    list_price: number; minimum_price: number; negotiated_price: number; discount: number;
    cost_actual: number; cost_estimated: number; has_purchase_cost: boolean; margin_estimated: number; margin_pct: number | null;
  }>;
  trade_ins: Array<{
    appraisal_id: string; number: string; title: string; accepted_value: number; lien_payoff: number; net_credit: number;
    max_authorized: number | null; expected_resale: number | null; recon_costs: number; estimated_margin: number | null;
    appraisal_status: string;
  }>;
}

export async function getDealEconomics(db: Db, dealId: string): Promise<DealEconomics> {
  return db.rpc<DealEconomics>("get_deal_economics", { p_deal: dealId });
}

/** Calcula el plan con el motor único usando el capital financiado validado por el servidor. */
export function computePlan(economics: DealEconomics, params: ScenarioParams): FinancingPlan {
  const currency = economics.currency;
  const principal = moneyString(new Dec(String(economics.financed_principal)), currency);
  if (new Dec(principal).isNegative()) {
    throw new DomainError("VALIDATION", "Los créditos iniciales superan el precio: el capital financiado sería negativo.");
  }
  return buildPlan({ ...params, currency, principal });
}

export async function saveScenario(db: Db, dealId: string, label: string, params: ScenarioParams): Promise<string> {
  const economics = await getDealEconomics(db, dealId);
  let plan: FinancingPlan;
  try {
    plan = computePlan(economics, params);
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("VALIDATION", (e as Error).message);
  }
  return db.rpc<string>("save_financing_plan", {
    p_deal: dealId,
    p_label: label,
    p_inputs: plan.inputs,
    p_summary: plan.summary,
    p_schedule: plan.schedule,
    p_engine_version: ENGINE_VERSION,
  });
}
