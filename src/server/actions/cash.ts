"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCurrency, zDate, zNumber, zOptionalText, zPositiveMoney, zText, zUuid } from "@/lib/forms";
import { flash, guarded, parseForm } from "@/server/action";

const movementSchema = z.object({
  account_id: zUuid("Seleccione la cuenta"),
  occurred_on: zDate(),
  direction: z.enum(["ingreso", "egreso"]),
  kind: z.enum(["apertura", "ajuste", "otro"]),
  amount: zPositiveMoney(),
  description: zText(3, "Describa el movimiento"),
  reference: zOptionalText(),
  counterparty: zOptionalText(),
});

export async function createMovement(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["cash.register"], async (ctx) => {
    const parsed = parseForm(movementSchema, formData);
    if (!parsed.ok) return parsed.state;
    await ctx.db((tx) => tx`select public.rpc_cash_movement_create(${tx.json(parsed.data as never)})`);
    revalidatePath("/caja");
    return ok("Movimiento registrado");
  });
}

const transferSchema = z.object({ from: zUuid("Cuenta de origen"), to: zUuid("Cuenta de destino"), amount: zPositiveMoney(), date: zDate(), description: zText(3, "Describa la transferencia") });

export async function transferFunds(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["cash.register"], async (ctx) => {
    const parsed = parseForm(transferSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`select public.rpc_cash_transfer(${v.from}, ${v.to}, ${v.amount}, ${v.date}, ${v.description})`);
    revalidatePath("/caja");
    return ok("Transferencia registrada (egreso e ingreso enlazados)");
  });
}

export async function reverseMovement(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["cash.reverse"], async (ctx) => {
    await ctx.db((tx) => tx`select public.rpc_cash_movement_reverse(${String(formData.get("movement_id") ?? "")}, ${String(formData.get("reason") ?? "")})`);
    revalidatePath("/caja");
    return ok("Movimiento revertido con un contraasiento");
  });
}

export async function createReconciliation(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["cash.reconcile"], async (ctx) => {
    const account = String(formData.get("account_id") ?? "");
    const periodEnd = String(formData.get("period_end") ?? "");
    const ids = formData.getAll("movement_ids").map(String);
    const statement = zNumber().safeParse(String(formData.get("statement_balance") ?? ""));
    if (!statement.success) return fail("Ingrese el saldo del extracto", { fieldErrors: { statement_balance: ["Requerido"] } });
    const [acc] = await ctx.db((tx) => tx<{ currency: "PYG" | "USD" }[]>`select currency from public.cash_accounts where id = ${account}`);
    if (!acc || !isValidAmount(statement.data, acc.currency)) return fail("Saldo con decimales no válidos para la moneda");
    await ctx.db((tx) => tx`select public.rpc_reconciliation_create(${account}, ${periodEnd}, ${statement.data}, ${ids}, ${String(formData.get("notes") ?? "") || null})`);
    revalidatePath("/caja");
    await flash(`Conciliación registrada: ${ids.length} movimiento(s) marcados como conciliados`);
    redirect("/caja?vista=conciliaciones");
  });
}

const rateSchema = z.object({ rate_date: zDate(), from_currency: zCurrency(), to_currency: zCurrency(), rate: zNumber("Ingrese el tipo de cambio").refine((n) => n > 0, "Debe ser mayor que cero"), source: zOptionalText() });

export async function addExchangeRate(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage", "cash.reconcile"], async (ctx) => {
    const parsed = parseForm(rateSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    if (v.from_currency === v.to_currency) return fail("Elija monedas distintas");
    await ctx.db((tx) => tx`insert into public.exchange_rates (org_id, rate_date, from_currency, to_currency, rate, source, created_by)
                            values (${ctx.org.id}, ${v.rate_date}, ${v.from_currency}, ${v.to_currency}, ${v.rate}, ${v.source ?? "manual"}, ${ctx.userId})`);
    revalidatePath("/caja");
    return ok("Tipo de cambio registrado");
  });
}

const accountSchema = z.object({ name: zText(3, "Indique el nombre"), kind: z.enum(["caja", "banco", "billetera"]), currency: zCurrency(), bank_name: zOptionalText(), account_ref: zOptionalText() });

export async function createCashAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage", "cash.reconcile"], async (ctx) => {
    const parsed = parseForm(accountSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`insert into public.cash_accounts ${tx({ ...v, bank_name: v.bank_name ?? null, account_ref: v.account_ref ?? null, org_id: ctx.org.id })}`);
    revalidatePath("/caja");
    return ok("Cuenta creada. Registre su saldo inicial como movimiento de apertura.");
  });
}
