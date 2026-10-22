import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { addDays, addMonths } from "@/domain/finance/dates";
import { buildPlan, ENGINE_VERSION } from "@/domain/finance/engine";
import { getDealEconomics } from "@/server/services/financing";
import { admin, createFixture, expectDomainError, Fixture, teardown } from "./fixture";

let fx: Fixture;
beforeAll(async () => { fx = await createFixture(); });
afterAll(teardown);

describe("inventario", () => {
  it("una unidad recibida no queda disponible automáticamente y exige requisitos", async () => {
    const id = await fx.rpc<string>("inventory_manager", "create_unit", {
      p_org: fx.org, p_unit: { category: "classic", make: "Test", model: "Pendiente", currency: "USD", acquisition_status: "approved" }, p_identifiers: [] });
    await fx.rpc("inventory_manager", "register_unit_cost", { p_unit: id, p_concept: "purchase_price", p_nature: "actual", p_amount: 50000, p_currency: "USD" });
    await fx.rpc("inventory_manager", "change_unit_status", { p_unit: id, p_dimension: "acquisition", p_to: "acquired", p_reason: "test" });
    await fx.rpc("inventory_manager", "receive_unit", { p_unit: id, p_location: fx.location });
    const u = await fx.as("inventory_manager", (db) => db.one<{ commercial_status: string; preparation_status: string; display_status: string }>(
      "select commercial_status, preparation_status, display_status from public.unit_overview where id = $1", [id]));
    expect(u).toMatchObject({ commercial_status: "not_listed", preparation_status: "in_preparation", display_status: "in_preparation" });
    await expectDomainError(fx.rpc("inventory_manager", "change_unit_status", { p_unit: id, p_dimension: "preparation", p_to: "ready", p_reason: "test" }),
      "STATE", /tareas obligatorias/);
    await expectDomainError(fx.rpc("inventory_manager", "change_unit_status", { p_unit: id, p_dimension: "commercial", p_to: "available", p_reason: "test" }),
      "STATE", /no puede habilitarse/);
  });

  it("el rol authenticated no puede cambiar estado ni precio con un UPDATE directo", async () => {
    const id = await fx.availableUnit();
    await expectDomainError(fx.as("inventory_manager", (db) => db.rows("update public.units set commercial_status = 'delivered' where id = $1", [id])),
      "FORBIDDEN");
    await expectDomainError(fx.as("sales_manager", (db) => db.rows("update public.units set list_price = 1 where id = $1", [id])), "FORBIDDEN");
    // Campos descriptivos sí son editables
    await fx.as("inventory_manager", (db) => db.rows("update public.units set exterior_color = 'Azul' where id = $1", [id]));
  });

  it("los cambios de precio quedan en el historial con motivo y concurrencia optimista", async () => {
    const id = await fx.availableUnit();
    const v = await fx.as("sales_manager", (db) => db.one<{ row_version: number }>("select row_version from public.units where id = $1", [id]));
    await fx.rpc("sales_manager", "set_unit_price", { p_unit: id, p_list: 99000, p_minimum: 94000, p_offer: null, p_reason: "Ajuste", p_expected_version: v.row_version });
    await expectDomainError(fx.rpc("sales_manager", "set_unit_price", { p_unit: id, p_list: 98000, p_minimum: 94000, p_offer: null, p_reason: "Ajuste", p_expected_version: v.row_version }),
      "CONFLICT");
    const hist = await fx.as("sales_manager", (db) => db.rows("select * from public.unit_price_history where unit_id = $1 and reason = 'Ajuste'", [id]));
    expect(hist).toHaveLength(2); // lista y mínimo
  });

  it("los costes estimados y reales se suman por separado; otra moneda exige cotización", async () => {
    const id = await fx.availableUnit({ cost: 70000 });
    const est = await fx.rpc<string>("inventory_manager", "register_unit_cost", { p_unit: id, p_concept: "repairs", p_nature: "estimated", p_amount: 3000, p_currency: "USD" });
    await expectDomainError(fx.rpc("inventory_manager", "register_unit_cost", { p_unit: id, p_concept: "taxes", p_nature: "actual", p_amount: 1000000, p_currency: "PYG" }),
      "VALIDATION", /cotización/);
    await fx.rpc("inventory_manager", "register_unit_cost", { p_unit: id, p_concept: "taxes", p_nature: "actual", p_amount: 7500000, p_currency: "PYG",
      p_fx_rate: 0.000133, p_fx_date: fx.today, p_fx_source: "Cotización BCP" });
    await fx.rpc("inventory_manager", "register_unit_cost", { p_unit: id, p_concept: "repairs", p_nature: "actual", p_amount: 3200, p_currency: "USD", p_settles_estimate: est });
    const c = await fx.as("cfo", (db) => db.one<{ cost_actual: string; cost_estimated_pending: string }>(
      "select cost_actual, cost_estimated_pending from public.unit_cost_summary where unit_id = $1", [id]));
    expect(c.cost_actual).toBe("74197.50"); // 70000 + 997.50 + 3200
    expect(Number(c.cost_estimated_pending)).toBe(0);
  });

  it("VIN duplicado rechazado salvo excepción documentada", async () => {
    const vin = `DUP${randomUUID().slice(0, 10)}`;
    await fx.availableUnit({ vin });
    await expectDomainError(fx.rpc("inventory_manager", "create_unit", { p_org: fx.org,
      p_unit: { category: "other", make: "X", model: "Y", currency: "USD" }, p_identifiers: [{ kind: "vin", value: vin.toLowerCase() }] }), "CONFLICT");
    await fx.rpc("inventory_manager", "create_unit", { p_org: fx.org, p_unit: { category: "classic", make: "X", model: "Y", currency: "USD" },
      p_identifiers: [{ kind: "vin", value: vin, allow_duplicate: true, duplicate_reason: "Chasis reutilizado de época documentado" }] });
  });
});

describe("reservas y ventas: integridad transaccional", () => {
  it("dos reservas simultáneas de la misma unidad: solo una tiene éxito", async () => {
    const unit = await fx.availableUnit();
    const [c1, c2] = [await fx.customer("Cliente A"), await fx.customer("Cliente B")];
    const results = await Promise.allSettled([
      fx.rpc("sales_advisor", "reserve_unit", { p_unit: unit, p_customer: c1, p_conditions: "Reserva simultánea 1" }),
      fx.rpc("advisor2", "reserve_unit", { p_unit: unit, p_customer: c2, p_conditions: "Reserva simultánea 2" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("CONFLICT");
    const active = await fx.as("cfo", (db) => db.rows("select id from public.reservations where unit_id = $1 and status = 'active'", [unit]));
    expect(active).toHaveLength(1);
  });

  it("no se puede vender dos veces la misma unidad, ni siquiera en paralelo", async () => {
    const unit = await fx.availableUnit();
    const d1 = await fx.approvedDeal(unit, await fx.customer("Cliente C"), { down: 98000, plan: null });
    const d2 = await fx.approvedDeal(unit, await fx.customer("Cliente D"), { down: 98000, plan: null });
    const results = await Promise.allSettled([
      fx.rpc("cfo", "formalize_deal", { p_deal: d1 }),
      fx.rpc("ceo", "formalize_deal", { p_deal: d2 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("CONFLICT");
    const u = await fx.as("cfo", (db) => db.one<{ commercial_status: string }>("select commercial_status from public.units where id = $1", [unit]));
    expect(u.commercial_status).toBe("sold_pending_delivery");
  });

  it("una reserva vencida libera la unidad", async () => {
    const unit = await fx.availableUnit();
    const res = await fx.rpc<string>("sales_advisor", "reserve_unit", { p_unit: unit, p_customer: await fx.customer(), p_conditions: "Reserva corta", p_hours: 1 });
    await admin.query("update public.reservations set expires_at = now() - interval '1 minute' where id = $1", [res]);
    await fx.rpc("advisor2", "reserve_unit", { p_unit: unit, p_customer: await fx.customer(), p_conditions: "Nueva reserva válida" });
    const r = await fx.as("cfo", (db) => db.one<{ status: string }>("select status from public.reservations where id = $1", [res]));
    expect(r.status).toBe("expired");
  });
});

describe("mesa de negociación y aprobaciones", () => {
  it("descuento sobre el límite exige aprobación y el vendedor no puede aprobarse", async () => {
    const unit = await fx.availableUnit({ list: 100000, min: 90000, cost: 70000 });
    const deal = await fx.rpc<string>("sales_advisor", "create_deal", { p_org: fx.org, p_customer: await fx.customer(), p_unit: unit });
    await fx.rpc("sales_advisor", "update_deal_terms", { p_deal: deal, p_items: [{ unit_id: unit, negotiated_price: 91000 }], p_cash_down: 91000,
      p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null, p_notes: null, p_valid_until: null });
    expect(await fx.rpc("sales_advisor", "submit_deal", { p_deal: deal })).toBe("pending_approval");
    const approvals = await fx.as("sales_manager", (db) => db.rows<{ id: string; rule: string }>(
      "select id, rule from public.approvals where entity_id = $1 and status = 'pending'", [deal]));
    expect(approvals.map((a) => a.rule)).toEqual(["discount"]);
    await expectDomainError(fx.rpc("sales_advisor", "decide_approval", { p_approval: approvals[0].id, p_decision: "approved", p_note: "auto" }), "FORBIDDEN");
    // Cambiar términos anula la solicitud
    await fx.rpc("sales_advisor", "update_deal_terms", { p_deal: deal, p_items: [{ unit_id: unit, negotiated_price: 92000 }], p_cash_down: 92000,
      p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null, p_notes: null, p_valid_until: null });
    const a = await fx.as("sales_manager", (db) => db.one<{ status: string }>("select status from public.approvals where id = $1", [approvals[0].id]));
    expect(a.status).toBe("void");
    await expectDomainError(fx.rpc("cfo", "formalize_deal", { p_deal: deal }), "STATE", /aprobadas/);
  });

  it("el margen usa los costes registrados y separa el trade-in", async () => {
    const unit = await fx.availableUnit({ cost: 80000 });
    const deal = await fx.rpc<string>("sales_advisor", "create_deal", { p_org: fx.org, p_customer: await fx.customer(), p_unit: unit });
    const e = await fx.as("sales_advisor", (db) => getDealEconomics(db, deal));
    expect(Number(e.gross_margin_estimated)).toBe(20000);
    expect(Number(e.trade_in_estimated_margin)).toBe(0);
    expect(Number(e.financed_principal)).toBe(100000);
  });

  it("el servidor rechaza calendarios manipulados o con capital distinto", async () => {
    const unit = await fx.availableUnit();
    const deal = await fx.rpc<string>("sales_advisor", "create_deal", { p_org: fx.org, p_customer: await fx.customer(), p_unit: unit });
    const plan = buildPlan({ system: "french", currency: "USD", principal: "100000.00", rateType: "effective_annual", rate: "0.12",
      termPeriods: 12, monthsPerPeriod: 1, startDate: fx.today, firstDueDate: addMonths(fx.today, 1), balloons: [], upfront: [] });
    const save = (schedule: unknown, inputs: unknown = plan.inputs) => fx.rpc("sales_advisor", "save_financing_plan", {
      p_deal: deal, p_label: "X", p_inputs: inputs, p_summary: plan.summary, p_schedule: schedule, p_engine_version: ENGINE_VERSION });
    await save(plan.schedule); // válido
    const tampered = structuredClone(plan.schedule);
    tampered[3].interest = "1.00";
    tampered[3].payment = (Number(tampered[3].principal) + 1).toFixed(2);
    await expectDomainError(save(tampered), "VALIDATION", /interés/);
    await expectDomainError(save(plan.schedule, { ...plan.inputs, principal: "90000.00" }), "VALIDATION", /capital/);
    await expectDomainError(save(plan.schedule, { ...plan.inputs, rate: "0.01" }), "VALIDATION", /tasa/);
  });

  it("formalizar genera obligaciones que reconcilian con el contrato", async () => {
    const unit = await fx.availableUnit();
    const deal = await fx.approvedDeal(unit, await fx.customer(), { price: 98000, down: 38000,
      plan: { balloons: [{ period: 3, amount: "10000.00" }] } });
    const contract = await fx.rpc<string>("cfo", "formalize_deal", { p_deal: deal });
    const cb = await fx.as("cfo", (db) => db.one<{ total_principal_scheduled: string; schedule_discrepancy: string; financed_principal: string }>(
      "select total_principal_scheduled, schedule_discrepancy, financed_principal from public.contract_balances where contract_id = $1", [contract]));
    expect(cb.financed_principal).toBe("60000.00");
    expect(cb.total_principal_scheduled).toBe("98000.00");
    expect(cb.schedule_discrepancy).toBe("0.00");
    const kinds = await fx.as("cfo", (db) => db.rows<{ kind: string; n: string }>(
      "select kind, count(*) n from public.receivable_installments where contract_id = $1 group by kind order by kind", [contract]));
    expect(kinds).toEqual([{ kind: "balloon", n: "1" }, { kind: "down_payment", n: "1" }, { kind: "installment", n: "6" }]);
    await expectDomainError(fx.as("cfo", (db) => db.rows("update public.receivable_installments set principal_amount = 1 where contract_id = $1", [contract])),
      "FORBIDDEN");
  });

  it("las tasaciones no crean inventario hasta la adquisición formal", async () => {
    const customer = await fx.customer();
    const before = await fx.as("cfo", (db) => db.one<{ n: string }>("select count(*) n from public.units where organization_id = $1", [fx.org]));
    const ap = await fx.rpc<string>("sales_advisor", "create_appraisal", { p_org: fx.org, p_customer: customer, p_data: { make: "BMW", model: "M3", currency: "USD" } });
    await fx.rpc("sales_advisor", "record_appraisal_inspection", { p_appraisal: ap, p_items: [], p_conditions: { documentation_status: "complete" } });
    await expectDomainError(fx.rpc("sales_advisor", "value_appraisal", { p_appraisal: ap, p_market_value: 50000, p_market_source: "", p_market_date: fx.today,
      p_proposed_price: 40000, p_expected_resale: 50000, p_uncertainty: "low" }), "VALIDATION", /fuente/);
    const econ = await fx.rpc<{ estimated_margin: number; estimated_margin_pct: number }>("sales_advisor", "value_appraisal", { p_appraisal: ap,
      p_market_value: 50000, p_market_source: "Comparables", p_market_date: fx.today, p_proposed_price: 40000, p_expected_resale: 50000, p_uncertainty: "low" });
    expect(Number(econ.estimated_margin)).toBe(10000);
    expect(Number(econ.estimated_margin_pct)).toBe(20);
    expect(await fx.rpc("sales_advisor", "submit_appraisal", { p_appraisal: ap })).toBe("approved");
    await expectDomainError(fx.rpc("sales_manager", "acquire_trade_in", { p_appraisal: ap, p_location: fx.location }), "STATE", /aceptada/);
    const after = await fx.as("cfo", (db) => db.one<{ n: string }>("select count(*) n from public.units where organization_id = $1", [fx.org]));
    expect(after.n).toBe(before.n);
  });

  it("no se mezclan monedas: unidad PYG en operación USD es rechazada", async () => {
    const usd = await fx.availableUnit();
    const pyg = await fx.availableUnit({ currency: "PYG", list: 700000000, min: 650000000, cost: 500000000 });
    const deal = await fx.rpc<string>("sales_advisor", "create_deal", { p_org: fx.org, p_customer: await fx.customer(), p_unit: usd });
    await expectDomainError(fx.rpc("sales_advisor", "add_deal_unit", { p_deal: deal, p_unit: pyg }), "VALIDATION", /monedas/);
  });
});

describe("cuentas por cobrar", () => {
  let contract: string;
  let customer: string;
  beforeAll(async () => {
    customer = await fx.customer("Deudor");
    const unit = await fx.availableUnit();
    const deal = await fx.approvedDeal(unit, customer, { price: 98000, down: 38000 });
    contract = await fx.rpc<string>("cfo", "formalize_deal", { p_deal: deal });
  });
  const pay = (amount: string, opts: { key?: string; ref?: string; allocations?: unknown; currency?: string; account?: string } = {}) =>
    fx.rpc<string>("collections", "record_customer_payment", { p_org: fx.org, p_customer: customer, p_contract: contract, p_amount: amount,
      p_currency: opts.currency ?? "USD", p_effective_date: fx.today, p_method: "transfer", p_reference: opts.ref ?? `REF-${randomUUID().slice(0, 8)}`,
      p_cash_account: opts.account ?? fx.usdAccount, p_idempotency_key: opts.key ?? randomUUID(), p_notes: null, p_allocations: opts.allocations ?? null });
  const balance = () => fx.as("cfo", (db) => db.one<{ collected_confirmed: string; pending_reconciliation: string; outstanding: string }>(
    "select collected_confirmed, pending_reconciliation, outstanding from public.contract_balances where contract_id = $1", [contract]));

  it("pago parcial que cubre varias cuotas se asigna FIFO y solo cuenta al confirmarse", async () => {
    const p = await pay("50000.00");
    const allocs = await fx.as("cfo", (db) => db.rows<{ seq: number; amount: string }>(
      "select i.seq, a.amount from public.payment_allocations a join public.receivable_installments i on i.id = a.installment_id where a.payment_id = $1 order by i.seq", [p]));
    expect(allocs[0]).toEqual({ seq: 0, amount: "38000.00" });
    expect(allocs.length).toBeGreaterThan(1);
    expect((await balance()).collected_confirmed).toBe("0");
    expect((await balance()).pending_reconciliation).toBe("50000.00");
    await fx.rpc("cfo", "confirm_payment", { p_payment: p });
    expect((await balance()).collected_confirmed).toBe("50000.00");
    // segregación: quien registra un pago no puede confirmarlo
    const own = await fx.rpc<string>("cfo", "record_customer_payment", { p_org: fx.org, p_customer: customer, p_contract: contract,
      p_amount: "10.00", p_currency: "USD", p_effective_date: fx.today, p_method: "cash", p_reference: null, p_cash_account: fx.usdAccount,
      p_idempotency_key: randomUUID(), p_notes: null, p_allocations: [] });
    await expectDomainError(fx.rpc("cfo", "confirm_payment", { p_payment: own }), "FORBIDDEN", /segregación/);
    // un asesor no puede confirmar pagos
    await expectDomainError(fx.rpc("sales_advisor", "confirm_payment", { p_payment: own }), "FORBIDDEN");
    await fx.rpc("ceo", "reject_payment", { p_payment: own, p_reason: "Prueba de segregación" });
  });

  it("idempotencia: reenviar el mismo formulario no duplica el pago; la misma referencia sí se rechaza", async () => {
    const key = randomUUID();
    const a = await pay("100.00", { key, ref: "IDEM-1" });
    const b = await pay("100.00", { key, ref: "IDEM-1" });
    expect(a).toBe(b);
    await expectDomainError(pay("100.00", { ref: "idem-1" }), "CONFLICT");
    await fx.rpc("cfo", "reject_payment", { p_payment: a, p_reason: "Prueba de rechazo" });
  });

  it("un pago revertido deja de contar como cobrado y genera contrapartida de caja", async () => {
    const before = await balance();
    const p = await pay("1000.00");
    await fx.rpc("cfo", "confirm_payment", { p_payment: p });
    await fx.rpc("cfo", "reverse_payment", { p_payment: p, p_reason: "Cheque rechazado" });
    const after = await balance();
    expect(after.collected_confirmed).toBe(before.collected_confirmed);
    const mv = await fx.as("cfo", (db) => db.rows<{ amount: string }>(
      "select amount from public.cash_movements where source_id = $1 order by amount", [p]));
    expect(mv.map((m) => m.amount)).toEqual(["-1000.00", "1000.00"]);
    await expectDomainError(fx.as("cfo", (db) => db.rows("update public.cash_movements set amount = 5 where source_id = $1", [p])), "FORBIDDEN");
    const audit = await fx.as("auditor", (db) => db.rows("select op_id from public.audit_events where action = 'payment.reverse' and entity_id = $1", [p]));
    expect(audit).toHaveLength(1);
  });

  it("no se puede sobreasignar ni pagar en otra moneda", async () => {
    const inst = await fx.as("cfo", (db) => db.one<{ id: string; outstanding: string }>(
      "select id, outstanding from public.installment_status where contract_id = $1 and outstanding > 0 order by seq desc limit 1", [contract]));
    await expectDomainError(pay("999999.00", { allocations: [{ installment_id: inst.id, amount: "999999.00" }] }), "VALIDATION", /supera/);
    await expectDomainError(pay("1000", { currency: "PYG", account: fx.pygAccount }), "VALIDATION", /contrato/);
    await expectDomainError(pay("100.00", { account: fx.pygAccount }), "VALIDATION", /no opera/);
  });

  it("la mora se determina por la fecha exigible y el período de gracia", async () => {
    const first = await fx.as("cfo", (db) => db.one<{ due_date: string }>(
      "select due_date from public.installment_status where contract_id = $1 and kind = 'installment' and outstanding > 0 order by seq limit 1", [contract]));
    await admin.query("update public.org_policies set grace_days = 3 where organization_id = $1", [fx.org]);
    const status = (asOf: string) => fx.as("cfo", (db) => db.one<{ is_overdue: boolean; days_past_due: number }>(
      "select is_overdue, days_past_due from public.installment_status where contract_id = $1 and due_date = $2", [contract, first.due_date]), asOf);
    expect((await status(first.due_date)).is_overdue).toBe(false);
    expect((await status(addDays(first.due_date, 3))).is_overdue).toBe(false);
    const late = await status(addDays(first.due_date, 4));
    expect(late.is_overdue).toBe(true);
    expect(late.days_past_due).toBe(4);
  });

  it("el estado de cuenta reconcilia con el saldo pendiente", async () => {
    const rows = await fx.as("cfo", (db) => db.rows<{ balance: string }>(
      "select balance from public.contract_statement($1, $2::date - 30, $2::date) order by entry_order", [contract, fx.today]));
    expect(rows.at(-1)!.balance).toBe((await balance()).outstanding);
  });

  it("un ajuste no puede dejar la cuota por debajo de lo cobrado", async () => {
    const paid = await fx.as("cfo", (db) => db.one<{ id: string }>(
      "select id from public.installment_status where contract_id = $1 and seq = 0", [contract]));
    await expectDomainError(fx.rpc("cfo", "register_installment_adjustment", { p_installment: paid.id, p_kind: "credit_note", p_amount: -100, p_reason: "Nota de crédito" }),
      "VALIDATION", /por debajo/);
  });
});

describe("documentos", () => {
  it("la propuesta se emite desde datos validados, sin costes, con integridad verificable", async () => {
    const unit = await fx.availableUnit();
    const deal = await fx.approvedDeal(unit, await fx.customer(), {});
    const doc = await fx.rpc<string>("sales_advisor", "issue_document", { p_org: fx.org, p_kind: "proposal", p_entity_id: deal, p_options: {} });
    const d = await fx.rpc<{ integrity_ok: boolean; snapshot: Record<string, unknown> }>("sales_advisor", "get_document", { p_document: doc });
    expect(d.integrity_ok).toBe(true);
    const text = JSON.stringify(d.snapshot);
    expect(text).not.toContain("cost_actual");
    expect(text).not.toContain("margin");
    expect((d.snapshot.plan as { checksum: string }).checksum).toHaveLength(64);
    await expectDomainError(fx.rpc("advisor2", "get_document", { p_document: doc }), "FORBIDDEN");
    // Ni siquiera un superusuario elimina documentos emitidos con DELETE ordinario.
    await expect(admin.query("delete from public.documents where id = $1", [doc])).rejects.toThrow(/no se eliminan/);
  });
});
