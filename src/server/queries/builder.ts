import "server-only";
import type { AppContext } from "@/server/auth/context";
import { getSettings, getToday } from "./common";
import { customerOptions } from "./customers";
import { sellableVehicles } from "./inventory";
import { tradeInOptions } from "./sales";

/** Datos que necesita el constructor de operaciones / simulador. */
export async function builderData(ctx: AppContext, opts: { excludeDealId?: string; includeVehicleId?: string } = {}) {
  const [customers, vehicles, appraisals, settings, today, phones] = await Promise.all([
    customerOptions(ctx),
    sellableVehicles(ctx),
    ctx.perms.has("tradein.view") ? tradeInOptions(ctx, opts.excludeDealId) : Promise.resolve([]),
    getSettings(ctx),
    getToday(ctx),
    ctx.db((tx) => tx<{ id: string; phone: string | null }[]>`select id, phone from public.customers where org_id = ${ctx.org.id}`),
  ]);
  type VehicleOption = { id: string; label: string; price_currency: "PYG" | "USD"; list_price: string | null; min_price: string | null };
  let list: VehicleOption[] = [...vehicles];
  const include = opts.includeVehicleId;
  if (include && !list.some((v) => v.id === include)) {
    const extra = await ctx.db((tx) => tx<VehicleOption[]>`
      select v.id, v.stock_code || ' · ' || b.name || ' ' || v.model || coalesce(' ' || v.version, '') || ' ' || v.year_model as label,
             v.price_currency, v.list_price, v.min_price
      from public.vehicles v join public.brands b on b.id = v.brand_id where v.id = ${include}`);
    list = [...extra, ...list];
  }
  return {
    customers,
    vehicles: list.map((v) => ({ id: v.id, label: v.label, price_currency: v.price_currency, list_price: v.list_price, min_price: v.min_price })),
    appraisals: appraisals.map((a) => ({ ...a })),
    maxDiscountPct: Number(settings.max_discount_pct_without_approval),
    defaultConvention: settings.default_rate_convention,
    today,
    customerPhones: Object.fromEntries(phones.map((p) => [p.id, p.phone])),
  };
}
