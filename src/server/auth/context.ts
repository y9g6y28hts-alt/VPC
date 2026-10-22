import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PermissionSet, type Permission, type Role, isRole } from "@/domain/permissions";
import { getSql, isEmbeddedDemo, withUser, type Tx } from "@/server/db/client";
import { readDemoSession } from "./demo-session";
import { isSetupError } from "@/server/health";
import { supabaseServer } from "@/server/supabase";

export const ORG_COOKIE = "ds_org";

export interface OrgSummary {
  id: string;
  name: string;
  isDemo: boolean;
  role: Role;
  baseCurrency: "PYG" | "USD";
  timezone: string;
}

export interface AppContext {
  userId: string;
  email: string | null;
  fullName: string;
  org: OrgSummary;
  orgs: OrgSummary[];
  perms: PermissionSet;
  /** Ejecuta consultas como este usuario (RLS activo). */
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

/** Usuario autenticado validado contra Supabase Auth (no sólo la cookie). */
export const getAuthUser = cache(async (): Promise<{ id: string; email?: string | null } | null> => {
  if (isEmbeddedDemo()) {
    const id = await readDemoSession();
    if (!id) return null;
    const sql = await getSql();
    const [u] = await sql<{ id: string; email: string | null }[]>`select id, email from auth.users where id = ${id}`;
    return u ?? null;
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/**
 * Contexto de la petición: usuario, organización activa y permisos efectivos
 * leídos de la base de datos. Redirige al ingreso si no hay sesión.
 */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const identity = { userId: user.id, email: user.email ?? null };
  const db = <T,>(fn: (tx: Tx) => Promise<T>) => withUser(identity, fn);

  const rows = await db(
    (tx) => tx<
      { id: string; name: string; is_demo: boolean; role: string; base_currency: string; timezone: string; full_name: string }[]
    >`
      select o.id, o.name, o.is_demo, m.role, o.base_currency, o.timezone, u.full_name
      from public.memberships m
      join public.organizations o on o.id = m.org_id
      join public.user_profiles u on u.id = m.user_id
      where m.user_id = ${user.id} and m.is_active and u.is_active
      order by o.is_demo, o.name`,
  );
  const orgs: OrgSummary[] = rows
    .filter((r) => isRole(r.role))
    .map((r) => ({
      id: r.id,
      name: r.name,
      isDemo: r.is_demo,
      role: r.role as Role,
      baseCurrency: r.base_currency === "USD" ? "USD" : "PYG",
      timezone: r.timezone,
    }));
  if (!orgs.length) return null;

  const store = await cookies();
  const wanted = store.get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0]!;

  const perms = await db(
    (tx) => tx<{ permission: string }[]>`select permission from public.role_permissions where role = ${org.role}`,
  );

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: rows[0]!.full_name,
    org,
    orgs,
    perms: new PermissionSet(perms.map((p) => p.permission)),
    db,
  };
});

export async function requireContext(): Promise<AppContext> {
  let ctx: AppContext | null;
  try {
    ctx = await getContext();
  } catch (err) {
    // Configuración incompleta (variables, base, migraciones): diagnóstico en vez de error genérico.
    if (isSetupError(err)) redirect("/estado");
    throw err;
  }
  if (!ctx) {
    const user = await getAuthUser();
    redirect(user ? "/sin-acceso?motivo=sin-organizacion" : "/ingresar");
  }
  return ctx;
}

/** Exige al menos uno de los permisos indicados; si no, pantalla de sin acceso. */
export async function requirePerm(...anyOf: Permission[]): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.perms.any(...anyOf)) redirect(`/sin-acceso?permiso=${encodeURIComponent(anyOf.join(","))}`);
  return ctx;
}
