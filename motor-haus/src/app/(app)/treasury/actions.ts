"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zDate, zOptText, zText, zUuid } from "@/server/action";

export async function movementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ account: zUuid, date: zDate, direction: z.enum(["in", "out"]), amount: zAmount,
    category: z.enum(["operating_expense", "payroll", "tax", "transfer", "owner_contribution", "owner_withdrawal", "financing", "adjustment", "other_income"]),
    description: zText(3, "Describa el movimiento"), reference: zOptText, counterparty: zOptText, status: z.enum(["posted", "pending"]) }), fd, async (i, db) => {
    await db.rpc("record_cash_movement", { p_account: i.account, p_date: i.date, p_amount: i.direction === "out" ? `-${i.amount}` : i.amount,
      p_category: i.category, p_description: i.description, p_reference: i.reference, p_counterparty: i.counterparty, p_status: i.status });
    revalidatePath("/treasury");
    return { message: "Movimiento registrado manualmente." };
  });
}

export async function postMovementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ movement: zUuid }), fd, async (i, db) => { await db.rpc("post_cash_movement", { p_movement: i.movement }); revalidatePath("/treasury"); });
}

export async function reverseMovementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ movement: zUuid, reason: zText(5, "Motivo") }), fd, async (i, db) => {
    await db.rpc("reverse_cash_movement", { p_movement: i.movement, p_reason: i.reason });
    revalidatePath("/treasury");
    return { message: "Contrapartida registrada." };
  });
}

export async function reconcileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ids = fd.getAll("movement").map(String);
  return runAction(z.object({ account: zUuid, statement_date: zDate, statement_balance: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "Saldo inválido"), notes: zOptText }), fd,
    async (i, db) => {
      await db.rpc("reconcile_account", { p_account: i.account, p_statement_date: i.statement_date, p_statement_balance: i.statement_balance, p_movement_ids: ids, p_notes: i.notes });
      revalidatePath("/treasury");
      return { message: "Conciliación registrada (con la diferencia calculada)." };
    });
}

export async function createAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ name: zText(3), kind: z.enum(["bank", "cash", "card_processor", "other"]), currency: z.enum(["USD", "PYG", "EUR", "BRL", "ARS"]),
    bank_name: zOptText, opening_balance: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "Saldo inválido"), opening_date: zDate }), fd, async (i, db, ctx) => {
    await db.rows(`insert into public.cash_accounts (organization_id, name, kind, currency, bank_name, opening_balance, opening_date) values ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.org.id, i.name, i.kind, i.currency, i.bank_name, i.opening_balance, i.opening_date]);
    revalidatePath("/treasury");
    return { message: "Cuenta creada (saldos registrados manualmente)." };
  });
}
