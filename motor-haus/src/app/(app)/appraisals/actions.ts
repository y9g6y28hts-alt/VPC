"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zDate, zOptText, zOptUuid, zText, zUuid } from "@/server/action";

const path = (id: string) => `/appraisals/${id}`;
const COND = z.enum(["excellent", "good", "fair", "poor"]).optional().or(z.literal("")).transform((v) => v || null);

export async function createAppraisalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ customer: zUuid, deal: zOptUuid, category: zText(), make: zText(2), model: zText(1), version: zOptText,
    year_built: z.string().regex(/^\d{4}$/, "Año inválido"), usage_value: z.string().optional(), usage_unit: z.enum(["km", "mi", "h"]),
    identifier_kind: z.enum(["vin", "chassis", "hull", "serial"]), identifier_value: zOptText, history_notes: zOptText, currency: z.enum(["USD", "PYG", "EUR"]) }), fd,
  async (i, db, ctx) => {
    const id = await db.rpc<string>("create_appraisal", { p_org: ctx.org.id, p_customer: i.customer, p_data: { ...i, usage_value: i.usage_value || null } });
    revalidatePath("/appraisals");
    return { message: "Tasación creada.", redirectTo: `${path(id)}${i.deal ? `?deal=${i.deal}` : ""}` };
  });
}

export async function inspectionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const items: Array<{ item: string; result: string; notes: string | null }> = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("res_") && v) items.push({ item: k.slice(4), result: String(v), notes: String(fd.get(`note_${k.slice(4)}`) ?? "") || null });
  }
  return runAction(z.object({ id: zUuid, body_condition: COND, interior_condition: COND, tires_condition: COND, mechanical_condition: COND,
    documentation_status: z.enum(["pending", "incomplete", "complete", "issues"]), inspector_report: zOptText }), fd, async (i, db) => {
    await db.rpc("record_appraisal_inspection", { p_appraisal: i.id, p_items: items, p_conditions: i });
    revalidatePath(path(i.id));
    return { message: "Inspección registrada." };
  });
}

export async function addCostAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, concept: z.enum(["reconditioning", "repairs", "tires", "documentation", "transport", "preparation", "other"]), amount: zAmount, description: zOptText }), fd,
    async (i, db) => {
      await db.rpc("add_appraisal_cost", { p_appraisal: i.id, p_concept: i.concept, p_amount: i.amount, p_description: i.description });
      revalidatePath(path(i.id));
    });
}

export async function removeCostAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, cost: zUuid }), fd, async (i, db) => {
    await db.rpc("remove_appraisal_cost", { p_cost: i.cost });
    revalidatePath(path(i.id));
  });
}

export async function valueAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, market_value: zAmount, market_source: zText(3, "Indique la fuente"), market_date: zDate, proposed: zAmount, resale: zAmount,
    uncertainty: z.enum(["low", "medium", "high"]), lien: z.string().optional() }), fd, async (i, db) => {
    await db.rpc("value_appraisal", { p_appraisal: i.id, p_market_value: i.market_value, p_market_source: i.market_source, p_market_date: i.market_date,
      p_proposed_price: i.proposed, p_expected_resale: i.resale, p_uncertainty: i.uncertainty, p_lien_payoff: i.lien?.trim() || 0 });
    revalidatePath(path(i.id));
    return { message: "Valoración registrada. Envíela para su autorización." };
  });
}

export async function submitAppraisalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid }), fd, async (i, db) => {
    const s = await db.rpc<string>("submit_appraisal", { p_appraisal: i.id });
    revalidatePath(path(i.id));
    return { message: s === "approved" ? "Dentro de los límites: aprobada con máximo = precio propuesto." : "Requiere autorización: solicitud enviada." };
  });
}

export async function closeAppraisalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, status: z.enum(["rejected", "withdrawn"]), note: zText(5, "Indique el motivo") }), fd, async (i, db) => {
    await db.rpc("close_appraisal", { p_appraisal: i.id, p_status: i.status, p_note: i.note });
    revalidatePath(path(i.id));
  });
}

export async function acquireAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, location: zUuid, received_on: zDate }), fd, async (i, db) => {
    const unit = await db.rpc<string>("acquire_trade_in", { p_appraisal: i.id, p_location: i.location, p_received_on: i.received_on });
    revalidatePath(path(i.id));
    return { message: "Unidad incorporada al inventario en preparación.", redirectTo: `/inventory/${unit}` };
  });
}

export async function reportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid }), fd, async (i, db, ctx) => {
    const doc = await db.rpc<string>("issue_document", { p_org: ctx.org.id, p_kind: "appraisal_report", p_entity_id: i.id, p_options: {} });
    return { redirectTo: `/documents/${doc}` };
  });
}
