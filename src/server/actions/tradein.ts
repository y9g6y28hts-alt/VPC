"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCurrency, zDate, zInt, zMoney, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zText, zUuid } from "@/lib/forms";
import { flash, guarded, parseForm } from "@/server/action";

const FUELS = ["nafta", "diesel", "hibrido", "hibrido_enchufable", "electrico", "gnc", "otro"] as const;
const TRANSMISSIONS = ["manual", "automatica", "cvt", "dct", "otra"] as const;

const appraisalSchema = z
  .object({
    customer_id: zUuid("Seleccione el cliente"),
    brand_name: zText(2, "Indique la marca"),
    model: zText(1, "Indique el modelo"),
    version: zOptionalText(),
    year_model: zInt("Año inválido").refine((y) => y >= 1950 && y <= 2101, "Año inválido"),
    mileage_km: zInt("Kilometraje inválido").refine((n) => n >= 0, "Kilometraje inválido"),
    vin: zOptionalText(),
    plate: zOptionalText(),
    color: zOptionalText(),
    fuel: z.enum(FUELS),
    transmission: z.enum(TRANSMISSIONS),
    doc_status: z.enum(["sin_revisar", "completa", "observada", "con_gravamen"]),
    doc_notes: zOptionalText(),
    currency: zCurrency(),
    market_value_estimate: zOptionalMoney(),
    market_value_source: zOptionalText(),
    market_value_date: zOptionalDate(),
    offered_value: zOptionalMoney(),
    expected_resale_price: zOptionalMoney(),
    estimated_repair_costs: zMoney(),
    appraiser_notes: zOptionalText(),
  })
  .superRefine((v, c) => {
    if (v.market_value_estimate !== undefined && (!v.market_value_source || !v.market_value_date)) {
      c.addIssue({ code: "custom", path: ["market_value_source"], message: "Un valor de mercado requiere fuente y fecha" });
    }
    for (const k of ["market_value_estimate", "offered_value", "expected_resale_price", "estimated_repair_costs"] as const) {
      const n = v[k];
      if (n !== undefined && !isValidAmount(n, v.currency)) c.addIssue({ code: "custom", path: [k], message: "Decimales no válidos para la moneda" });
    }
  });

function values(v: z.infer<typeof appraisalSchema>) {
  return {
    customer_id: v.customer_id, brand_name: v.brand_name, model: v.model, version: v.version ?? null, year_model: v.year_model,
    mileage_km: v.mileage_km, vin: v.vin?.toUpperCase() ?? null, plate: v.plate?.toUpperCase() ?? null, color: v.color ?? null, fuel: v.fuel,
    transmission: v.transmission, doc_status: v.doc_status, doc_notes: v.doc_notes ?? null, currency: v.currency,
    market_value_estimate: v.market_value_estimate ?? null, market_value_source: v.market_value_source ?? null,
    market_value_date: v.market_value_date ?? null, offered_value: v.offered_value ?? null, expected_resale_price: v.expected_resale_price ?? null,
    estimated_repair_costs: v.estimated_repair_costs, appraiser_notes: v.appraiser_notes ?? null,
  };
}

export async function createAppraisal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["tradein.create"], async (ctx) => {
    const parsed = parseForm(appraisalSchema, formData);
    if (!parsed.ok) return parsed.state;
    const [row] = await ctx.db((tx) => tx<{ id: string }[]>`
      insert into public.trade_in_appraisals ${tx({ ...values(parsed.data), org_id: ctx.org.id, appraiser_id: ctx.userId, created_by: ctx.userId })}
      returning id`);
    revalidatePath("/tradein");
    return ok("Tasación creada en borrador. Registre la inspección y envíela a revisión.", { id: row!.id });
  });
}

export async function updateAppraisal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["tradein.create"], async (ctx) => {
    const id = String(formData.get("id") ?? "");
    const parsed = parseForm(appraisalSchema, formData);
    if (!parsed.ok) return parsed.state;
    const res = await ctx.db((tx) => tx`update public.trade_in_appraisals set ${tx(values(parsed.data))} where id = ${id} and org_id = ${ctx.org.id} returning id`);
    if (!res.length) return fail("Sólo se editan tasaciones en borrador o rechazadas");
    revalidatePath(`/tradein/${id}`);
    return ok("Tasación actualizada", { id });
  });
}

const inspectionSchema = z.object({
  appraisal_id: zUuid(),
  area: z.enum(["mecanica", "carroceria", "neumaticos", "interior", "electronica", "documentacion", "otro"]),
  rating: z.enum(["bueno", "regular", "malo", "no_evaluado"]),
  notes: zOptionalText(),
  repair_estimate: zMoney(),
});

export async function saveInspection(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["tradein.create"], async (ctx) => {
    const parsed = parseForm(inspectionSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db(async (tx) => {
      const upd = await tx`update public.appraisal_inspections set rating = ${v.rating}, notes = ${v.notes ?? null}, repair_estimate = ${v.repair_estimate},
                           inspected_by = ${ctx.userId}, inspected_at = now()
                           where appraisal_id = ${v.appraisal_id} and area = ${v.area} returning id`;
      if (!upd.length) {
        await tx`insert into public.appraisal_inspections (org_id, appraisal_id, area, rating, notes, repair_estimate, inspected_by)
                 values (${ctx.org.id}, ${v.appraisal_id}, ${v.area}, ${v.rating}, ${v.notes ?? null}, ${v.repair_estimate}, ${ctx.userId})`;
      }
      // Las reparaciones estimadas de la tasación son la suma de las inspecciones.
      await tx`update public.trade_in_appraisals set estimated_repair_costs =
                 (select coalesce(sum(repair_estimate), 0) from public.appraisal_inspections where appraisal_id = ${v.appraisal_id})
               where id = ${v.appraisal_id}`;
    });
    revalidatePath(`/tradein/${v.appraisal_id}`);
    return ok("Inspección registrada");
  });
}

export async function submitAppraisal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["tradein.create"], async (ctx) => {
    const id = String(formData.get("appraisal_id") ?? "");
    await ctx.db((tx) => tx`select public.rpc_tradein_submit(${id})`);
    revalidatePath(`/tradein/${id}`);
    revalidatePath("/aprobaciones");
    return ok("Tasación enviada a revisión de gerencia");
  });
}

const decisionSchema = z.object({ appraisal_id: zUuid(), decision: z.enum(["acepta", "rechaza"]), accepted_value: zOptionalMoney() });

export async function customerDecision(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["tradein.create"], async (ctx) => {
    const parsed = parseForm(decisionSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    if (v.decision === "acepta" && !v.accepted_value) return fail("Indique el valor aceptado", { fieldErrors: { accepted_value: ["Requerido"] } });
    await ctx.db((tx) => tx`select public.rpc_tradein_customer_decision(${v.appraisal_id}, ${v.decision === "acepta"}, ${v.accepted_value ?? null})`);
    revalidatePath(`/tradein/${v.appraisal_id}`);
    return ok(v.decision === "acepta" ? "El cliente aceptó la tasación" : "Tasación anulada por decisión del cliente");
  });
}

const acquireSchema = z.object({
  appraisal_id: zUuid(),
  acquired_on: zDate(),
  brand_id: zUuid("Seleccione la marca del inventario"),
  category_id: zOptionalUuid(),
  location: zOptionalText(),
  list_price: zOptionalMoney(),
  min_price: zOptionalMoney(),
  price_currency: zCurrency(),
  year_manufacture: zInt("Año inválido"),
});

export async function acquireAppraisal(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["tradein.acquire"], async (ctx) => {
    const parsed = parseForm(acquireSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const canPrice = ctx.perms.has("inventory.pricing.edit");
    const [r] = await ctx.db((tx) => tx<{ id: string }[]>`
      select public.rpc_tradein_acquire(${v.appraisal_id}, ${tx.json({
        brand_id: v.brand_id, category_id: v.category_id ?? null, location: v.location ?? null, year_manufacture: v.year_manufacture,
        price_currency: v.price_currency, list_price: canPrice ? v.list_price ?? null : null, min_price: canPrice ? v.min_price ?? null : null,
      } as never)}, ${v.acquired_on}) as id`);
    revalidatePath("/tradein");
    revalidatePath("/inventario");
    await flash("Usado ingresado al inventario con su coste de adquisición");
    redirect(`/inventario/${r!.id}`);
  });
}

