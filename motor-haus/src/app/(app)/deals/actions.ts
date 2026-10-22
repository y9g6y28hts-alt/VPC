"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zOptAmount, zOptDate, zOptText, zText, zUuid } from "@/server/action";
import { saveScenario } from "@/server/services/financing";
import type { AmortizationSystem, MonthsPerPeriod, RateType } from "@/domain/finance/engine";
import { Dec } from "@/domain/finance/money";
import { DomainError } from "@/server/errors";

const dealPath = (id: string) => `/deals/${id}`;

export async function createDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, customer: zUuid }), fd, async (i, db, ctx) => {
    const id = await db.rpc<string>("create_deal", { p_org: ctx.org.id, p_customer: i.customer, p_unit: i.unit });
    revalidatePath("/deals");
    return { message: "Operación creada.", redirectTo: dealPath(id) };
  });
}

export async function updateTermsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const items: Array<{ unit_id: string; negotiated_price: string }> = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("price_")) items.push({ unit_id: k.slice(6), negotiated_price: String(v).trim().replace(/,/g, ".") });
  }
  return runAction(z.object({ deal: zUuid, version: z.coerce.number().int(), cash_down: zOptAmount, other_credits: zOptAmount,
    other_credits_note: zOptText, financed_charges: zOptAmount, financed_charges_note: zOptText, notes: zOptText, valid_until: zOptDate }), fd,
  async (i, db) => {
    for (const it of items) if (!/^\d+(\.\d{1,2})?$/.test(it.negotiated_price)) throw new DomainError("VALIDATION", "Precio negociado inválido");
    await db.rpc("update_deal_terms", { p_deal: i.deal, p_items: items, p_cash_down: i.cash_down, p_other_credits: i.other_credits,
      p_other_credits_note: i.other_credits_note, p_financed_charges: i.financed_charges, p_financed_charges_note: i.financed_charges_note,
      p_notes: i.notes, p_valid_until: i.valid_until, p_expected_version: i.version });
    revalidatePath(dealPath(i.deal));
    return { message: "Términos guardados. Si cambiaron, la operación vuelve a borrador y los planes deben recalcularse." };
  });
}

export async function addUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, unit: zUuid }), fd, async (i, db) => {
    await db.rpc("add_deal_unit", { p_deal: i.deal, p_unit: i.unit });
    revalidatePath(dealPath(i.deal));
  });
}

export async function removeUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, unit: zUuid }), fd, async (i, db) => {
    await db.rpc("remove_deal_unit", { p_deal: i.deal, p_unit: i.unit });
    revalidatePath(dealPath(i.deal));
  });
}

export async function attachTradeInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, appraisal: zUuid, accepted: zAmount }), fd, async (i, db) => {
    await db.rpc("attach_trade_in", { p_deal: i.deal, p_appraisal: i.appraisal, p_accepted_value: i.accepted });
    revalidatePath(dealPath(i.deal));
    return { message: "Trade-in incorporado. Recalcule los planes de financiación." };
  });
}

export async function detachTradeInAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, appraisal: zUuid }), fd, async (i, db) => {
    await db.rpc("detach_trade_in", { p_deal: i.deal, p_appraisal: i.appraisal });
    revalidatePath(dealPath(i.deal));
  });
}

export async function saveScenarioAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const balloons: Array<{ period: number; amount: string }> = [];
  const periods = fd.getAll("balloon_period"), amounts = fd.getAll("balloon_amount");
  let badBalloon = false;
  periods.forEach((p, idx) => {
    const a = String(amounts[idx] ?? "").trim().replace(/,/g, ".");
    if (!String(p).trim() || !a) return;
    if (!/^\d+(\.\d{1,2})?$/.test(a) || !/^\d+$/.test(String(p).trim())) { badBalloon = true; return; }
    balloons.push({ period: Number(p), amount: new Dec(a).toFixed(2) });
  });
  return runAction(z.object({
    deal: zUuid, label: zText(1, "Nombre del escenario"), system: z.enum(["french", "german", "zero_interest"]),
    rate_type: z.enum(["effective_annual", "nominal_annual", "effective_monthly", "none"]),
    rate_pct: z.string().trim().regex(/^\d+(\.\d+)?$/, "Tasa inválida"), term: z.coerce.number().int().min(1).max(360),
    months_per_period: z.enum(["1", "2", "3", "6", "12"]), start_date: z.string(), first_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  }), fd, async (i, db) => {
    if (badBalloon) throw new DomainError("VALIDATION", "Refuerzo inválido: indique período entero e importe con punto decimal.");
    const zero = i.system === "zero_interest";
    await saveScenario(db, i.deal, i.label, {
      system: i.system as AmortizationSystem, rateType: (zero ? "none" : i.rate_type) as RateType,
      rate: zero ? "0" : new Dec(i.rate_pct).div(100).toString(), termPeriods: i.term,
      monthsPerPeriod: Number(i.months_per_period) as MonthsPerPeriod, startDate: i.start_date, firstDueDate: i.first_due,
      balloons: balloons.map((b) => ({ period: b.period, amount: b.amount })), upfront: [],
    });
    revalidatePath(dealPath(i.deal));
    return { message: "Escenario calculado y validado por el servidor." };
  });
}

export async function selectPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, plan: z.string() }), fd, async (i, db) => {
    await db.rpc("select_financing_plan", { p_deal: i.deal, p_plan: i.plan || null });
    revalidatePath(dealPath(i.deal));
  });
}

export async function submitDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid }), fd, async (i, db) => {
    const status = await db.rpc<string>("submit_deal", { p_deal: i.deal });
    revalidatePath(dealPath(i.deal));
    return { message: status === "approved" ? "Dentro de política: operación aprobada." : "Requiere autorización: se generaron las solicitudes." };
  });
}

export async function formalizeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid }), fd, async (i, db) => {
    const contract = await db.rpc<string>("formalize_deal", { p_deal: i.deal });
    revalidatePath("/contracts");
    return { message: "Contrato formalizado y obligaciones generadas.", redirectTo: `/contracts/${contract}` };
  });
}

export async function cancelDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, reason: zText(5, "Indique el motivo") }), fd, async (i, db) => {
    await db.rpc("cancel_deal", { p_deal: i.deal, p_reason: i.reason });
    revalidatePath(dealPath(i.deal));
    return { message: "Operación cancelada." };
  });
}

export async function issueProposalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, plan: z.string().optional() }), fd, async (i, db, ctx) => {
    const doc = await db.rpc<string>("issue_document", { p_org: ctx.org.id, p_kind: "proposal", p_entity_id: i.deal,
      p_options: i.plan ? { plan_id: i.plan } : {} });
    return { message: "Propuesta emitida.", redirectTo: `/documents/${doc}` };
  });
}

export async function reserveForDealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ deal: zUuid, unit: zUuid, customer: zUuid, hours: z.coerce.number().int().min(1), conditions: zText(5, "Condiciones") }), fd,
    async (i, db) => {
      await db.rpc("reserve_unit", { p_unit: i.unit, p_customer: i.customer, p_conditions: i.conditions, p_hours: i.hours, p_deal: i.deal });
      revalidatePath(dealPath(i.deal));
      return { message: "Unidad reservada para esta operación." };
    });
}
