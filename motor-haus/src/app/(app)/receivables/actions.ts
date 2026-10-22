"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zOptDate, zOptText, zOptUuid, zText, zUuid } from "@/server/action";
import { DomainError } from "@/server/errors";

export async function logCollectionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({
    customer: zUuid, contract: zOptUuid, channel: z.enum(["phone", "whatsapp", "email", "in_person", "letter", "other"]),
    outcome: z.enum(["no_answer", "contacted", "promise", "refused", "wrong_contact", "dispute", "other"]),
    promise_amount: z.string().optional(), promise_currency: z.string().optional(), promise_date: zOptDate,
    next_action: zOptText, next_action_date: zOptDate, notes: zOptText,
  }), fd, async (i, db, ctx) => {
    const amount = i.promise_amount?.trim().replace(/,/g, ".") || null;
    if (i.outcome === "promise" && (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || !i.promise_date)) {
      throw new DomainError("VALIDATION", "Un compromiso de pago requiere importe y fecha prometida.");
    }
    await db.rpc("log_collection_action", { p_org: ctx.org.id, p_customer: i.customer, p_contract: i.contract, p_channel: i.channel,
      p_outcome: i.outcome, p_promise_amount: i.outcome === "promise" ? amount : null, p_promise_currency: i.outcome === "promise" ? i.promise_currency : null,
      p_promise_date: i.outcome === "promise" ? i.promise_date : null, p_next_action: i.next_action, p_next_action_date: i.next_action_date, p_notes: i.notes });
    revalidatePath(`/receivables/${i.customer}`);
    return { message: "Gestión registrada. Un compromiso no se contabiliza como pago." };
  });
}

export async function adjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ customer: zUuid, installment: zUuid, kind: z.enum(["credit_note", "late_fee", "interest", "discount", "write_off"]),
    amount: zAmount, reason: zText(5, "Fundamente el ajuste") }), fd, async (i, db) => {
    const signed = ["credit_note", "discount", "write_off"].includes(i.kind) ? `-${i.amount}` : i.amount;
    await db.rpc("register_installment_adjustment", { p_installment: i.installment, p_kind: i.kind, p_amount: signed, p_reason: i.reason });
    revalidatePath(`/receivables/${i.customer}`);
    return { message: "Ajuste registrado de forma auditable." };
  });
}

export async function notifyIntentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ customer: zUuid, contract: zOptUuid, channel: z.enum(["whatsapp", "email", "sms"]) }), fd, async (i, db, ctx) => {
    await db.rpc("register_notification_intent", { p_org: ctx.org.id, p_customer: i.customer, p_channel: i.channel,
      p_template: "recordatorio_cuota_vencida", p_payload: { contract: i.contract } });
    revalidatePath(`/receivables/${i.customer}`);
    return { message: "Intención registrada. NO se envió ningún mensaje: no hay un canal de mensajería integrado." };
  });
}

export async function issueContractDocAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ contract: zUuid, kind: z.enum(["account_statement", "payment_schedule", "sales_contract", "delivery_record"]),
    from: zOptDate, to: zOptDate }), fd, async (i, db, ctx) => {
    const doc = await db.rpc<string>("issue_document", { p_org: ctx.org.id, p_kind: i.kind, p_entity_id: i.contract,
      p_options: i.kind === "account_statement" ? { from: i.from, to: i.to } : {} });
    return { message: "Documento emitido.", redirectTo: `/documents/${doc}` };
  });
}
