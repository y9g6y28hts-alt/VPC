"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zAmount, zDate, zOptUuid, zText, zUuid } from "@/server/action";

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);

export async function policiesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({
    max_discount_pct: num(0, 100), min_margin_pct: num(-100, 100), max_financing_months: num(1, 240).int(), min_effective_annual_rate_pct: num(0, 500),
    reservation_default_hours: num(1, 720).int(), reservation_max_days: num(1, 90).int(), reservation_expiry_alert_hours: num(1, 720).int(),
    stale_inventory_days: num(1, 3650).int(), import_delay_alert_days: num(0, 365).int(), payment_reconciliation_alert_days: num(0, 90).int(),
    payable_due_soon_days: num(0, 90).int(), installment_due_soon_days: num(0, 90).int(), grace_days: num(0, 60).int(),
    due_date_roll: z.enum(["none", "next_business_day"]), aging_buckets: z.string().regex(/^\s*\d+(\s*,\s*\d+)*\s*$/, "Use números separados por comas"),
    require_down_payment_before_delivery: z.string().optional(), require_full_payment_before_delivery: z.string().optional(),
    approval_segregation: z.string().optional(), collections_priority: z.enum(["overdue_amount", "days_past_due", "next_due"]),
  }), fd, async (i, db, ctx) => {
    const buckets = i.aging_buckets.split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
    await db.one(
      `update public.org_policies set max_discount_pct = $2, min_margin_pct = $3, max_financing_months = $4, min_effective_annual_rate = $5,
         reservation_default_hours = $6, reservation_max_days = $7, reservation_expiry_alert_hours = $8, stale_inventory_days = $9,
         import_delay_alert_days = $10, payment_reconciliation_alert_days = $11, payable_due_soon_days = $12, installment_due_soon_days = $13,
         grace_days = $14, due_date_roll = $15, aging_buckets = $16, require_down_payment_before_delivery = $17,
         require_full_payment_before_delivery = $18, approval_segregation = $19, collections_priority = $20, updated_at = now(), updated_by = auth.uid()
       where organization_id = $1 returning organization_id`,
      [ctx.org.id, i.max_discount_pct, i.min_margin_pct, i.max_financing_months, i.min_effective_annual_rate_pct / 100, i.reservation_default_hours,
       i.reservation_max_days, i.reservation_expiry_alert_hours, i.stale_inventory_days, i.import_delay_alert_days, i.payment_reconciliation_alert_days,
       i.payable_due_soon_days, i.installment_due_soon_days, i.grace_days, i.due_date_roll, buckets, i.require_down_payment_before_delivery === "on",
       i.require_full_payment_before_delivery === "on", i.approval_segregation === "on", i.collections_priority]);
    revalidatePath("/admin");
    return { message: "Políticas actualizadas (cambio auditado)." };
  });
}

export async function costConceptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ code: zText(1), include: z.enum(["true", "false"]) }), fd, async (i, db, ctx) => {
    await db.one("update public.cost_concepts set include_in_inventory_cost = $3 where organization_id = $1 and code = $2 returning code", [ctx.org.id, i.code, i.include === "true"]);
    revalidatePath("/admin");
  });
}

export async function membershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ user: zUuid, role: zText(2), active: z.enum(["true", "false"]) }), fd, async (i, db, ctx) => {
    await db.rpc("set_membership", { p_org: ctx.org.id, p_user: i.user, p_role: i.role, p_active: i.active === "true" });
    revalidatePath("/admin");
    return { message: "Rol actualizado (cambio de permisos auditado)." };
  });
}

export async function holidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ date: zDate, label: zText(2) }), fd, async (i, db, ctx) => {
    await db.rows("insert into public.org_holidays (organization_id, holiday_date, label) values ($1, $2, $3) on conflict do nothing", [ctx.org.id, i.date, i.label]);
    revalidatePath("/admin");
  });
}

export async function targetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), currency: z.enum(["USD", "PYG", "EUR"]), revenue: zAmount, units: z.coerce.number().int().min(0),
    salesperson: zOptUuid }), fd, async (i, db, ctx) => {
    await db.rows(
      `insert into public.sales_targets (organization_id, period_month, currency, target_revenue, target_units, salesperson_id, created_by)
       values ($1, ($2 || '-01')::date, $3, $4, $5, $6, auth.uid())
       on conflict (organization_id, period_month, coalesce(salesperson_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(category, ''), currency)
       do update set target_revenue = excluded.target_revenue, target_units = excluded.target_units`,
      [ctx.org.id, i.month, i.currency, i.revenue, i.units, i.salesperson]);
    revalidatePath("/admin");
    return { message: "Objetivo guardado." };
  });
}
