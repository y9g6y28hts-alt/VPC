"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zDate, zOptDate, zOptText, zOptUuid, zText, zUuid } from "@/server/action";

export async function createShipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const units = fd.getAll("units").map(String).filter(Boolean);
  return runAction(z.object({ reference: zText(3), origin_country: zText(2), origin_port: zOptText, transport_mode: z.enum(["sea", "air", "land", "other"]),
    departed_on: zOptDate, eta: zDate, carrier: zOptUuid, tracking: zOptText }), fd, async (i, db, ctx) => {
    const { id } = await db.one<{ id: string }>(
      `insert into public.shipments (organization_id, reference, origin_country, origin_port, destination, transport_mode, departed_on, eta, carrier_supplier_id, tracking, status, responsible_user_id)
       values ($1, $2, $3, $4, 'Destino local', $5, $6, $7, $8, $9, case when $6::date is null then 'planned' else 'in_transit' end, $10) returning id`,
      [ctx.org.id, i.reference, i.origin_country, i.origin_port, i.transport_mode, i.departed_on, i.eta, i.carrier, i.tracking, ctx.user.id]);
    for (const u of units) await db.rows("insert into public.shipment_units (shipment_id, unit_id, organization_id) values ($1, $2, $3)", [id, u, ctx.org.id]);
    revalidatePath("/imports");
    return { message: "Embarque registrado.", redirectTo: `/imports/${id}` };
  });
}

export async function updateShipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, status: z.enum(["planned", "in_transit", "arrived_port", "in_customs", "cleared", "delivered", "cancelled"]), eta: zDate,
    customs_cleared_on: zOptDate, tracking: zOptText }), fd, async (i, db) => {
    await db.one("update public.shipments set status = $2, eta = $3, customs_cleared_on = $4, tracking = $5 where id = $1 returning id",
      [i.id, i.status, i.eta, i.customs_cleared_on, i.tracking]);
    revalidatePath(`/imports/${i.id}`);
    return { message: "Embarque actualizado; los cambios de ETA y estado quedan en el historial." };
  });
}

export async function incidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, severity: z.enum(["info", "warning", "critical"]), description: zText(5, "Describa la incidencia") }), fd, async (i, db, ctx) => {
    await db.rows("insert into public.import_events (organization_id, shipment_id, event_type, severity, description, actor_id) values ($1, $2, 'incident', $3, $4, $5)",
      [ctx.org.id, i.id, i.severity, i.description, ctx.user.id]);
    revalidatePath(`/imports/${i.id}`);
  });
}

export async function resolveIncidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, event: zUuid }), fd, async (i, db) => {
    await db.one("update public.import_events set resolved = true, resolved_at = now() where id = $1 returning id", [i.event]);
    revalidatePath(`/imports/${i.id}`);
  });
}
