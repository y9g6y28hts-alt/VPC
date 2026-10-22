"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { compareDates } from "@/domain/dates";
import { FinancingError, amortize } from "@/domain/financing/amortization";
import { monthlyRateFrom, normalizeRate } from "@/domain/financing/rates";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCheckbox, zCurrency, zDate, zInt, zNumber, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zPositiveMoney, zText, zUuid } from "@/lib/forms";
import { guarded, parseForm } from "@/server/action";
import { getToday } from "@/server/queries/common";

function refresh(contractId?: string | null) {
  if (contractId) revalidatePath(`/financiaciones/${contractId}`);
  revalidatePath("/cobranzas");
  revalidatePath("/financiaciones");
  revalidatePath("/caja");
}

const paymentSchema = z.object({
  customer_id: zUuid(),
  contract_id: zOptionalUuid(),
  reservation_id: zOptionalUuid(),
  received_on: zDate("Indique la fecha"),
  method: z.enum(["efectivo", "transferencia", "deposito", "cheque", "tarjeta"], { error: "Seleccione el medio" }),
  cash_account_id: zUuid("Seleccione la cuenta"),
  currency: zCurrency(),
  amount: zPositiveMoney(),
  reference: zOptionalText(),
  notes: zOptionalText(),
  allow_duplicate: zCheckbox(),
  confirm_now: zCheckbox(),
});

export async function registerPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payments.register"], async (ctx) => {
    const parsed = parseForm(paymentSchema, formData);
    if (!parsed.ok) return parsed.state;
    const p = parsed.data;
    if (!isValidAmount(p.amount, p.currency)) return fail(p.currency === "PYG" ? "Los guaraníes no llevan decimales" : "Máximo dos decimales", { fieldErrors: { amount: ["Decimales no válidos"] } });
    if (compareDates(p.received_on, await getToday(ctx)) > 0) return fail("La fecha de cobro no puede ser futura", { fieldErrors: { received_on: ["Fecha futura"] } });
    if (["transferencia", "deposito", "cheque"].includes(p.method) && !p.reference) {
      return fail("Indique la referencia (n.º de operación, depósito o cheque) para poder conciliar", { fieldErrors: { reference: ["Requerido para este medio"] } });
    }
    const [row] = await ctx.db((tx) => tx<{ id: string }[]>`select public.rpc_payment_register(${tx.json({
      customer_id: p.customer_id, contract_id: p.contract_id ?? null, reservation_id: p.reservation_id ?? null, received_on: p.received_on,
      method: p.method, cash_account_id: p.cash_account_id, currency: p.currency, amount: p.amount, reference: p.reference ?? null,
      notes: p.notes ?? null, allow_duplicate: p.allow_duplicate,
    } as never)}) as id`);
    let message = "Pago registrado. Queda pendiente de confirmación: aún no cuenta como cobro.";
    if (p.confirm_now && ctx.perms.has("payments.confirm")) {
      const [r] = await ctx.db((tx) => tx<{ unapplied: string }[]>`select public.rpc_payment_confirm(${row!.id}) as unapplied`);
      message = Number(r!.unapplied) > 0 ? "Pago confirmado. Una parte quedó como saldo a favor (no hay cuotas pendientes suficientes)." : "Pago confirmado y aplicado a las cuotas más antiguas.";
    }
    refresh(p.contract_id);
    return ok(message, { id: row!.id });
  });
}

export async function confirmPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payments.confirm"], async (ctx) => {
    const id = String(formData.get("payment_id") ?? "");
    const contractId = String(formData.get("contract_id") ?? "") || null;
    const [r] = await ctx.db((tx) => tx<{ unapplied: string }[]>`select public.rpc_payment_confirm(${id}) as unapplied`);
    refresh(contractId);
    return ok(Number(r!.unapplied) > 0 ? "Pago confirmado. Parte del importe quedó como saldo a favor." : "Pago confirmado y aplicado");
  });
}

export async function voidPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payments.register"], async (ctx) => {
    const id = String(formData.get("payment_id") ?? "");
    await ctx.db((tx) => tx`select public.rpc_payment_void(${id}, ${String(formData.get("reason") ?? "")})`);
    refresh(String(formData.get("contract_id") ?? "") || null);
    return ok("Pago anulado (no había sido confirmado)");
  });
}

export async function reversePayment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payments.reverse"], async (ctx) => {
    const id = String(formData.get("payment_id") ?? "");
    await ctx.db((tx) => tx`select public.rpc_payment_reverse(${id}, ${String(formData.get("reason") ?? "")})`);
    refresh(String(formData.get("contract_id") ?? "") || null);
    return ok("Pago revertido: se restituyó la deuda y se registró el egreso de caja");
  });
}

const adjustmentSchema = z.object({
  contract_id: zUuid(),
  kind: z.enum(["recargo", "nota_credito"]),
  amount: zPositiveMoney(),
  description: zText(3, "Describa el ajuste"),
  reason: zText(5, "Indique el motivo"),
  due_date: zOptionalDate(),
});

export async function requestAdjustment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["contracts.adjust"], async (ctx) => {
    const parsed = parseForm(adjustmentSchema, formData);
    if (!parsed.ok) return parsed.state;
    const a = parsed.data;
    await ctx.db((tx) => tx`select public.rpc_contract_request_adjustment(${a.contract_id}, ${a.kind}, ${a.amount}, ${a.description}, ${a.reason}, ${a.due_date ?? null})`);
    refresh(a.contract_id);
    revalidatePath("/aprobaciones");
    return ok("Solicitud enviada a aprobación. El saldo no cambia hasta que se apruebe.");
  });
}

const refinanceSchema = z.object({
  contract_id: zUuid(),
  method: z.enum(["frances", "aleman"]),
  rate: zNumber("Indique la tasa").refine((n) => n >= 0, "Tasa inválida"),
  convention: z.enum(["nominal_annual", "effective_annual", "monthly"]),
  term: zInt("Indique el plazo").refine((n) => n >= 1 && n <= 120, "Entre 1 y 120 meses"),
  first_due_date: zDate("Indique el primer vencimiento"),
  reason: zText(5, "Indique el motivo"),
  outstanding: zPositiveMoney(),
  currency: zCurrency(),
});

export async function requestRefinance(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["contracts.adjust"], async (ctx) => {
    const parsed = parseForm(refinanceSchema, formData);
    if (!parsed.ok) return parsed.state;
    const r = parsed.data;
    let rows;
    let monthly: number;
    try {
      monthly = normalizeRate(monthlyRateFrom(r.rate, r.convention));
      rows = amortize({ principal: r.outstanding, currency: r.currency, monthlyRate: monthly, termMonths: r.term, method: r.method, firstDueDate: r.first_due_date });
    } catch (e) {
      if (e instanceof FinancingError) return fail(e.message);
      throw e;
    }
    const plan = {
      method: r.method, rate_input: r.rate, rate_convention: r.convention, monthly_rate: monthly, term_months: r.term,
      first_due_date: r.first_due_date, balloons: [], total_interest: rows.totalInterest,
    };
    const schedule = rows.rows.map((x) => ({ kind: x.kind, due_date: x.dueDate, principal: x.principal, interest: x.interest, description: `Refinanciación — ${x.description}` }));
    await ctx.db((tx) => tx`select public.rpc_contract_request_refinance(${r.contract_id}, ${tx.json(plan as never)}, ${tx.json(schedule as never)}, ${r.reason})`);
    refresh(r.contract_id);
    revalidatePath("/aprobaciones");
    return ok("Refinanciación enviada a aprobación");
  });
}

const actionSchema = z
  .object({
    customer_id: zUuid(),
    contract_id: zOptionalUuid(),
    channel: z.enum(["llamada", "whatsapp", "visita", "email", "sms", "otro"]),
    result: z.enum(["contactado", "sin_respuesta", "numero_erroneo", "promesa_pago", "pago_informado", "negativa", "otro"]),
    notes: zOptionalText(),
    promise_amount: zOptionalMoney(),
    promise_currency: z.preprocess((v) => (v === "" ? undefined : v), zCurrency().optional()),
    promise_date: zOptionalDate(),
    next_action: zOptionalText(),
    next_action_at: zOptionalDate(),
  })
  .superRefine((v, c) => {
    if (v.result === "promesa_pago") {
      if (!v.promise_amount) c.addIssue({ code: "custom", path: ["promise_amount"], message: "Indique el importe prometido" });
      if (!v.promise_date) c.addIssue({ code: "custom", path: ["promise_date"], message: "Indique la fecha prometida" });
    }
  });

export async function registerCollectionAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["collections.manage"], async (ctx) => {
    const parsed = parseForm(actionSchema, formData);
    if (!parsed.ok) return parsed.state;
    const a = parsed.data;
    const promise = a.result === "promesa_pago";
    await ctx.db((tx) => tx`
      insert into public.collection_actions (org_id, customer_id, contract_id, channel, result, notes, promise_amount, promise_currency,
                                             promise_date, next_action, next_action_at, user_id)
      values (${ctx.org.id}, ${a.customer_id}, ${a.contract_id ?? null}, ${a.channel}, ${a.result}, ${a.notes ?? null},
              ${promise ? a.promise_amount! : null}, ${promise ? a.promise_currency ?? "PYG" : null}, ${promise ? a.promise_date! : null},
              ${a.next_action ?? null}, ${a.next_action_at ?? null}, ${ctx.userId})`);
    refresh(a.contract_id);
    revalidatePath(`/clientes/${a.customer_id}`);
    return ok(promise ? "Gestión registrada. La promesa NO se contabiliza como cobro." : "Gestión registrada");
  });
}
