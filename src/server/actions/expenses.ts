"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCurrency, zDate, zOptionalText, zOptionalUuid, zPositiveMoney, zText, zUuid } from "@/lib/forms";
import { guarded, parseForm } from "@/server/action";

const expenseSchema = z.object({
  expense_date: zDate(),
  category: z.enum(["alquiler", "servicios", "sueldos", "comisiones", "marketing", "impuestos", "mantenimiento", "combustible", "oficina", "otro"]),
  description: zText(3, "Describa el gasto"),
  amount: zPositiveMoney(),
  currency: zCurrency(),
  supplier_id: zOptionalUuid(),
});

export async function createExpense(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["expenses.create"], async (ctx) => {
    const parsed = parseForm(expenseSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    if (!isValidAmount(v.amount, v.currency)) return fail("Decimales no válidos para la moneda", { fieldErrors: { amount: ["Decimales no válidos"] } });
    await ctx.db((tx) => tx`select public.rpc_expense_create(${ctx.org.id}, ${tx.json(v as never)})`);
    revalidatePath("/gastos");
    revalidatePath("/aprobaciones");
    return ok("Gasto registrado y enviado a aprobación");
  });
}

const paySchema = z.object({ expense_id: zUuid(), cash_account_id: zUuid("Seleccione la cuenta"), paid_on: zDate(), reference: zOptionalText() });

export async function payExpense(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["cash.register"], async (ctx) => {
    const parsed = parseForm(paySchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`select public.rpc_expense_pay(${v.expense_id}, ${v.cash_account_id}, ${v.paid_on}, ${v.reference ?? null})`);
    revalidatePath("/gastos");
    revalidatePath("/caja");
    return ok("Gasto pagado: egreso registrado en caja");
  });
}
