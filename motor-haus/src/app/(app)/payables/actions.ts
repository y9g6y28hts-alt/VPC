"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zDate, zOptDate, zOptText, zOptUuid, zText, zUuid } from "@/server/action";

export async function createPayableAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ supplier_id: zUuid, document_type: z.enum(["invoice", "receipt", "debit_note", "other"]), document_number: zText(1), concept: zText(3),
    category: z.enum(["vehicle_purchase", "logistics", "customs", "taxes", "services", "maintenance", "operating", "other"]), unit_id: zOptUuid,
    amount: zAmount, currency: z.enum(["USD", "PYG", "EUR", "BRL", "ARS"]), issue_date: zDate, due_date: zDate, notes: zOptText }), fd, async (i, db, ctx) => {
    await db.rpc("create_supplier_payable", { p_org: ctx.org.id, p_data: i });
    revalidatePath("/payables");
    return { message: "Factura registrada; queda pendiente de aprobación por otro usuario." };
  });
}

export async function payPayableAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ payable: zUuid, amount: zAmount, paid_on: zDate, cash_account: zUuid, reference: zOptText,
    fx_rate: z.string().optional(), fx_date: zOptDate, fx_source: zOptText }), fd, async (i, db) => {
    await db.rpc("pay_supplier_payable", { p_payable: i.payable, p_amount: i.amount, p_paid_on: i.paid_on, p_cash_account: i.cash_account, p_reference: i.reference,
      p_fx_rate: i.fx_rate?.trim() || null, p_fx_date: i.fx_date, p_fx_source: i.fx_source });
    revalidatePath("/payables");
    return { message: "Pago registrado con su movimiento de caja." };
  });
}

export async function cancelPayableAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ payable: zUuid, reason: zText(5, "Motivo") }), fd, async (i, db) => {
    await db.rpc("cancel_supplier_payable", { p_payable: i.payable, p_reason: i.reason });
    revalidatePath("/payables");
  });
}

export async function createSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ name: zText(2), kind: z.enum(["vehicle_seller", "logistics", "customs_broker", "workshop", "services", "operating", "other"]), country: zOptText, tax_id: zOptText }), fd,
    async (i, db, ctx) => {
      await db.rows("insert into public.suppliers (organization_id, name, kind, country, tax_id) values ($1, $2, $3, $4, $5)", [ctx.org.id, i.name, i.kind, i.country, i.tax_id]);
      revalidatePath("/payables");
      return { message: "Proveedor creado." };
    });
}
