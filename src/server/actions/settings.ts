"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@/domain/permissions";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { zCheckbox, zInt, zNumber, zOptionalText, zText, zUuid } from "@/lib/forms";
import { guarded, parseForm } from "@/server/action";
import { getAuthUser } from "@/server/auth/context";
import { demoUserId } from "@/server/auth/demo-session";
import { getSql, isEmbeddedDemo } from "@/server/db/client";
import { ConfigError } from "@/server/env";
import { supabaseAdmin, supabaseServer } from "@/server/supabase";

const orgSchema = z.object({
  name: zText(3, "Indique el nombre comercial"),
  legal_name: zOptionalText(),
  tax_id: zOptionalText(),
});

export async function updateOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const parsed = parseForm(orgSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`update public.organizations set name = ${v.name}, legal_name = ${v.legal_name ?? null}, tax_id = ${v.tax_id ?? null} where id = ${ctx.org.id}`);
    revalidatePath("/", "layout");
    return ok("Datos de la organización actualizados");
  });
}

const settingsSchema = z.object({
  max_discount_pct_without_approval: zNumber().refine((n) => n >= 0 && n <= 100, "Entre 0 y 100"),
  reservation_default_days: zInt().refine((n) => n >= 1 && n <= 90, "Entre 1 y 90 días"),
  aging_alert_days: zInt().refine((n) => n >= 1 && n <= 3650, "Mayor que cero"),
  proposal_validity_days: zInt().refine((n) => n >= 1 && n <= 60, "Entre 1 y 60 días"),
  payables_due_soon_days: zInt().refine((n) => n >= 1 && n <= 60, "Entre 1 y 60 días"),
  default_rate_convention: z.enum(["nominal_annual", "effective_annual", "monthly"]),
  require_down_payment_before_delivery: zCheckbox(),
});

export async function updateSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const parsed = parseForm(settingsSchema, formData);
    if (!parsed.ok) return parsed.state;
    await ctx.db((tx) => tx`update public.org_settings set ${tx({ ...parsed.data, updated_at: new Date() })} where org_id = ${ctx.org.id}`);
    revalidatePath("/configuracion");
    return ok("Parámetros guardados");
  });
}

export async function updateAgingBuckets(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const raw = String(formData.get("limits") ?? "");
    const limits = raw.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!limits.length || limits.some((n) => !Number.isInteger(n) || n <= 0)) {
      return fail("Ingrese límites enteros separados por coma, p. ej. 30, 60, 90", { fieldErrors: { limits: ["Formato inválido"] } });
    }
    await ctx.db((tx) => tx`select public.rpc_aging_buckets_set(${ctx.org.id}, ${limits}::int[])`);
    revalidatePath("/configuracion");
    revalidatePath("/cobranzas");
    return ok("Tramos de mora actualizados");
  });
}

// ------------------------------------------------------------------ usuarios

const userSchema = z.object({
  full_name: zText(3, "Indique el nombre completo"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  role: z.enum(ROLES, { error: "Seleccione el rol" }),
  password: z.string().min(12, "Mínimo 12 caracteres"),
});

/**
 * Alta de usuario: crea la cuenta en Supabase Auth con una contraseña inicial
 * (que el usuario cambia en «Mi cuenta») y la membresía con su rol.
 */
export async function createUser(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["users.manage"], async (ctx) => {
    const parsed = parseForm(userSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    if (v.role === "director" && ctx.org.role !== "director") return fail("Sólo un director puede asignar el rol de director.");
    if (isEmbeddedDemo()) {
      // Demo autónoma: la cuenta se crea en la base embebida; se ingresa eligiéndola en la pantalla de ingreso.
      const sql = await getSql();
      const id = demoUserId(v.email);
      const [exists] = await sql`select 1 from auth.users where id = ${id} or email = ${v.email}`;
      if (exists) return fail("Ya existe una cuenta con ese correo.", { fieldErrors: { email: ["Ya registrado"] } });
      await sql`insert into auth.users (id, email) values (${id}, ${v.email})`;
      await ctx.db((tx) => tx`select public.rpc_member_add(${ctx.org.id}, ${id}, ${v.full_name}, ${v.role})`);
      revalidatePath("/configuracion");
      return ok(`Usuario ${v.email} creado. En la demo se ingresa eligiéndolo en la pantalla de ingreso.`);
    }
    let admin;
    try {
      admin = supabaseAdmin();
    } catch (e) {
      if (e instanceof ConfigError) return fail(e.message);
      throw e;
    }
    const { data, error } = await admin.auth.admin.createUser({ email: v.email, password: v.password, email_confirm: true, user_metadata: { full_name: v.full_name } });
    if (error || !data.user) {
      const exists = /already|registered|exists/i.test(error?.message ?? "");
      return fail(exists ? "Ya existe una cuenta con ese correo." : `No se pudo crear la cuenta: ${error?.message ?? "error desconocido"}`, exists ? { fieldErrors: { email: ["Ya registrado"] } } : {});
    }
    try {
      await ctx.db((tx) => tx`select public.rpc_member_add(${ctx.org.id}, ${data.user.id}, ${v.full_name}, ${v.role})`);
    } catch (e) {
      // Sin membresía la cuenta no sirve: se elimina para no dejar cuentas huérfanas.
      await admin.auth.admin.deleteUser(data.user.id);
      throw e;
    }
    revalidatePath("/configuracion");
    return ok(`Usuario ${v.email} creado. Comunique la contraseña inicial por un canal seguro.`);
  });
}

const memberSchema = z.object({ member_id: zUuid(), role: z.enum(ROLES) });

export async function changeRole(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["users.manage"], async (ctx) => {
    const parsed = parseForm(memberSchema, formData);
    if (!parsed.ok) return parsed.state;
    const res = await ctx.db((tx) => tx`update public.memberships set role = ${parsed.data.role} where id = ${parsed.data.member_id} and org_id = ${ctx.org.id} returning id`);
    if (!res.length) return fail("Miembro no encontrado");
    revalidatePath("/configuracion");
    return ok("Rol actualizado. Los permisos aplican desde la próxima acción del usuario.");
  });
}

export async function setMemberActive(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["users.manage"], async (ctx) => {
    const id = String(formData.get("member_id") ?? "");
    const active = formData.get("active") === "true";
    const res = await ctx.db((tx) => tx`update public.memberships set is_active = ${active} where id = ${id} and org_id = ${ctx.org.id} returning id`);
    if (!res.length) return fail("Miembro no encontrado");
    revalidatePath("/configuracion");
    return ok(active ? "Acceso reactivado" : "Acceso desactivado. El usuario ya no puede operar en esta organización.");
  });
}

// ------------------------------------------------------------------ catálogos

export async function addBrand(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const parsed = parseForm(z.object({ name: zText(2, "Indique la marca") }), formData);
    if (!parsed.ok) return parsed.state;
    await ctx.db((tx) => tx`insert into public.brands (org_id, name, sort_order)
      values (${ctx.org.id}, ${parsed.data.name}, (select coalesce(max(sort_order), 0) + 1 from public.brands where org_id = ${ctx.org.id}))`);
    revalidatePath("/configuracion");
    return ok("Marca agregada");
  });
}

export async function setBrandActive(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    await ctx.db((tx) => tx`update public.brands set is_active = ${formData.get("active") === "true"} where id = ${String(formData.get("id") ?? "")} and org_id = ${ctx.org.id}`);
    revalidatePath("/configuracion");
    return ok("Marca actualizada");
  });
}

export async function addCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const parsed = parseForm(z.object({ name: zText(2, "Indique la categoría") }), formData);
    if (!parsed.ok) return parsed.state;
    await ctx.db((tx) => tx`insert into public.vehicle_categories (org_id, name) values (${ctx.org.id}, ${parsed.data.name})`);
    revalidatePath("/configuracion");
    return ok("Categoría agregada");
  });
}

export async function addBranch(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const parsed = parseForm(z.object({ name: zText(2, "Indique el nombre"), address: zOptionalText(), city: zOptionalText() }), formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`insert into public.branches (org_id, name, address, city) values (${ctx.org.id}, ${v.name}, ${v.address ?? null}, ${v.city ?? null})`);
    revalidatePath("/configuracion");
    return ok("Sucursal agregada");
  });
}

const docTypeSchema = z.object({
  entity_type: z.enum(["vehicle", "customer", "deal", "contract", "payment", "supplier_invoice", "trade_in", "expense", "cash_movement"]),
  name: zText(2, "Indique el nombre"),
  is_required: zCheckbox(),
  applies_to_condition: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["nuevo", "usado"]).optional()),
});

export async function addDocumentType(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    const parsed = parseForm(docTypeSchema, formData);
    if (!parsed.ok) return parsed.state;
    const v = parsed.data;
    await ctx.db((tx) => tx`insert into public.document_types (org_id, entity_type, name, is_required, applies_to_condition)
      values (${ctx.org.id}, ${v.entity_type}, ${v.name}, ${v.is_required}, ${v.applies_to_condition ?? null})`);
    revalidatePath("/configuracion");
    return ok("Tipo de documento agregado");
  });
}

export async function setDocumentTypeRequired(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["settings.manage"], async (ctx) => {
    await ctx.db((tx) => tx`update public.document_types set is_required = ${formData.get("required") === "true"} where id = ${String(formData.get("id") ?? "")} and org_id = ${ctx.org.id}`);
    revalidatePath("/configuracion");
    return ok("Tipo de documento actualizado");
  });
}

// ------------------------------------------------------------------ mi cuenta

const passwordSchema = z
  .object({ current: z.string().min(1, "Ingrese su contraseña actual"), password: z.string().min(12, "Mínimo 12 caracteres"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });

/** Cambio de contraseña propia; exige la contraseña actual. */
export async function changePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded([], async () => {
    if (isEmbeddedDemo()) return fail("La demo no usa contraseñas: se ingresa eligiendo un usuario.");
    const parsed = parseForm(passwordSchema, formData);
    if (!parsed.ok) return parsed.state;
    const user = await getAuthUser();
    if (!user?.email) return fail("Su sesión expiró. Ingrese nuevamente.");
    const supabase = await supabaseServer();
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
    if (check.error) return fail("La contraseña actual no es correcta", { fieldErrors: { current: ["Incorrecta"] } });
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return fail(`No se pudo cambiar la contraseña: ${error.message}`);
    return ok("Contraseña actualizada");
  });
}
