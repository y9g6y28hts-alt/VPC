"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { guarded } from "@/server/action";
import { MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES, putObject, sniffType } from "@/server/storage";

const ENTITY_TYPES = ["vehicle", "customer", "deal", "contract", "payment", "supplier_invoice", "trade_in", "expense", "cash_movement"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const PATHS: Record<EntityType, (id: string) => string> = {
  vehicle: (id) => `/inventario/${id}`,
  customer: (id) => `/clientes/${id}`,
  deal: (id) => `/ventas/${id}`,
  contract: (id) => `/financiaciones/${id}`,
  payment: () => `/cobranzas`,
  supplier_invoice: (id) => `/compras/facturas/${id}`,
  trade_in: (id) => `/tradein/${id}`,
  expense: () => `/gastos`,
  cash_movement: () => `/caja`,
};

/** Adjunta un documento a cualquier entidad. El permiso lo verifica RLS (app.can_write_entity). */
export async function uploadDocument(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded([], async (ctx) => {
    const entityType = String(formData.get("entity_type") ?? "") as EntityType;
    const entityId = String(formData.get("entity_id") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    const docType = String(formData.get("document_type_id") ?? "") || null;
    const restricted = formData.get("is_restricted") === "on";
    const file = formData.get("file");
    if (!ENTITY_TYPES.includes(entityType)) return fail("Entidad inválida");
    if (!(file instanceof File) || file.size === 0) return fail("Seleccione un archivo", { fieldErrors: { file: ["Seleccione un archivo"] } });
    if (file.size > MAX_DOCUMENT_BYTES) return fail("El archivo supera 25 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffType(bytes, ["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!type) return fail("Formato no admitido. Use PDF, JPG, PNG o WEBP.");
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${ctx.org.id}/${entityType}/${entityId}/${randomUUID()}-${safeName}`;
    await ctx.db(async (tx) => {
      await tx`insert into public.documents (org_id, entity_type, entity_id, document_type_id, title, storage_bucket, storage_path,
                                             mime_type, size_bytes, is_restricted, uploaded_by)
               values (${ctx.org.id}, ${entityType}, ${entityId}, ${docType}, ${title || file.name}, 'documents', ${path},
                       ${type.mime}, ${file.size}, ${restricted}, ${ctx.userId})`;
      // Si el guardado del archivo falla, la transacción revierte el registro.
      await putObject("documents", path, bytes, type.mime);
    });
    revalidatePath(PATHS[entityType](entityId));
    return ok("Documento adjuntado");
  });
}

export async function uploadVehiclePhoto(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.edit"], async (ctx) => {
    const vehicleId = String(formData.get("vehicle_id") ?? "");
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return fail("Seleccione al menos una fotografía");
    if (files.length > 12) return fail("Máximo 12 fotografías por carga");
    const prepared: Array<{ bytes: Uint8Array; ext: string; mime: string }> = [];
    for (const f of files) {
      if (f.size > MAX_PHOTO_BYTES) return fail(`${f.name} supera 10 MB`);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const type = sniffType(bytes, ["image/jpeg", "image/png", "image/webp"]);
      if (!type) return fail(`${f.name}: formato no admitido (JPG, PNG o WEBP)`);
      prepared.push({ bytes, ...type });
    }
    await ctx.db(async (tx) => {
      const [count] = await tx<{ n: number }[]>`select count(*)::int as n from public.vehicle_photos where vehicle_id = ${vehicleId}`;
      let i = count?.n ?? 0;
      for (const p of prepared) {
        const path = `${ctx.org.id}/${vehicleId}/${randomUUID()}.${p.ext}`;
        await tx`insert into public.vehicle_photos (org_id, vehicle_id, storage_path, sort_order, is_cover, uploaded_by)
                 values (${ctx.org.id}, ${vehicleId}, ${path}, ${i}, ${i === 0}, ${ctx.userId})`;
        await putObject("vehicle-photos", path, p.bytes, p.mime);
        i++;
      }
    });
    revalidatePath(`/inventario/${vehicleId}`);
    revalidatePath("/inventario");
    return ok(prepared.length === 1 ? "Fotografía cargada" : `${prepared.length} fotografías cargadas`);
  });
}

export async function setCoverPhoto(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["inventory.edit"], async (ctx) => {
    const photoId = String(formData.get("photo_id") ?? "");
    const vehicleId = String(formData.get("vehicle_id") ?? "");
    await ctx.db(async (tx) => {
      await tx`update public.vehicle_photos set is_cover = false where vehicle_id = ${vehicleId} and is_cover`;
      await tx`update public.vehicle_photos set is_cover = true where id = ${photoId} and vehicle_id = ${vehicleId}`;
    });
    revalidatePath(`/inventario/${vehicleId}`);
    revalidatePath("/inventario");
    return ok("Portada actualizada");
  });
}
