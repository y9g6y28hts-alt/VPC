// Fixture de integración: crea una organización aislada con un usuario por rol.
// Las pruebas no dependen del seed de demostración y pueden ejecutarse sobre
// cualquier base local migrada (npm run db:reset).
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { closePool, Db, withUser } from "@/server/gateway";
import { DomainError } from "@/server/errors";
import { addMonths } from "@/domain/finance/dates";
import { saveScenario, ScenarioParams } from "@/server/services/financing";

export const admin = new Pool({ connectionString: process.env.MH_ADMIN_DATABASE_URL });

export const ROLES = ["ceo", "cfo", "sales_manager", "sales_advisor", "collections", "inventory_manager",
  "imports_manager", "auditor", "tech_admin"] as const;
export type RoleKey = (typeof ROLES)[number] | "advisor2";

export interface Fixture {
  org: string;
  today: string;
  users: Record<RoleKey, { id: string; email: string }>;
  location: string;
  usdAccount: string;
  pygAccount: string;
  as<T>(who: RoleKey, fn: (db: Db) => Promise<T>, asOfDate?: string): Promise<T>;
  rpc<T = unknown>(who: RoleKey, fn: string, args: Record<string, unknown>, asOfDate?: string): Promise<T>;
  availableUnit(opts?: { list?: number; min?: number; cost?: number; currency?: "USD" | "PYG"; vin?: string }): Promise<string>;
  customer(name?: string): Promise<string>;
  approvedDeal(unit: string, customer: string, opts?: { price?: number; down?: number; plan?: Partial<ScenarioParams> | null }): Promise<string>;
}

export async function createFixture(): Promise<Fixture> {
  const today = (await admin.query<{ d: string }>("select current_date::text d")).rows[0].d;
  const tag = randomUUID().slice(0, 8);
  const users = {} as Fixture["users"];
  for (const role of [...ROLES, "advisor2"] as RoleKey[]) {
    const email = `${role}.${tag}@test.local`;
    const r = await admin.query<{ id: string }>("select auth_local.create_user($1, 'x', $2) id", [email, role]);
    users[role] = { id: r.rows[0].id, email };
  }
  const org = (await admin.query<{ id: string }>("select public.create_organization($1, 'USD', true, $2) id",
    [`Test ${tag}`, users.ceo.id])).rows[0].id;
  for (const role of [...ROLES, "advisor2"] as RoleKey[]) {
    if (role === "ceo") continue;
    await admin.query("insert into public.memberships (organization_id, user_id, role_code) values ($1, $2, $3)",
      [org, users[role].id, role === "advisor2" ? "sales_advisor" : role]);
  }
  const as = <T>(who: RoleKey, fn: (db: Db) => Promise<T>, asOfDate?: string) =>
    withUser({ sub: users[who].id, email: users[who].email }, fn, { asOfDate });
  const rpc = <T>(who: RoleKey, fn: string, args: Record<string, unknown>, asOfDate?: string) =>
    as<T>(who, (db) => db.rpc<T>(fn, args), asOfDate);

  const location = (await as("inventory_manager", (db) => db.one<{ id: string }>(
    "insert into public.locations (organization_id, code, name, kind) values ($1, 'S1', 'Salón', 'showroom') returning id", [org]))).id;
  const usdAccount = (await as("cfo", (db) => db.one<{ id: string }>(
    "insert into public.cash_accounts (organization_id, name, kind, currency, opening_balance) values ($1, 'Banco USD', 'bank', 'USD', 1000) returning id", [org]))).id;
  const pygAccount = (await as("cfo", (db) => db.one<{ id: string }>(
    "insert into public.cash_accounts (organization_id, name, kind, currency) values ($1, 'Banco PYG', 'bank', 'PYG') returning id", [org]))).id;

  let unitSeq = 0;
  const fx: Fixture = {
    org, today, users, location, usdAccount, pygAccount, as, rpc,
    async availableUnit(opts = {}) {
      unitSeq++;
      const currency = opts.currency ?? "USD";
      const id = await rpc<string>("inventory_manager", "create_unit", {
        p_org: org,
        p_unit: { category: "supercar", make: "Test", model: `Modelo ${unitSeq}`, model_year: 2024, currency, origin: "local_purchase", acquisition_status: "approved" },
        p_identifiers: [{ kind: "vin", value: opts.vin ?? `TST${tag}${String(unitSeq).padStart(6, "0")}` }],
      });
      await rpc("inventory_manager", "register_unit_cost", { p_unit: id, p_concept: "purchase_price", p_nature: "actual",
        p_amount: opts.cost ?? 80000, p_currency: currency });
      await rpc("inventory_manager", "change_unit_status", { p_unit: id, p_dimension: "acquisition", p_to: "acquired", p_reason: "test" });
      await rpc("inventory_manager", "receive_unit", { p_unit: id, p_location: location });
      const tasks = await as("inventory_manager", (db) => db.rows<{ id: string }>("select id from public.preparation_tasks where unit_id = $1", [id]));
      for (const t of tasks) await rpc("inventory_manager", "complete_preparation_task", { p_task: t.id, p_status: "done" });
      const docs = await as("inventory_manager", (db) => db.rows<{ id: string }>("select id from public.unit_documents where unit_id = $1", [id]));
      for (const doc of docs) await rpc("inventory_manager", "set_unit_document_status", { p_doc: doc.id, p_status: "verified" });
      await rpc("inventory_manager", "change_unit_status", { p_unit: id, p_dimension: "preparation", p_to: "ready", p_reason: "test" });
      await rpc("sales_manager", "set_unit_price", { p_unit: id, p_list: opts.list ?? 100000, p_minimum: opts.min ?? 95000, p_offer: null, p_reason: "test" });
      await rpc("inventory_manager", "change_unit_status", { p_unit: id, p_dimension: "commercial", p_to: "available", p_reason: "test" });
      return id;
    },
    async customer(name = "Cliente de prueba") {
      return (await as("sales_advisor", (db) => db.one<{ id: string }>(
        "insert into public.customers (organization_id, kind, display_name, owner_user_id) values ($1, 'individual', $2, $3) returning id",
        [org, name, users.sales_advisor.id]))).id;
    },
    async approvedDeal(unit, customer, opts = {}) {
      const deal = await rpc<string>("sales_advisor", "create_deal", { p_org: org, p_customer: customer, p_unit: unit });
      const price = opts.price ?? 98000;
      const down = opts.down ?? 38000;
      await rpc("sales_advisor", "update_deal_terms", { p_deal: deal, p_items: [{ unit_id: unit, negotiated_price: price }],
        p_cash_down: down, p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null,
        p_notes: null, p_valid_until: null });
      if (opts.plan !== null && price > down) {
        const plan = await as("sales_advisor", (db) => saveScenario(db, deal, "A", {
          system: "french", rateType: "effective_annual", rate: "0.12", termPeriods: 6, monthsPerPeriod: 1,
          startDate: today, firstDueDate: addMonths(today, 1), balloons: [], upfront: [], ...(opts.plan ?? {}),
        }));
        await rpc("sales_advisor", "select_financing_plan", { p_deal: deal, p_plan: plan });
      }
      const status = await rpc<string>("sales_advisor", "submit_deal", { p_deal: deal });
      if (status !== "approved") {
        const pending = await as("sales_manager", (db) => db.rows<{ id: string }>(
          "select id from public.approvals where entity_id = $1 and status = 'pending'", [deal]));
        for (const a of pending) await rpc("sales_manager", "decide_approval", { p_approval: a.id, p_decision: "approved", p_note: "ok test" });
      }
      return deal;
    },
  };
  return fx;
}

export async function expectDomainError(p: Promise<unknown>, code: DomainError["code"], match?: RegExp) {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    if (e.code !== code) throw new Error(`Se esperaba ${code} y se obtuvo ${e.code}: ${e.message}`);
    if (match && !match.test(e.message)) throw new Error(`Mensaje inesperado: ${e.message}`);
    return e;
  }
  throw new Error(`Se esperaba un error ${code} y la operación tuvo éxito`);
}

export async function teardown() {
  await admin.end();
  await closePool();
}
