"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { compareDates } from "@/domain/dates";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCheckbox, zCurrency, zDate, zMoney, zOptionalText, zOptionalUuid, zPositiveMoney, zText, zUuid } from "@/lib/forms";
import { guarded, parseForm } from "@/server/action";

const supplierSchema = z.object({
  name: zText(2, "Indique el nombre"),
  tax_id: zOptionalText(),
  kind: z.enum(["vehiculos", "transporte", "reparacion", "documentacion", "general"]),
  phone: zOptionalText(),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().email("Correo inválido").optional()),
  address: zOptionalText(),
  notes: zOptionalText(),
});

export async function saveSupplier(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["suppliers.manage"], async (ctx) => {
    const id = String(formData.get("id") ?? "");
    const parsed = parseForm(supplierSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    if (v.tax_id && !/^\d{3,9}-\d$/.test(v.tax_id.replace(/\./g, ""))) return fail("RUC inválido (formato 80012345-6)", { fieldErrors: { tax_id: ["Formato inválido"] } });
    const row = { name: v.name, tax_id: v.tax_id ?? null, kind: v.kind, phone: v.phone ?? null, email: v.email ?? null, address: v.address ?? null, notes: v.notes ?? null };
    if (id) {
      await ctx.db((tx) => tx`update public.suppliers set ${tx(row)} where id = ${id} and org_id = ${ctx.org.id}`);
    } else {
      await ctx.db((tx) => tx`insert into public.suppliers ${tx({ ...row, org_id: ctx.org.id, created_by: ctx.userId })}`);
    }
    revalidatePath("/compras");
    return ok(id ? "Proveedor actualizado" : "Proveedor registrado");
  });
}

const invoiceSchema = z
  .object({
    supplier_id: zUuid("Seleccione el proveedor"),
    invoice_number: zText(3, "Indique el número de factura"),
    timbrado: zOptionalText(),
    issue_date: zDate(),
    due_date: zDate(),
    currency: zCurrency(),
    amount: zPositiveMoney(),
    tax_amount: zMoney(),
    concept: zText(3, "Describa el concepto"),
    category: z.enum(["vehiculo", "transporte", "reparacion", "documentacion", "general"]),
    vehicle_id: zOptionalUuid(),
    create_vehicle_cost: zCheckbox(),
    cost_kind: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["adquisicion", "transporte", "importacion", "reparacion", "preparacion", "documentacion", "comision", "otro"]).optional()),
  })
  .superRefine((v, c) => {
    if (compareDates(v.due_date, v.issue_date) < 0) c.addIssue({ code: "custom", path: ["due_date"], message: "El vencimiento no puede ser anterior a la emisión" });
    if (!isValidAmount(v.amount, v.currency)) c.addIssue({ code: "custom", path: ["amount"], message: "Decimales no válidos para la moneda" });
    if (v.tax_amount > v.amount) c.addIssue({ code: "custom", path: ["tax_amount"], message: "El IVA no puede superar el total" });
    if (v.create_vehicle_cost && !v.vehicle_id) c.addIssue({ code: "custom", path: ["vehicle_id"], message: "Seleccione la unidad para imputar el coste" });
  });

export async function createInvoice(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payables.create"], async (ctx) => {
    const parsed = parseForm(invoiceSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const [r] = await ctx.db((tx) => tx<{ id: string }[]>`select public.rpc_supplier_invoice_create(${tx.json({ ...v, cost_kind: v.cost_kind ?? v.category } as never)}) as id`);
    revalidatePath("/compras");
    revalidatePath("/aprobaciones");
    return ok("Factura registrada y enviada a aprobación", { id: r!.id });
  });
}

const paymentSchema = z.object({ invoice_id: zUuid(), paid_on: zDate(), amount: zPositiveMoney(), cash_account_id: zUuid("Seleccione la cuenta"), reference: zOptionalText(), confirm_now: zCheckbox() });

export async function registerSupplierPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payables.pay"], async (ctx) => {
    const parsed = parseForm(paymentSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const [r] = await ctx.db((tx) => tx<{ id: string }[]>`select public.rpc_supplier_payment_register(${tx.json(v as never)}) as id`);
    if (v.confirm_now) await ctx.db((tx) => tx`select public.rpc_supplier_payment_confirm(${r!.id})`);
    revalidatePath(`/compras/facturas/${v.invoice_id}`);
    revalidatePath("/compras");
    revalidatePath("/caja");
    return ok(v.confirm_now ? "Pago confirmado: se registró el egreso de caja" : "Pago registrado, pendiente de confirmación");
  });
}

export async function confirmSupplierPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["payables.pay"], async (ctx) => {
    const id = String(formData.get("payment_id") ?? "");
    await ctx.db((tx) => tx`select public.rpc_supplier_payment_confirm(${id})`);
    revalidatePath(`/compras/facturas/${String(formData.get("invoice_id") ?? "")}`);
    revalidatePath("/compras");
    revalidatePath("/caja");
    return ok("Pago confirmado: se registró el egreso de caja");
  });
}
