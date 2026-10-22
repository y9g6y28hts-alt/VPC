import { randomUUID } from "node:crypto";
import { createSql, withUser, type Tx } from "@/server/db/client";
import type { Role } from "@/domain/permissions";

const ADMIN = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres_dev_only@127.0.0.1:5432/dasilva_test";
const APP = process.env.TEST_DATABASE_URL ?? "postgres://dasilva_app:dasilva_app_dev_only@127.0.0.1:5432/dasilva_test";

/** Conexión privilegiada: sólo para preparar escenarios (equivale a service_role). */
export const admin = createSql(ADMIN, { max: 4 });
/** Conexión de la aplicación: la misma que usa el servidor Next.js. */
export const app = createSql(APP, { max: 12 });

export function as<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUser({ userId }, fn, app);
}

export async function closeAll() {
  await Promise.all([admin.end(), app.end()]);
}

export interface OrgFixture {
  orgId: string;
  brandId: string;
  pygAccount: string;
  usdAccount: string;
  users: Record<Role, string>;
}

export async function createUser(orgId: string, role: Role, name = role): Promise<string> {
  const id = randomUUID();
  await admin`insert into auth.users (id, email) values (${id}, ${`${name}.${id.slice(0, 6)}@test.local`})`;
  await admin`insert into public.user_profiles (id, full_name) values (${id}, ${name})`;
  await admin`insert into public.memberships (org_id, user_id, role) values (${orgId}, ${id}, ${role})`;
  return id;
}

export async function createOrg(name = "Org prueba"): Promise<OrgFixture> {
  const [org] = await admin<{ id: string }[]>`insert into public.organizations (name) values (${name}) returning id`;
  const orgId = org!.id;
  const [brand] = await admin<{ id: string }[]>`insert into public.brands (org_id, name) values (${orgId}, 'Ford') returning id`;
  const [pyg] = await admin<{ id: string }[]>`
    insert into public.cash_accounts (org_id, name, kind, currency) values (${orgId}, 'Caja PYG', 'caja', 'PYG') returning id`;
  const [usd] = await admin<{ id: string }[]>`
    insert into public.cash_accounts (org_id, name, kind, currency) values (${orgId}, 'Banco USD', 'banco', 'USD') returning id`;
  const roles: Role[] = ["director", "administracion", "gerencia_comercial", "vendedor", "cobranzas", "inventario", "finanzas", "auditor", "admin_tecnico"];
  const users = {} as Record<Role, string>;
  for (const r of roles) users[r] = await createUser(orgId, r);
  return { orgId, brandId: brand!.id, pygAccount: pyg!.id, usdAccount: usd!.id, users };
}

export async function createVehicle(f: OrgFixture, patch: Partial<{ list_price: number; min_price: number; price_currency: string; acquisition_date: string }> = {}): Promise<string> {
  return as(f.users.inventario, async (tx) => {
    const [v] = await tx<{ id: string }[]>`
      insert into public.vehicles (org_id, brand_id, model, version, year_manufacture, year_model, mileage_km, fuel,
                                   transmission, condition, price_currency, list_price, min_price, acquisition_date, created_by)
      values (${f.orgId}, ${f.brandId}, 'Ranger', 'XLT 3.2', 2025, 2026, 0, 'diesel', 'automatica', 'nuevo',
              ${patch.price_currency ?? "PYG"}, ${patch.list_price ?? 300_000_000}, ${patch.min_price ?? 280_000_000},
              ${patch.acquisition_date ?? "2026-08-01"}, ${f.users.inventario})
      returning id`;
    return v!.id;
  });
}

export async function createCustomer(f: OrgFixture, sellerId?: string, doc = String(Math.floor(Math.random() * 9e6) + 1e6)): Promise<string> {
  const creator = sellerId ?? f.users.gerencia_comercial;
  return as(creator, async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      insert into public.customers (org_id, kind, full_name, doc_type, doc_number, phone, assigned_seller_id, created_by)
      values (${f.orgId}, 'persona', ${"Cliente " + doc}, 'ci', ${doc}, ${"0981" + doc.slice(-6)}, ${sellerId ?? null}, ${creator})
      returning id`;
    return c!.id;
  });
}

/** Ejecuta y devuelve el mensaje de error de Postgres (o null si no falla). */
export async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function n(v: unknown): number {
  return Number(v);
}
