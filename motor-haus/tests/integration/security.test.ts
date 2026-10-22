import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withUser } from "@/server/gateway";
import { admin, createFixture, expectDomainError, Fixture, teardown } from "./fixture";

let fx: Fixture;
let other: Fixture;
let unit: string;
let customer: string;
let deal: string;
let contract: string;

beforeAll(async () => {
  fx = await createFixture();
  other = await createFixture();
  unit = await fx.availableUnit();
  customer = await fx.customer("Cliente Seguridad");
  await fx.rpc("sales_advisor", "set_customer_sensitive", { p_customer: customer, p_document_type: "ci", p_document_number: `9.${randomUUID().slice(0, 6)}`,
    p_tax_id: null, p_address: "Calle privada 123" });
  deal = await fx.approvedDeal(unit, customer, {});
  contract = await fx.rpc<string>("cfo", "formalize_deal", { p_deal: deal });
});
afterAll(teardown);

describe("aislamiento por organización", () => {
  it("un usuario de otra organización no ve unidades, clientes ni contratos", async () => {
    const r = await other.as("ceo", (db) => db.one<{ u: string; c: string; k: string }>(
      `select (select count(*) from public.units where organization_id = $1) u,
              (select count(*) from public.customers where organization_id = $1) c,
              (select count(*) from public.sales_contracts where organization_id = $1) k`, [fx.org]));
    expect(r).toEqual({ u: "0", c: "0", k: "0" });
    await expectDomainError(other.rpc("ceo", "get_deal_economics", { p_deal: deal }), "FORBIDDEN");
    await expectDomainError(other.rpc("cfo", "reserve_unit", { p_unit: unit, p_customer: customer, p_conditions: "Intento externo" }), "FORBIDDEN");
  });

  it("sin claims (anónimo) no se lee nada", async () => {
    const n = await withUser({ sub: randomUUID(), email: "nadie@test.local" }, (db) =>
      db.one<{ n: string }>("select count(*) n from public.units"));
    expect(n.n).toBe("0");
  });

  it("el rol de conexión del servidor no tiene privilegios propios sin SET ROLE", async () => {
    const raw = new Pool({ connectionString: process.env.DATABASE_URL });
    await expect(raw.query("select count(*) from public.units")).rejects.toThrow(/permission denied/);
    await raw.end();
  });
});

describe("permisos por rol", () => {
  it("el asesor no ve costes de inventario: obtiene null, no cero", async () => {
    const rows = await fx.as("sales_advisor", (db) => db.rows("select * from public.unit_costs where unit_id = $1", [unit]));
    expect(rows).toHaveLength(0);
    const o = await fx.as("sales_advisor", (db) => db.one<{ cost_actual: string | null }>("select cost_actual from public.unit_overview where id = $1", [unit]));
    expect(o.cost_actual).toBeNull();
  });

  it("el asesor ve sus operaciones pero no las de otro asesor", async () => {
    const own = await fx.as("sales_advisor", (db) => db.rows("select id from public.deals where id = $1", [deal]));
    const foreign = await fx.as("advisor2", (db) => db.rows("select id from public.deals where id = $1", [deal]));
    expect(own).toHaveLength(1);
    expect(foreign).toHaveLength(0);
    const inst = await fx.as("advisor2", (db) => db.rows("select id from public.receivable_installments where contract_id = $1", [contract]));
    expect(inst).toHaveLength(0);
  });

  it("los documentos de identidad no se leen por columna; solo vía función auditada", async () => {
    await expectDomainError(fx.as("sales_manager", (db) => db.rows("select document_number from public.customers where id = $1", [customer])), "FORBIDDEN");
    await expectDomainError(fx.rpc("sales_advisor", "get_customer_sensitive", { p_customer: customer }), "FORBIDDEN");
    const pii = await fx.as("collections", (db) => db.rows<{ document_type: string; address: string }>(
      "select * from public.get_customer_sensitive($1)", [customer]));
    expect(pii[0].address).toBe("Calle privada 123");
    const audit = await fx.as("auditor", (db) => db.rows<{ after_data: unknown }>(
      "select after_data from public.audit_events where action = 'customer.pii.view' and entity_id = $1", [customer]));
    expect(audit.length).toBeGreaterThan(0);
    // la auditoría de filas no copia el documento completo
    const rowAudit = await fx.as("auditor", (db) => db.rows<{ after_data: Record<string, unknown> }>(
      "select after_data from public.audit_events where entity_type = 'customers' and entity_id = $1", [customer]));
    expect(rowAudit.every((r) => !r.after_data || !("document_number" in r.after_data))).toBe(true);
  });

  it("el auditor lee pero no modifica", async () => {
    const c = await fx.as("auditor", (db) => db.rows("select id from public.sales_contracts where id = $1", [contract]));
    expect(c).toHaveLength(1);
    await expectDomainError(fx.rpc("auditor", "record_cash_movement", { p_account: fx.usdAccount, p_date: fx.today, p_amount: -10,
      p_category: "operating_expense", p_description: "Intento" }), "FORBIDDEN");
    // RLS no expone filas actualizables al auditor: el UPDATE no afecta nada.
    await fx.as("auditor", (db) => db.rows("update public.units set exterior_color = 'x' where id = $1", [unit]));
    const r = await fx.as("cfo", (db) => db.one<{ exterior_color: string | null }>("select exterior_color from public.units where id = $1", [unit]));
    expect(r.exterior_color).not.toBe("x");
  });

  it("el administrador técnico no accede a datos financieros", async () => {
    const r = await fx.as("tech_admin", (db) => db.one<{ p: string; m: string; i: string }>(
      `select (select count(*) from public.customer_payments) p, (select count(*) from public.cash_movements) m,
              (select count(*) from public.receivable_installments) i`));
    expect(r).toEqual({ p: "0", m: "0", i: "0" });
    const snap = await fx.rpc<Record<string, unknown>>("tech_admin", "executive_snapshot", { p_org: fx.org, p_currency: "USD", p_from: fx.today, p_to: fx.today });
    expect(snap.cash).toBeNull();
    expect(snap.receivables).toBeNull();
  });

  it("solo funciones permitidas: un asesor no crea organizaciones ni toca auditoría", async () => {
    await expectDomainError(fx.as("sales_advisor", (db) => db.rows("select public.create_organization('X', 'USD')")), "FORBIDDEN");
    await expect(admin.query("update public.audit_events set action = 'x' where organization_id = $1", [fx.org])).rejects.toThrow(/no admite modificaciones/);
  });

  it("las aprobaciones verifican el permiso en el servidor", async () => {
    const u2 = await fx.availableUnit({ list: 100000, min: 99000 });
    const d2 = await fx.rpc<string>("sales_advisor", "create_deal", { p_org: fx.org, p_customer: customer, p_unit: u2 });
    await fx.rpc("sales_advisor", "update_deal_terms", { p_deal: d2, p_items: [{ unit_id: u2, negotiated_price: 90000 }], p_cash_down: 90000,
      p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null, p_notes: null, p_valid_until: null });
    await fx.rpc("sales_advisor", "submit_deal", { p_deal: d2 });
    const a = await fx.as("sales_manager", (db) => db.one<{ id: string }>("select id from public.approvals where entity_id = $1 and status = 'pending' limit 1", [d2]));
    await expectDomainError(fx.rpc("collections", "decide_approval", { p_approval: a.id, p_decision: "approved", p_note: "no corresponde" }), "FORBIDDEN");
    await expectDomainError(fx.rpc("cfo", "formalize_deal", { p_deal: d2 }), "STATE");
  });
});
