"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidAmount } from "@/domain/money";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCheckbox, zCurrency, zDate, zInt, zMoney, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zPositiveMoney, zText, zUuid } from "@/lib/forms";
import { guarded, parseForm } from "@/server/action";
import { latestRate } from "@/server/queries/common";

const FUELS = ["nafta", "diesel", "hibrido", "hibrido_enchufable", "electrico", "gnc", "otro"] as const;
const TRANSMISSIONS = ["manual", "automatica", "cvt", "dct", "otra"] as const;

const vehicleSchema = z
  .object({
    stock_code: zOptionalText(),
    brand_id: zUuid("Seleccione la marca"),
    category_id: zOptionalUuid(),
    branch_id: zOptionalUuid(),
    model: zText(1, "Indique el modelo"),
    version: zOptionalText(),
    year_manufacture: zInt("Año inválido").refine((y) => y >= 1950 && y <= 2100, "Año inválido"),
    year_model: zInt("Año inválido").refine((y) => y >= 1950 && y <= 2101, "Año inválido"),
    vin: zOptionalText(),
    engine_number: zOptionalText(),
    plate: zOptionalText(),
    mileage_km: zInt("Kilometraje inválido").refine((n) => n >= 0, "Kilometraje inválido"),
    fuel: z.enum(FUELS, { error: "Seleccione el combustible" }),
    transmission: z.enum(TRANSMISSIONS, { error: "Seleccione la transmisión" }),
    color: zOptionalText(),
    condition: z.enum(["nuevo", "usado"], { error: "Seleccione la condición" }),
    origin: z.enum(["importacion", "compra_local", "trade_in", "consignacion"], { error: "Seleccione el origen" }),
    location: zOptionalText(),
    acquisition_date: zOptionalDate(),
    supplier_id: zOptionalUuid(),
    responsible_id: zOptionalUuid(),
    physical_status: z.enum(["en_transito", "recibido", "en_preparacion", "en_reparacion", "listo"]).default("recibido"),
    description: zOptionalText(),
    price_currency: zCurrency(),
    list_price: zOptionalMoney(),
    min_price: zOptionalMoney(),
    acquisition_cost: zOptionalMoney(),
    acquisition_cost_currency: z.preprocess((v) => (v === "" ? undefined : v), zCurrency().optional()),
  })
  .superRefine((v, c) => {
    if (v.year_model < v.year_manufacture || v.year_model > v.year_manufacture + 1) {
      c.addIssue({ code: "custom", path: ["year_model"], message: "El año-modelo debe ser igual o el siguiente al de fabricación" });
    }
    for (const k of ["list_price", "min_price"] as const) {
      const n = v[k];
      if (n !== undefined && !isValidAmount(n, v.price_currency)) {
        c.addIssue({ code: "custom", path: [k], message: v.price_currency === "PYG" ? "Los guaraníes no llevan decimales" : "Máximo dos decimales" });
      }
    }
    if (v.list_price !== undefined && v.min_price !== undefined && v.min_price > v.list_price) {
      c.addIssue({ code: "custom", path: ["min_price"], message: "El mínimo no puede superar el precio de lista" });
    }
    if (v.condition === "nuevo" && v.mileage_km > 1000) {
      c.addIssue({ code: "custom", path: ["mileage_km"], message: "Una unidad nueva no debería superar 1.000 km" });
    }
  });

export async function createVehicle(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.create"], async (ctx) => {
    const parsed = parseForm(vehicleSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const canPrice = ctx.perms.has("inventory.pricing.edit");
    const canCost = ctx.perms.has("inventory.costs.create");
    if ((v.list_price !== undefined || v.min_price !== undefined) && !canPrice) {
      return fail("Su rol no puede fijar precios. Deje los precios vacíos; los completa gerencia comercial.");
    }
    const id = await ctx.db(async (tx) => {
      const [row] = await tx<{ id: string; stock_code: string }[]>`
        insert into public.vehicles (org_id, stock_code, brand_id, category_id, branch_id, model, version, year_manufacture, year_model,
          vin, engine_number, plate, mileage_km, fuel, transmission, color, condition, origin, location, acquisition_date,
          supplier_id, responsible_id, physical_status, description, price_currency, list_price, min_price, created_by)
        values (${ctx.org.id}, ${v.stock_code ?? null}, ${v.brand_id}, ${v.category_id ?? null}, ${v.branch_id ?? null}, ${v.model},
          ${v.version ?? null}, ${v.year_manufacture}, ${v.year_model}, ${v.vin?.toUpperCase() ?? null}, ${v.engine_number ?? null},
          ${v.plate?.toUpperCase() ?? null}, ${v.mileage_km}, ${v.fuel}, ${v.transmission}, ${v.color ?? null}, ${v.condition}, ${v.origin},
          ${v.location ?? null}, ${v.acquisition_date ?? null}, ${v.supplier_id ?? null}, ${v.responsible_id ?? ctx.userId},
          ${v.physical_status}, ${v.description ?? null}, ${v.price_currency}, ${v.list_price ?? null}, ${v.min_price ?? null}, ${ctx.userId})
        returning id, stock_code`;
      if (v.acquisition_cost !== undefined && v.acquisition_cost > 0 && canCost) {
        const cur = v.acquisition_cost_currency ?? v.price_currency;
        const rate = cur === ctx.org.baseCurrency ? 1 : (await latestRate(ctx, cur, ctx.org.baseCurrency))?.rate;
        if (!rate) throw Object.assign(new Error(`Registre el tipo de cambio ${cur}→${ctx.org.baseCurrency} para cargar el coste`), { code: "P0001" });
        await tx`insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base, incurred_on, supplier_id, created_by)
                 values (${ctx.org.id}, ${row!.id}, 'adquisicion', 'Costo de adquisición', ${v.acquisition_cost}, ${cur}, ${rate},
                         ${v.acquisition_date ?? tx`app.org_today(${ctx.org.id})`}, ${v.supplier_id ?? null}, ${ctx.userId})`;
      }
      return row!.id;
    });
    revalidatePath("/inventario");
    return ok("Unidad registrada", { id });
  });
}

export async function updateVehicle(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.edit"], async (ctx) => {
    const id = String(formData.get("id") ?? "");
    const parsed = parseForm(vehicleSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const rowVersion = Number(formData.get("row_version"));
    const canEdit = ctx.perms.has("inventory.edit");
    const canPrice = ctx.perms.has("inventory.pricing.edit");
    const updated = await ctx.db(async (tx) => {
      const [cur] = await tx<{ row_version: number; list_price: string | null; min_price: string | null; price_currency: string }[]>`
        select row_version, list_price, min_price, price_currency from public.vehicles where id = ${id} and org_id = ${ctx.org.id} for update`;
      if (!cur) return "missing";
      if (cur.row_version !== rowVersion) return "stale";
      if (canEdit) {
        await tx`
          update public.vehicles set brand_id = ${v.brand_id}, category_id = ${v.category_id ?? null}, branch_id = ${v.branch_id ?? null},
            model = ${v.model}, version = ${v.version ?? null}, year_manufacture = ${v.year_manufacture}, year_model = ${v.year_model},
            vin = ${v.vin?.toUpperCase() ?? null}, engine_number = ${v.engine_number ?? null}, plate = ${v.plate?.toUpperCase() ?? null},
            mileage_km = ${v.mileage_km}, fuel = ${v.fuel}, transmission = ${v.transmission}, color = ${v.color ?? null},
            condition = ${v.condition}, origin = ${v.origin}, location = ${v.location ?? null}, acquisition_date = ${v.acquisition_date ?? null},
            supplier_id = ${v.supplier_id ?? null}, responsible_id = ${v.responsible_id ?? null}, description = ${v.description ?? null}
          where id = ${id}`;
      }
      const priceChanged =
        (v.list_price ?? null) !== (cur.list_price === null ? null : Number(cur.list_price)) ||
        (v.min_price ?? null) !== (cur.min_price === null ? null : Number(cur.min_price)) ||
        v.price_currency !== cur.price_currency;
      if (priceChanged) {
        if (!canPrice) return "noprice";
        await tx`update public.vehicles set price_currency = ${v.price_currency}, list_price = ${v.list_price ?? null}, min_price = ${v.min_price ?? null} where id = ${id}`;
      }
      return "ok";
    });
    if (updated === "missing") return fail("La unidad no existe");
    if (updated === "stale") return fail("Otra persona modificó la unidad mientras la editaba. Recargue la página para ver los cambios.");
    if (updated === "noprice") return fail("Su rol no puede modificar precios.");
    revalidatePath("/inventario");
    revalidatePath(`/inventario/${id}`);
    return ok("Cambios guardados", { id });
  });
}

const pricingSchema = z
  .object({ vehicle_id: zUuid(), price_currency: zCurrency(), list_price: zOptionalMoney(), min_price: zOptionalMoney() })
  .superRefine((v, c) => {
    for (const k of ["list_price", "min_price"] as const) {
      const n = v[k];
      if (n !== undefined && !isValidAmount(n, v.price_currency)) c.addIssue({ code: "custom", path: [k], message: "Decimales no válidos para la moneda" });
    }
    if (v.list_price !== undefined && v.min_price !== undefined && v.min_price > v.list_price) {
      c.addIssue({ code: "custom", path: ["min_price"], message: "El mínimo no puede superar el precio de lista" });
    }
  });

/** Precios de lista y mínimo (queda auditado y se refleja en el historial de la unidad). */
export async function updateVehiclePricing(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.pricing.edit"], async (ctx) => {
    const parsed = parseForm(pricingSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`
      update public.vehicles set price_currency = ${v.price_currency}, list_price = ${v.list_price ?? null}, min_price = ${v.min_price ?? null}
      where id = ${v.vehicle_id} and org_id = ${ctx.org.id}`);
    revalidatePath(`/inventario/${v.vehicle_id}`);
    revalidatePath("/inventario");
    return ok("Precios actualizados");
  });
}

const costSchema = z.object({
  vehicle_id: zUuid(),
  kind: z.enum(["adquisicion", "transporte", "importacion", "reparacion", "preparacion", "documentacion", "comision", "otro"]),
  description: zText(3, "Describa el coste"),
  amount: zPositiveMoney(),
  currency: zCurrency(),
  incurred_on: zDate(),
  is_estimate: zCheckbox(),
  supplier_id: zOptionalUuid(),
});

export async function addVehicleCost(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.costs.create"], async (ctx) => {
    const parsed = parseForm(costSchema, formData);
    if (!parsed.ok) return parsed.state;
    const c = parsed.data;
    if (!isValidAmount(c.amount, c.currency)) return fail(c.currency === "PYG" ? "Los guaraníes no llevan decimales" : "Máximo dos decimales");
    const rate = c.currency === ctx.org.baseCurrency ? { rate: 1 } : await latestRate(ctx, c.currency, ctx.org.baseCurrency);
    if (!rate) return fail(`No hay tipo de cambio ${c.currency}→${ctx.org.baseCurrency}. Regístrelo en Caja › Tipos de cambio.`);
    await ctx.db((tx) => tx`
      insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base, incurred_on, is_estimate, supplier_id, created_by)
      values (${ctx.org.id}, ${c.vehicle_id}, ${c.kind}, ${c.description}, ${c.amount}, ${c.currency}, ${rate.rate}, ${c.incurred_on},
              ${c.is_estimate}, ${c.supplier_id ?? null}, ${ctx.userId})`);
    revalidatePath(`/inventario/${c.vehicle_id}`);
    return ok(c.is_estimate ? "Coste estimado registrado" : "Coste registrado");
  });
}

/** Confirma un coste estimado como definitivo (con importe final). */
export async function confirmEstimatedCost(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.costs.edit_history"], async (ctx) => {
    const id = String(formData.get("cost_id") ?? "");
    const vehicleId = String(formData.get("vehicle_id") ?? "");
    await ctx.db((tx) => tx`update public.vehicle_costs set is_estimate = false where id = ${id} and org_id = ${ctx.org.id}`);
    revalidatePath(`/inventario/${vehicleId}`);
    return ok("Coste confirmado");
  });
}

const statusSchema = z.object({
  vehicle_id: zUuid(),
  dimension: z.enum(["physical_status", "prep_status", "doc_status"]),
  value: z.string(),
  note: zOptionalText(),
});
const ALLOWED: Record<string, string[]> = {
  physical_status: ["en_transito", "recibido", "en_preparacion", "en_reparacion", "listo"],
  prep_status: ["pendiente", "en_proceso", "completa", "no_aplica"],
  doc_status: ["incompleta", "en_tramite", "completa"],
};

export async function changeVehicleStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.edit"], async (ctx) => {
    const parsed = parseForm(statusSchema, formData);
    if (!parsed.ok) return parsed.state;
    const s = parsed.data;
    if (!ALLOWED[s.dimension]!.includes(s.value)) return fail("Estado inválido");
    await ctx.db(async (tx) => {
      await tx`select set_config('app.status_note', ${s.note ?? ""}, true)`;
      await tx`update public.vehicles set ${tx({ [s.dimension]: s.value })} where id = ${s.vehicle_id} and org_id = ${ctx.org.id}`;
    });
    revalidatePath(`/inventario/${s.vehicle_id}`);
    revalidatePath("/inventario");
    return ok("Estado actualizado");
  });
}

export async function setWithdrawn(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.edit"], async (ctx) => {
    const id = String(formData.get("vehicle_id") ?? "");
    const withdraw = formData.get("withdraw") === "1";
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 5) return fail("Indique el motivo");
    await ctx.db(async (tx) => {
      await tx`select set_config('app.status_note', ${reason}, true)`;
      await tx`update public.vehicles set commercial_status = ${withdraw ? "retirado" : "disponible"} where id = ${id} and org_id = ${ctx.org.id}`;
    });
    revalidatePath(`/inventario/${id}`);
    revalidatePath("/inventario");
    return ok(withdraw ? "Unidad retirada de la venta" : "Unidad reincorporada al stock");
  });
}

const reservationSchema = z.object({
  vehicle_id: zUuid(),
  customer_id: zUuid("Seleccione el cliente"),
  expires_on: zDate("Indique hasta cuándo"),
  notes: zOptionalText(),
  deposit_amount: zOptionalMoney(),
  deposit_currency: z.preprocess((v) => (v === "" ? undefined : v), zCurrency().optional()),
  deposit_method: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["efectivo", "transferencia", "deposito", "cheque", "tarjeta"]).optional()),
  deposit_account: zOptionalUuid(),
  deposit_reference: zOptionalText(),
});

export async function createReservation(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["reservations.manage"], async (ctx) => {
    const parsed = parseForm(reservationSchema, formData);
    if (!parsed.ok) return parsed.state;
    const r = parsed.data;
    const hasDeposit = (r.deposit_amount ?? 0) > 0;
    if (hasDeposit && (!r.deposit_currency || !r.deposit_method || !r.deposit_account)) {
      return fail("Complete moneda, medio y cuenta de la seña", { fieldErrors: { deposit_account: ["Requerido para registrar la seña"] } });
    }
    // Vence al final del día indicado, hora de Asunción (UTC−3).
    const expiresAt = `${r.expires_on}T23:59:00-03:00`;
    const deposit = hasDeposit
      ? { amount: r.deposit_amount, currency: r.deposit_currency, method: r.deposit_method, cash_account_id: r.deposit_account, reference: r.deposit_reference ?? null }
      : null;
    await ctx.db((tx) => tx`select public.rpc_reservation_create(${r.vehicle_id}, ${r.customer_id}, ${expiresAt}, ${r.notes ?? null}, ${deposit ? tx.json(deposit as never) : null})`);
    revalidatePath("/inventario");
    revalidatePath(`/inventario/${r.vehicle_id}`);
    return ok(hasDeposit ? "Reserva creada. La seña queda registrada pendiente de confirmación." : "Reserva creada");
  });
}

export async function cancelReservation(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["reservations.manage"], async (ctx) => {
    const id = String(formData.get("reservation_id") ?? "");
    const vehicleId = String(formData.get("vehicle_id") ?? "");
    await ctx.db((tx) => tx`select public.rpc_reservation_cancel(${id}, ${String(formData.get("reason") ?? "")})`);
    revalidatePath("/inventario");
    revalidatePath(`/inventario/${vehicleId}`);
    return ok("Reserva anulada; la unidad vuelve a estar disponible");
  });
}
