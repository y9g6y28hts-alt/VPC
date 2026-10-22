"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCheckbox, zCurrency, zOptionalDate, zOptionalMoney, zOptionalText, zOptionalUuid, zText, zUuid } from "@/lib/forms";
import { guarded, parseForm } from "@/server/action";
import type { AppContext } from "@/server/auth/context";

const customerSchema = z
  .object({
    kind: z.enum(["persona", "empresa"]),
    full_name: zText(3, "Indique el nombre o razón social"),
    doc_type: z.enum(["ci", "ruc", "pasaporte", "otro"]),
    doc_number: zText(3, "Indique el número de documento"),
    phone: zOptionalText(),
    email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toLowerCase().email("Correo inválido").optional()),
    address: zOptionalText(),
    city: zOptionalText(),
    customer_type: z.enum(["particular", "empresa", "flota", "revendedor", "otro"]).default("particular"),
    source: zOptionalText(),
    assigned_seller_id: zOptionalUuid(),
    notes: zOptionalText(),
    confirm_duplicate: zCheckbox(),
  })
  .superRefine((v, c) => {
    if (v.doc_type === "ruc" && !/^\d{3,9}-\d$/.test(v.doc_number.replace(/\./g, ""))) {
      c.addIssue({ code: "custom", path: ["doc_number"], message: "Formato de RUC: número y dígito verificador (80012345-6)" });
    }
    if (v.doc_type === "ci" && !/^\d{5,9}$/.test(v.doc_number.replace(/\./g, ""))) {
      c.addIssue({ code: "custom", path: ["doc_number"], message: "La C.I. debe tener sólo números" });
    }
    if (!v.phone && !v.email) c.addIssue({ code: "custom", path: ["phone"], message: "Indique al menos un teléfono o un correo" });
  });

async function duplicates(ctx: AppContext, v: z.infer<typeof customerSchema>, exclude?: string) {
  return ctx.db((tx) => tx<{ id: string; full_name: string; match_on: string; seller_name: string | null; visible: boolean }[]>`
    select * from public.rpc_customer_duplicates(${ctx.org.id}, ${v.doc_type}, ${v.doc_number}, ${v.phone ?? null}, ${v.email ?? null}, ${exclude ?? null})`);
}

export async function createCustomer(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["customers.create"], async (ctx) => {
    const parsed = parseForm(customerSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const dups = await duplicates(ctx, v);
    const sameDoc = dups.find((d) => d.match_on === "documento");
    if (sameDoc) {
      return fail(
        `Ya existe un cliente con ese documento: ${sameDoc.full_name}${sameDoc.seller_name ? ` (vendedor: ${sameDoc.seller_name})` : ""}.` +
          (sameDoc.visible ? " Ábralo desde la lista de clientes." : " Pida a su gerencia que se lo asigne si corresponde."),
        { fieldErrors: { doc_number: ["Documento ya registrado"] } },
      );
    }
    if (dups.length && !v.confirm_duplicate) {
      return fail(
        `Posible duplicado: ${dups.map((d) => `${d.full_name} (coincide ${d.match_on})`).join("; ")}. Si es otra persona, marque «Confirmo que no es un duplicado».`,
        { needsConfirmation: true },
      );
    }
    // Un vendedor sólo crea clientes asignados a sí mismo.
    const seller = ctx.perms.has("customers.view_all") ? (v.assigned_seller_id ?? null) : ctx.userId;
    const [row] = await ctx.db((tx) => tx<{ id: string }[]>`
      insert into public.customers (org_id, kind, full_name, doc_type, doc_number, phone, email, address, city, customer_type, source,
                                    assigned_seller_id, notes, created_by)
      values (${ctx.org.id}, ${v.kind}, ${v.full_name}, ${v.doc_type}, ${v.doc_number}, ${v.phone ?? null}, ${v.email ?? null},
              ${v.address ?? null}, ${v.city ?? null}, ${v.customer_type}, ${v.source ?? null}, ${seller}, ${v.notes ?? null}, ${ctx.userId})
      returning id`);
    revalidatePath("/clientes");
    return ok("Cliente registrado", { id: row!.id });
  });
}

export async function updateCustomer(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["customers.edit"], async (ctx) => {
    const id = String(formData.get("id") ?? "");
    const parsed = parseForm(customerSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    const dups = (await duplicates(ctx, v, id)).filter((d) => d.match_on === "documento");
    if (dups.length) return fail(`Otro cliente ya tiene ese documento: ${dups[0]!.full_name}`, { fieldErrors: { doc_number: ["Documento ya registrado"] } });
    const canReassign = ctx.perms.has("customers.view_all");
    const res = await ctx.db((tx) => tx`
      update public.customers set kind = ${v.kind}, full_name = ${v.full_name}, doc_type = ${v.doc_type}, doc_number = ${v.doc_number},
        phone = ${v.phone ?? null}, email = ${v.email ?? null}, address = ${v.address ?? null}, city = ${v.city ?? null},
        customer_type = ${v.customer_type}, source = ${v.source ?? null}, notes = ${v.notes ?? null}
        ${canReassign ? tx`, assigned_seller_id = ${v.assigned_seller_id ?? null}` : tx``}
      where id = ${id} and org_id = ${ctx.org.id} returning id`);
    if (!res.length) return fail("No tiene acceso a este cliente");
    revalidatePath(`/clientes/${id}`);
    revalidatePath("/clientes");
    return ok("Datos actualizados", { id });
  });
}

const interactionSchema = z.object({
  customer_id: zUuid(),
  channel: z.enum(["llamada", "whatsapp", "visita", "email", "nota", "otro"]),
  summary: zText(3, "Resuma la interacción"),
  next_action: zOptionalText(),
  next_action_at: zOptionalDate(),
});

export async function addInteraction(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["crm.manage", "collections.manage"], async (ctx) => {
    const parsed = parseForm(interactionSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`
      insert into public.customer_interactions (org_id, customer_id, channel, summary, next_action, next_action_at, user_id)
      values (${ctx.org.id}, ${v.customer_id}, ${v.channel}, ${v.summary}, ${v.next_action ?? null}, ${v.next_action_at ?? null}, ${ctx.userId})`);
    revalidatePath(`/clientes/${v.customer_id}`);
    return ok("Interacción registrada");
  });
}

export async function assignCollector(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["collections.assign"], async (ctx) => {
    const customerId = String(formData.get("customer_id") ?? "");
    const collector = String(formData.get("collector_id") ?? "") || null;
    await ctx.db(async (tx) => {
      await tx`update public.customers set collector_id = ${collector} where id = ${customerId} and org_id = ${ctx.org.id}`;
    });
    revalidatePath(`/clientes/${customerId}`);
    revalidatePath("/cobranzas");
    return ok("Responsable de cobranza asignado");
  });
}

const opportunitySchema = z.object({
  customer_id: zUuid("Seleccione el cliente"),
  vehicle_id: zOptionalUuid(),
  title: zText(3, "Describa la oportunidad"),
  stage_id: zUuid("Seleccione la etapa"),
  expected_value: zOptionalMoney(),
  currency: zCurrency(),
  next_action: zOptionalText(),
  next_action_at: zOptionalDate(),
});

export async function createOpportunity(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["crm.manage"], async (ctx) => {
    const parsed = parseForm(opportunitySchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`
      insert into public.opportunities (org_id, customer_id, vehicle_id, stage_id, seller_id, title, expected_value, currency,
                                        next_action, next_action_at, created_by)
      values (${ctx.org.id}, ${v.customer_id}, ${v.vehicle_id ?? null}, ${v.stage_id}, ${ctx.userId}, ${v.title}, ${v.expected_value ?? null},
              ${v.currency}, ${v.next_action ?? null}, ${v.next_action_at ?? null}, ${ctx.userId})`);
    revalidatePath("/clientes/oportunidades");
    revalidatePath(`/clientes/${v.customer_id}`);
    return ok("Oportunidad creada");
  });
}

export async function moveOpportunity(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["crm.manage"], async (ctx) => {
    const id = String(formData.get("opportunity_id") ?? "");
    const stageId = String(formData.get("stage_id") ?? "");
    const lostReason = String(formData.get("reason") ?? "").trim();
    const [stage] = await ctx.db((tx) => tx<{ is_lost: boolean; is_won: boolean; key: string }[]>`
      select is_lost, is_won, key from public.pipeline_stages where id = ${stageId} and org_id = ${ctx.org.id}`);
    if (!stage) return fail("Etapa inválida");
    // Una venta sólo se marca ganada al formalizarse desde Ventas: no se confunde interés con venta cerrada.
    if (stage.is_won) return fail("Las etapas de venta y entrega se completan automáticamente al formalizar y entregar la operación.");
    if (stage.is_lost && lostReason.length < 5) return fail("Indique el motivo de la pérdida");
    const res = await ctx.db((tx) => tx`
      update public.opportunities set stage_id = ${stageId}, status = ${stage.is_lost ? "perdida" : "abierta"},
             lost_reason = ${stage.is_lost ? lostReason : null}
      where id = ${id} and org_id = ${ctx.org.id} returning customer_id`);
    if (!res.length) return fail("No tiene acceso a esta oportunidad");
    revalidatePath("/clientes/oportunidades");
    return ok(stage.is_lost ? "Oportunidad marcada como perdida" : "Etapa actualizada");
  });
}
