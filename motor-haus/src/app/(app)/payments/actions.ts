"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zDate, zOptText, zOptUuid, zText, zUuid } from "@/server/action";
import { DomainError } from "@/server/errors";

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const manual: Array<{ installment_id: string; amount: string }> = [];
  for (const [k, v] of fd.entries()) {
    const val = String(v).trim().replace(/,/g, ".");
    if (k.startsWith("alloc_") && val) manual.push({ installment_id: k.slice(6), amount: val });
  }
  return runAction(z.object({
    customer: zUuid, contract: zOptUuid, amount: zAmount, currency: z.enum(["USD", "PYG", "EUR", "BRL", "ARS"]), effective_date: zDate,
    method: z.enum(["transfer", "cash", "card", "check", "other"]), reference: zOptText, cash_account: zUuid,
    idempotency_key: z.string().min(8), notes: zOptText, mode: z.enum(["auto", "manual", "none"]),
  }), fd, async (i, db, ctx) => {
    if (i.mode === "manual" && manual.some((m) => !/^\d+(\.\d{1,2})?$/.test(m.amount))) throw new DomainError("VALIDATION", "Importe de asignación inválido");
    const id = await db.rpc<string>("record_customer_payment", {
      p_org: ctx.org.id, p_customer: i.customer, p_contract: i.contract, p_amount: i.amount, p_currency: i.currency,
      p_effective_date: i.effective_date, p_method: i.method, p_reference: i.reference, p_cash_account: i.cash_account,
      p_idempotency_key: i.idempotency_key, p_notes: i.notes,
      p_allocations: i.mode === "auto" ? null : i.mode === "none" ? [] : manual.filter((m) => Number(m.amount) > 0),
    });
    revalidatePath("/payments");
    revalidatePath(`/receivables/${i.customer}`);
    return { message: "Pago registrado como pendiente de conciliación. No cuenta como cobrado hasta su confirmación.", redirectTo: `/payments?focus=${id}` };
  });
}

const simple = (fn: string, msg: string, needsReason = false) => async (_: ActionState, fd: FormData): Promise<ActionState> =>
  runAction(z.object({ payment: zUuid, reason: needsReason ? zText(5, "Indique el motivo (mín. 5 caracteres)") : zOptText }), fd, async (i, db) => {
    await db.rpc(fn, fn === "confirm_payment" ? { p_payment: i.payment, p_note: i.reason } : { p_payment: i.payment, p_reason: i.reason });
    revalidatePath("/payments");
    return { message: msg };
  });

export async function confirmPaymentAction(s: ActionState, fd: FormData) { return simple("confirm_payment", "Pago confirmado y contabilizado en caja.")(s, fd); }
export async function rejectPaymentAction(s: ActionState, fd: FormData) { return simple("reject_payment", "Pago rechazado.", true)(s, fd); }
export async function reversePaymentAction(s: ActionState, fd: FormData) { return simple("reverse_payment", "Pago revertido: deja de contar como cobrado y se registró la contrapartida de caja.", true)(s, fd); }

export async function autoAllocateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ payment: zUuid }), fd, async (i, db) => {
    await db.rpc("allocate_payment", { p_payment: i.payment, p_allocations: null });
    revalidatePath("/payments");
    return { message: "Asignación recalculada (cuotas más antiguas primero)." };
  });
}
