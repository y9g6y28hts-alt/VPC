"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addDays, compareDates, isIsoDate } from "@/domain/dates";
import { FinancingError } from "@/domain/financing/amortization";
import { buildDealSchedule, toRpcPayload, type DealSchedule, type FinancingTerms } from "@/domain/financing/deal-schedule";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zDate, zOptionalText, zOptionalUuid, zUuid } from "@/lib/forms";
import { flash, guarded, parseForm } from "@/server/action";
import type { AppContext } from "@/server/auth/context";
import { getSettings, getToday } from "@/server/queries/common";
import { getDeal } from "@/server/queries/sales";

const termsSchema = z.object({
  method: z.enum(["frances", "aleman"]),
  ratePercent: z.number().min(0).max(240),
  rateConvention: z.enum(["nominal_annual", "effective_annual", "monthly"]),
  termMonths: z.number().int().min(1).max(120),
  firstDueDate: z.string().refine(isIsoDate, "Fecha inválida"),
  balloons: z.array(z.object({ index: z.number().int().min(1), amount: z.number().positive() })).max(60).default([]),
});

const dealPayload = z.object({
  id: z.string().uuid().optional(),
  customer_id: z.string().uuid({ error: "Seleccione el cliente" }),
  vehicle_id: z.string().uuid({ error: "Seleccione la unidad" }),
  discount: z.number().min(0),
  trade_in_appraisal_id: z.string().uuid().nullable().optional(),
  trade_in_value: z.number().min(0),
  down_payment: z.number().min(0),
  payment_type: z.enum(["contado", "financiado"]),
  terms: termsSchema.nullable().optional(),
  notes: z.string().max(2000).optional(),
  submit: z.boolean().default(false),
});

function readJson(formData: FormData): unknown {
  try {
    return JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return null;
  }
}

async function loadVehicle(ctx: AppContext, id: string) {
  const [v] = await ctx.db((tx) => tx<{ id: string; list_price: string | null; price_currency: "PYG" | "USD"; commercial_status: string }[]>`
    select id, list_price, price_currency, commercial_status from public.vehicles where id = ${id} and org_id = ${ctx.org.id}`);
  return v ?? null;
}

/** Crea o actualiza una operación en borrador y opcionalmente la envía. */
export async function saveDeal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.create"], async (ctx) => {
    const parsed = dealPayload.safeParse(readJson(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
    const p = parsed.data;
    const v = await loadVehicle(ctx, p.vehicle_id);
    if (!v) return fail("La unidad no existe");
    if (!v.list_price) return fail("La unidad no tiene precio de lista. Pida a gerencia comercial que lo cargue.");
    if (!["disponible", "reservado"].includes(v.commercial_status)) return fail("La unidad no está disponible para la venta");
    const cur = v.price_currency;
    for (const [label, n] of [["descuento", p.discount], ["trade-in", p.trade_in_value], ["entrega", p.down_payment]] as const) {
      if (!isValidAmount(n, cur)) return fail(`El ${label} tiene decimales no válidos para ${cur}`);
    }
    if (p.trade_in_value > 0 && !p.trade_in_appraisal_id) return fail("Seleccione la tasación del vehículo usado");
    if (p.trade_in_appraisal_id) {
      const [t] = await ctx.db((tx) => tx<{ customer_id: string; currency: string; status: string }[]>`
        select customer_id, currency, status from public.trade_in_appraisals where id = ${p.trade_in_appraisal_id!} and org_id = ${ctx.org.id}`);
      if (!t || t.customer_id !== p.customer_id) return fail("La tasación no corresponde al cliente");
      if (t.currency !== cur) return fail(`La tasación está en ${t.currency} y la unidad se vende en ${cur}`);
    }
    const today = await getToday(ctx);
    let schedule: DealSchedule;
    try {
      schedule = buildDealSchedule({
        currency: cur,
        listPrice: Number(v.list_price),
        discount: p.discount,
        tradeInValue: p.trade_in_value,
        downPayment: p.down_payment,
        operationDate: today,
        financing: p.payment_type === "financiado" ? (p.terms as FinancingTerms | undefined) ?? null : null,
      });
    } catch (e) {
      if (e instanceof FinancingError) return fail(e.message);
      throw e;
    }
    if (p.payment_type === "contado" && schedule.financedAmount > 0) {
      return fail("En contado, la entrega y el trade-in deben cubrir el precio de venta");
    }
    if (p.payment_type === "financiado" && schedule.financedAmount === 0) {
      return fail("No queda saldo a financiar: elija contado");
    }
    const terms = p.payment_type === "financiado" ? p.terms : null;

    const id = await ctx.db(async (tx) => {
      if (p.id) {
        const res = await tx<{ id: string }[]>`
          update public.deals set customer_id = ${p.customer_id}, vehicle_id = ${p.vehicle_id}, currency = ${cur},
            list_price = ${v.list_price}, discount_amount = ${p.discount}, trade_in_appraisal_id = ${p.trade_in_appraisal_id ?? null},
            trade_in_value = ${p.trade_in_value}, down_payment = ${p.down_payment}, payment_type = ${p.payment_type},
            financing_terms = ${terms ? tx.json(terms as never) : null}, notes = ${p.notes ?? null}
          where id = ${p.id} and org_id = ${ctx.org.id} and status = 'borrador' returning id`;
        if (!res.length) throw Object.assign(new Error("Sólo se editan operaciones en borrador propias o de su equipo"), { code: "P0001" });
        return p.id;
      }
      const [row] = await tx<{ id: string }[]>`
        insert into public.deals (org_id, customer_id, vehicle_id, seller_id, currency, list_price, discount_amount,
                                  trade_in_appraisal_id, trade_in_value, down_payment, payment_type, financing_terms, notes, created_by)
        values (${ctx.org.id}, ${p.customer_id}, ${p.vehicle_id}, ${ctx.userId}, ${cur}, ${v.list_price}, ${p.discount},
                ${p.trade_in_appraisal_id ?? null}, ${p.trade_in_value}, ${p.down_payment}, ${p.payment_type},
                ${terms ? tx.json(terms as never) : null}, ${p.notes ?? null}, ${ctx.userId})
        returning id`;
      return row!.id;
    });

    let message = p.id ? "Borrador actualizado" : "Operación creada en borrador";
    if (p.submit) {
      const [r] = await ctx.db((tx) => tx<{ s: string }[]>`select public.rpc_deal_submit(${id}) as s`);
      message = r!.s === "aprobada" ? "Operación lista para formalizar" : "Operación enviada a aprobación";
    }
    revalidatePath("/ventas");
    return ok(message, { id });
  });
}

const idOnly = z.object({ deal_id: zUuid() });

export async function submitDeal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.create"], async (ctx) => {
    const parsed = parseForm(idOnly, formData);
    if (!parsed.ok) return parsed.state;
    const [r] = await ctx.db((tx) => tx<{ s: string }[]>`select public.rpc_deal_submit(${parsed.data.deal_id}) as s`);
    revalidatePath(`/ventas/${parsed.data.deal_id}`);
    revalidatePath("/ventas");
    return ok(r!.s === "aprobada" ? "Operación aprobada: lista para formalizar" : "Enviada a aprobación de gerencia");
  });
}

export async function reopenDeal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.create"], async (ctx) => {
    const parsed = parseForm(idOnly, formData);
    if (!parsed.ok) return parsed.state;
    await ctx.db((tx) => tx`select public.rpc_deal_reopen(${parsed.data.deal_id})`);
    revalidatePath(`/ventas/${parsed.data.deal_id}`);
    return ok("La operación volvió a borrador");
  });
}

export async function cancelDeal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.create", "deals.cancel"], async (ctx) => {
    const id = String(formData.get("deal_id") ?? "");
    await ctx.db((tx) => tx`select public.rpc_deal_cancel(${id}, ${String(formData.get("reason") ?? "")})`);
    revalidatePath(`/ventas/${id}`);
    revalidatePath("/ventas");
    revalidatePath("/inventario");
    return ok("Operación anulada");
  });
}

const formalizeSchema = z.object({
  deal_id: zUuid(),
  signed_on: zDate("Indique la fecha de firma"),
  first_due_date: z.preprocess((v) => (v === "" ? undefined : v), z.string().refine(isIsoDate, "Fecha inválida").optional()),
  collector_id: zOptionalUuid(),
});

export async function formalizeDeal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.formalize"], async (ctx) => {
    const parsed = parseForm(formalizeSchema, formData);
    if (!parsed.ok) return parsed.state;
    const f = parsed.data;
    const today = await getToday(ctx);
    if (compareDates(f.signed_on, today) > 0) return fail("La fecha de firma no puede ser futura", { fieldErrors: { signed_on: ["Fecha futura"] } });
    const d = await getDeal(ctx, f.deal_id);
    if (!d) return fail("La operación no existe");
    const terms = d.financing_terms ? { ...d.financing_terms, firstDueDate: f.first_due_date ?? d.financing_terms.firstDueDate } : null;
    let schedule: DealSchedule;
    try {
      schedule = buildDealSchedule({
        currency: d.currency,
        listPrice: Number(d.list_price),
        discount: Number(d.discount_amount),
        tradeInValue: Number(d.trade_in_value),
        downPayment: Number(d.down_payment),
        operationDate: f.signed_on,
        financing: d.payment_type === "financiado" ? terms : null,
      });
    } catch (e) {
      if (e instanceof FinancingError) return fail(e.message, { fieldErrors: { first_due_date: [e.message] } });
      throw e;
    }
    const payload = toRpcPayload(schedule);
    const [r] = await ctx.db((tx) => tx<{ id: string }[]>`
      select public.rpc_deal_formalize(${f.deal_id}, ${f.signed_on}, ${tx.json(payload.plan as never)}, ${tx.json(payload.schedule as never)},
                                       ${f.collector_id ?? null}) as id`);
    revalidatePath("/ventas");
    revalidatePath("/inventario");
    await flash("Venta formalizada: contrato y plan de pagos generados");
    redirect(`/financiaciones/${r!.id}`);
  });
}

const deliverSchema = z.object({ deal_id: zUuid(), delivered_on: zDate(), notes: zOptionalText() });

export async function deliverDeal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.deliver"], async (ctx) => {
    const parsed = parseForm(deliverSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`select public.rpc_deal_deliver(${v.deal_id}, ${v.delivered_on}, ${v.notes ?? null})`);
    revalidatePath(`/ventas/${v.deal_id}`);
    revalidatePath("/ventas");
    revalidatePath("/inventario");
    return ok("Entrega registrada");
  });
}

// ----------------------------------------------------------------- propuestas

const proposalPayload = z.object({
  customer_id: z.string().uuid({ error: "Seleccione el cliente para generar la propuesta" }),
  vehicle_id: z.string().uuid({ error: "Seleccione la unidad para generar la propuesta" }),
  deal_id: z.string().uuid().nullable().optional(),
  discount: z.number().min(0),
  trade_in_value: z.number().min(0),
  trade_in_label: z.string().nullable().optional(),
  down_payment: z.number().min(0),
  terms: termsSchema.nullable().optional(),
  conditions: z.string().max(2000).optional(),
});

/** Guarda una instantánea inmutable de la cotización y devuelve su id para el PDF. */
export async function createProposal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.create"], async (ctx) => {
    const parsed = proposalPayload.safeParse(readJson(formData));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
    const p = parsed.data;
    const v = await loadVehicle(ctx, p.vehicle_id);
    if (!v?.list_price) return fail("La unidad no tiene precio de lista");
    const [veh] = await ctx.db((tx) => tx<Record<string, string | number | null>[]>`
      select v.stock_code, b.name as brand, v.model, v.version, v.year_model, v.mileage_km, v.color, v.condition, v.fuel, v.transmission
      from public.vehicles v join public.brands b on b.id = v.brand_id where v.id = ${p.vehicle_id}`);
    const [cus] = await ctx.db((tx) => tx<Record<string, string | null>[]>`
      select full_name, doc_type, doc_number, phone, email from public.customers where id = ${p.customer_id} and org_id = ${ctx.org.id}`);
    if (!cus) return fail("No tiene acceso al cliente");
    const [today, settings] = await Promise.all([getToday(ctx), getSettings(ctx)]);
    let schedule: DealSchedule;
    try {
      schedule = buildDealSchedule({
        currency: v.price_currency,
        listPrice: Number(v.list_price),
        discount: p.discount,
        tradeInValue: p.trade_in_value,
        downPayment: p.down_payment,
        operationDate: today,
        financing: (p.terms as FinancingTerms | null | undefined) ?? null,
      });
    } catch (e) {
      if (e instanceof FinancingError) return fail(e.message);
      throw e;
    }
    const [seller] = await ctx.db((tx) => tx<{ full_name: string; phone: string | null }[]>`select full_name, phone from public.user_profiles where id = ${ctx.userId}`);
    const snapshot = {
      issued_on: today,
      customer: cus,
      vehicle: veh,
      seller: seller ?? null,
      trade_in_label: p.trade_in_label ?? null,
      schedule,
      conditions: p.conditions ?? null,
      org: { name: ctx.org.name, is_demo: ctx.org.isDemo },
    };
    const [row] = await ctx.db((tx) => tx<{ id: string }[]>`
      insert into public.proposals (org_id, customer_id, vehicle_id, deal_id, currency, terms, valid_until, created_by)
      values (${ctx.org.id}, ${p.customer_id}, ${p.vehicle_id}, ${p.deal_id ?? null}, ${v.price_currency}, ${tx.json(snapshot as never)},
              ${addDays(today, settings.proposal_validity_days)}, ${ctx.userId})
      returning id`);
    return ok("Propuesta generada", { id: row!.id });
  });
}
