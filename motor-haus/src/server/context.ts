import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { Db, withUser, TxOptions } from "./gateway";
import { currentClaims } from "./session";
import { DomainError } from "./errors";
import type { Claims } from "./gateway";

export interface AppContext {
  claims: Claims;
  user: { id: string; email: string; name: string; title: string | null };
  org: { id: string; name: string; isDemo: boolean; currency: string; legalName: string | null };
  role: string;
  perms: Set<string>;
  today: string;
}

async function load(claims: Claims): Promise<AppContext | null> {
  return withUser(claims, async (db) => {
    const m = await db.maybe<{ org_id: string; role_code: string; name: string; is_demo: boolean; default_currency: string; legal_name: string | null }>(
      `select m.organization_id org_id, m.role_code, o.name, o.is_demo, o.default_currency, o.legal_name
         from public.memberships m join public.organizations o on o.id = m.organization_id
        where m.user_id = auth.uid() and m.active order by m.created_at limit 1`);
    if (!m) return null;
    const profile = await db.one<{ full_name: string; title: string | null }>(
      "select full_name, title from public.user_profiles where id = auth.uid()");
    const perms = await db.rows<{ p: string }>("select public.my_permissions($1) p", [m.org_id]);
    const today = await db.one<{ d: string }>("select app.today()::text d");
    return {
      claims,
      user: { id: claims.sub, email: claims.email, name: profile.full_name, title: profile.title },
      org: { id: m.org_id, name: m.name, isDemo: m.is_demo, currency: m.default_currency, legalName: m.legal_name },
      role: m.role_code,
      perms: new Set(perms.map((p) => p.p)),
      today: today.d,
    };
  });
}

/** Contexto del usuario autenticado (una carga por request). Redirige al login si no hay sesión. */
export const getContext = cache(async (): Promise<AppContext> => {
  const claims = await currentClaims();
  if (!claims) redirect("/login");
  const ctx = await load(claims);
  if (!ctx) redirect("/login?error=sin-organizacion");
  return ctx;
});

/** Contexto para server actions: no redirige, lanza error de dominio. */
export async function actionContext(): Promise<AppContext> {
  const claims = await currentClaims();
  if (!claims) throw new DomainError("UNAUTHENTICATED", "La sesión expiró. Vuelva a ingresar.");
  const ctx = await load(claims);
  if (!ctx) throw new DomainError("FORBIDDEN", "El usuario no pertenece a ninguna organización activa.");
  return ctx;
}

export function can(ctx: AppContext, ...perms: string[]): boolean {
  return perms.some((p) => ctx.perms.has(p));
}

export function query<T>(ctx: AppContext, fn: (db: Db) => Promise<T>, opts?: TxOptions): Promise<T> {
  return withUser(ctx.claims, fn, opts);
}
