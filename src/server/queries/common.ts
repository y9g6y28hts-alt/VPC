import "server-only";
import type { AppContext } from "@/server/auth/context";

export interface OrgSettings {
  max_discount_pct_without_approval: string;
  reservation_default_days: number;
  aging_alert_days: number;
  proposal_validity_days: number;
  payables_due_soon_days: number;
  default_rate_convention: "nominal_annual" | "effective_annual" | "monthly";
  require_down_payment_before_delivery: boolean;
}

export async function getSettings(ctx: AppContext): Promise<OrgSettings> {
  const [s] = await ctx.db((tx) => tx<OrgSettings[]>`select * from public.org_settings where org_id = ${ctx.org.id}`);
  return s!;
}

export async function getToday(ctx: AppContext): Promise<string> {
  const [r] = await ctx.db((tx) => tx<{ d: string }[]>`select app.org_today(${ctx.org.id})::text as d`);
  return r!.d;
}

export async function listBrands(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; name: string }[]>`
    select id, name from public.brands where org_id = ${ctx.org.id} and is_active order by sort_order, name`);
}

export async function listCategories(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; name: string }[]>`select id, name from public.vehicle_categories where org_id = ${ctx.org.id} order by name`);
}

export async function listBranches(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; name: string }[]>`select id, name from public.branches where org_id = ${ctx.org.id} and is_active order by name`);
}

/** Miembros activos, opcionalmente filtrados por roles. */
export async function listMembers(ctx: AppContext, roles?: string[]) {
  return ctx.db((tx) => tx<{ id: string; full_name: string; role: string }[]>`
    select u.id, u.full_name, m.role from public.memberships m join public.user_profiles u on u.id = m.user_id
    where m.org_id = ${ctx.org.id} and m.is_active and u.is_active
      ${roles?.length ? tx`and m.role = any(${roles})` : tx``}
    order by u.full_name`);
}

export async function listSuppliers(ctx: AppContext) {
  return ctx.db((tx) => tx<{ id: string; name: string; kind: string }[]>`
    select id, name, kind from public.suppliers where org_id = ${ctx.org.id} and is_active order by name`);
}

export async function listCashAccounts(ctx: AppContext, currency?: string) {
  return ctx.db((tx) => tx<{ id: string; name: string; currency: "PYG" | "USD"; kind: string }[]>`
    select id, name, currency, kind from public.cash_accounts where org_id = ${ctx.org.id} and is_active
      ${currency ? tx`and currency = ${currency}` : tx``}
    order by currency, name`);
}

export async function latestRate(ctx: AppContext, from: string, to: string): Promise<{ rate: number; date: string } | null> {
  if (from === to) return { rate: 1, date: "" };
  const [r] = await ctx.db((tx) => tx<{ rate: string; rate_date: string }[]>`
    select rate, rate_date from public.exchange_rates where org_id = ${ctx.org.id} and from_currency = ${from} and to_currency = ${to}
    order by rate_date desc limit 1`);
  if (r) return { rate: Number(r.rate), date: r.rate_date };
  const [inv] = await ctx.db((tx) => tx<{ rate: string; rate_date: string }[]>`
    select rate, rate_date from public.exchange_rates where org_id = ${ctx.org.id} and from_currency = ${to} and to_currency = ${from}
    order by rate_date desc limit 1`);
  return inv ? { rate: 1 / Number(inv.rate), date: inv.rate_date } : null;
}
