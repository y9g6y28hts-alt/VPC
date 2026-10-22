"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zDate, zOptDate, zOptText, zOptUuid, zText, zUuid } from "@/server/action";
import { DomainError } from "@/server/errors";

const unitPath = (id: string) => `/inventory/${id}`;

export async function createUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({
    category: zText(), make: zText(2), model: zText(1), version: zOptText, model_year: z.string().regex(/^\d{4}$/, "Año inválido"),
    year_built: z.string().optional(), usage_value: z.string().optional(), usage_unit: z.enum(["km", "mi", "h"]),
    exterior_color: zOptText, interior_color: zOptText, origin: z.enum(["import", "local_purchase", "trade_in", "consignment"]),
    origin_country: zOptText, currency: z.enum(["USD", "PYG", "EUR"]), description: zOptText, equipment: zOptText,
    identifier_kind: z.string().optional(), identifier_value: zOptText, acquisition_status: z.enum(["evaluation", "approved"]),
  }), fd, async (i, db, ctx) => {
    const id = await db.rpc<string>("create_unit", {
      p_org: ctx.org.id,
      p_unit: { ...i, year_built: i.year_built || i.model_year, usage_value: i.usage_value || null,
        equipment: i.equipment ? i.equipment.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : [] },
      p_identifiers: i.identifier_value ? [{ kind: i.identifier_kind || "vin", value: i.identifier_value }] : [],
    });
    revalidatePath("/inventory");
    return { message: "Unidad registrada.", redirectTo: unitPath(id) };
  });
}

export async function changeStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, transition: zText(), reason: zText(3, "Indique el motivo"), effective_date: zOptDate }), fd, async (i, db) => {
    const [dimension, to] = i.transition.split(":");
    await db.rpc("change_unit_status", { p_unit: i.unit, p_dimension: dimension, p_to: to, p_reason: i.reason, p_effective_date: i.effective_date });
    revalidatePath(unitPath(i.unit));
    return { message: "Estado actualizado." };
  });
}

export async function receiveUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, location: zUuid, received_on: zDate, notes: zOptText }), fd, async (i, db) => {
    await db.rpc("receive_unit", { p_unit: i.unit, p_location: i.location, p_received_on: i.received_on, p_notes: i.notes });
    revalidatePath(unitPath(i.unit));
    return { message: "Recepción registrada. La unidad pasa a preparación; no queda disponible hasta completar requisitos." };
  });
}

export async function setPriceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, list: zAmount, minimum: zAmount, offer: z.string().optional(), reason: zText(3, "Indique el motivo"),
    version: z.coerce.number().int() }), fd, async (i, db) => {
    await db.rpc("set_unit_price", { p_unit: i.unit, p_list: i.list, p_minimum: i.minimum, p_offer: i.offer?.trim() ? i.offer : null,
      p_reason: i.reason, p_expected_version: i.version });
    revalidatePath(unitPath(i.unit));
    return { message: "Precios actualizados y registrados en el historial." };
  });
}

export async function addCostAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, concept: zText(), nature: z.enum(["actual", "estimated"]), amount: zAmount,
    currency: z.enum(["USD", "PYG", "EUR", "BRL", "ARS"]), incurred_on: zDate, description: zOptText, fx_rate: z.string().optional(),
    fx_date: zOptDate, fx_source: zOptText, settles: zOptUuid }), fd, async (i, db) => {
    await db.rpc("register_unit_cost", { p_unit: i.unit, p_concept: i.concept, p_nature: i.nature, p_amount: i.amount, p_currency: i.currency,
      p_incurred_on: i.incurred_on, p_description: i.description, p_fx_rate: i.fx_rate?.trim() ? i.fx_rate : null, p_fx_date: i.fx_date,
      p_fx_source: i.fx_source, p_settles_estimate: i.settles, p_payable: null });
    revalidatePath(unitPath(i.unit));
    return { message: i.nature === "actual" ? "Coste real registrado." : "Coste estimado registrado (no se suma a costes reales)." };
  });
}

export async function voidCostAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, cost: zUuid, reason: zText(5, "Indique el motivo (mín. 5 caracteres)") }), fd, async (i, db) => {
    await db.rpc("void_unit_cost", { p_cost: i.cost, p_reason: i.reason });
    revalidatePath(unitPath(i.unit));
    return { message: "Coste anulado (queda en el historial)." };
  });
}

export async function taskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, task: zUuid, status: z.enum(["done", "waived", "pending"]), reason: zOptText }), fd, async (i, db) => {
    await db.rpc("complete_preparation_task", { p_task: i.task, p_status: i.status, p_reason: i.reason });
    revalidatePath(unitPath(i.unit));
    revalidatePath("/service");
  });
}

export async function documentStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, doc: zUuid, status: z.enum(["pending", "received", "verified", "not_applicable"]), notes: zOptText }), fd, async (i, db) => {
    await db.rpc("set_unit_document_status", { p_doc: i.doc, p_status: i.status, p_notes: i.notes });
    revalidatePath(unitPath(i.unit));
  });
}

export async function moveUnitAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, location: zUuid, note: zOptText }), fd, async (i, db) => {
    await db.rpc("move_unit", { p_unit: i.unit, p_location: i.location, p_note: i.note });
    revalidatePath(unitPath(i.unit));
    return { message: "Ubicación actualizada." };
  });
}

export async function countAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, found: z.enum(["true", "false"]), location: zOptUuid, notes: zOptText }), fd, async (i, db) => {
    await db.rpc("record_physical_count", { p_unit: i.unit, p_found: i.found === "true", p_observed_location: i.location, p_notes: i.notes });
    revalidatePath(unitPath(i.unit));
    return { message: "Conteo físico registrado." };
  });
}

export async function reserveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, customer: zUuid, hours: z.coerce.number().int().min(1).max(2160), conditions: zText(5, "Registre las condiciones"),
    deposit: z.string().optional() }), fd, async (i, db) => {
    await db.rpc("reserve_unit", { p_unit: i.unit, p_customer: i.customer, p_conditions: i.conditions, p_hours: i.hours,
      p_deposit: i.deposit?.trim() ? i.deposit : 0 });
    revalidatePath(unitPath(i.unit));
    return { message: "Reserva registrada con vencimiento." };
  });
}

export async function releaseReservationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, reservation: zUuid, reason: zText(3, "Indique el motivo") }), fd, async (i, db) => {
    await db.rpc("release_reservation", { p_reservation: i.reservation, p_reason: i.reason });
    revalidatePath(unitPath(i.unit));
    return { message: "Reserva liberada." };
  });
}

export async function deliverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, delivered_on: zDate, notes: zOptText }), fd, async (i, db) => {
    await db.rpc("deliver_unit", { p_unit: i.unit, p_delivered_on: i.delivered_on, p_notes: i.notes });
    revalidatePath(unitPath(i.unit));
    return { message: "Entrega registrada." };
  });
}

export async function updateDetailsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, exterior_color: zOptText, interior_color: zOptText, description: zOptText, usage_value: z.string().optional() }), fd,
    async (i, db) => {
      await db.one("update public.units set exterior_color = $2, interior_color = $3, description = $4, usage_value = nullif($5, '')::numeric where id = $1 returning id",
        [i.unit, i.exterior_color, i.interior_color, i.description, i.usage_value ?? ""]);
      revalidatePath(unitPath(i.unit));
      return { message: "Ficha actualizada." };
    });
}

export async function uploadMediaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const file = fd.get("file");
  return runAction(z.object({ unit: zUuid, caption: zOptText }), fd, async (i, db, ctx) => {
    const { randomUUID } = await import("node:crypto");
    const { putObject, sniffImage } = await import("@/server/storage");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("VALIDATION", "Seleccione una imagen.");
    if (file.size > 8 * 1024 * 1024) throw new DomainError("VALIDATION", "La imagen supera 8 MB.");
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffImage(buf);
    if (!kind) throw new DomainError("VALIDATION", "Formato no admitido: use JPG, PNG o WebP.");
    const hasCover = await db.maybe("select 1 from public.unit_media where unit_id = $1 and is_cover", [i.unit]);
    const key = `${ctx.org.id}/${i.unit}/${randomUUID()}.${kind.ext}`;
    // Primero el registro (RLS verifica inventory.write); si falla la escritura del archivo, la transacción se revierte.
    await db.one("insert into public.unit_media (organization_id, unit_id, kind, storage_path, caption, is_cover, created_by) values ($1, $2, 'photo', $3, $4, $5, $6) returning id",
      [ctx.org.id, i.unit, key, i.caption, !hasCover, ctx.user.id]);
    await putObject(key, buf, kind.type);
    revalidatePath(unitPath(i.unit));
    revalidatePath("/inventory");
    return { message: "Fotografía cargada." };
  });
}

export async function setCoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ unit: zUuid, media: zUuid }), fd, async (i, db) => {
    await db.rows("update public.unit_media set is_cover = false where unit_id = $1 and is_cover", [i.unit]);
    await db.one("update public.unit_media set is_cover = true where id = $1 and unit_id = $2 returning id", [i.media, i.unit]);
    revalidatePath(unitPath(i.unit));
  });
}
