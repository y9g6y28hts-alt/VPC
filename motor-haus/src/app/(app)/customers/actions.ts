"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zOptText, zOptUuid, zText, zUuid } from "@/server/action";
import { DomainError } from "@/server/errors";

const base = z.object({
  kind: z.enum(["individual", "company", "trust", "other"]), display_name: zText(2, "Nombre obligatorio"), legal_name: zOptText,
  email: z.string().trim().optional().transform((v) => v || null).pipe(z.string().email("Correo inválido").nullable()),
  phone: zOptText, city: zOptText, country: zOptText, notes: zOptText,
});

export async function createCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(base.extend({ document_type: zOptText, document_number: zOptText, tax_id: zOptText, address: zOptText }), fd, async (i, db, ctx) => {
    if (Boolean(i.document_type) !== Boolean(i.document_number)) throw new DomainError("VALIDATION", "Indique tipo y número de documento juntos.");
    const { id } = await db.one<{ id: string }>(
      `insert into public.customers (organization_id, kind, display_name, legal_name, email, phone, city, country, notes, owner_user_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) returning id`,
      [ctx.org.id, i.kind, i.display_name, i.legal_name, i.email, i.phone, i.city, i.country ?? "Paraguay", i.notes, ctx.user.id]);
    if (i.document_number || i.tax_id || i.address) {
      await db.rpc("set_customer_sensitive", { p_customer: id, p_document_type: i.document_type, p_document_number: i.document_number, p_tax_id: i.tax_id, p_address: i.address });
    }
    revalidatePath("/customers");
    return { message: "Cliente creado.", redirectTo: `/customers/${id}` };
  });
}

export async function updateCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(base.extend({ id: zUuid, status: z.enum(["prospect", "active", "inactive"]) }), fd, async (i, db) => {
    await db.one(`update public.customers set kind = $2, display_name = $3, legal_name = $4, email = $5, phone = $6, city = $7, country = $8, notes = $9, status = $10
                  where id = $1 returning id`, [i.id, i.kind, i.display_name, i.legal_name, i.email, i.phone, i.city, i.country, i.notes, i.status]);
    revalidatePath(`/customers/${i.id}`);
    return { message: "Expediente actualizado." };
  });
}

export async function revealPiiAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid }), fd, async (i, db) => {
    const r = await db.maybe<{ document_type: string | null; document_number: string | null; tax_id: string | null; address: string | null }>(
      "select * from public.get_customer_sensitive($1)", [i.id]);
    return { message: `Documento: ${r?.document_type ?? "—"} ${r?.document_number ?? ""} · RUC/NIF: ${r?.tax_id ?? "—"} · Dirección: ${r?.address ?? "—"} (consulta registrada en auditoría)` };
  });
}

export async function addInteractionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ id: zUuid, channel: z.enum(["in_person", "phone", "whatsapp", "email", "video", "event", "other"]),
    kind: z.enum(["inquiry", "visit", "test_drive", "follow_up", "proposal", "complaint", "note"]), summary: zText(3, "Describa la interacción"), unit: zOptUuid }), fd,
  async (i, db, ctx) => {
    await db.rows("insert into public.customer_interactions (organization_id, customer_id, channel, kind, summary, unit_id, user_id) values ($1, $2, $3, $4, $5, $6, $7)",
      [ctx.org.id, i.id, i.channel, i.kind, i.summary, i.unit, ctx.user.id]);
    revalidatePath(`/customers/${i.id}`);
    return { message: "Interacción registrada." };
  });
}
