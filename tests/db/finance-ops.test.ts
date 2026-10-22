import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates";
import { admin, as, closeAll, createCustomer, createOrg, createVehicle, errorOf, n, type OrgFixture } from "./helpers";

let f: OrgFixture;
let today: string;
let supplierId: string;

beforeAll(async () => {
  f = await createOrg("Finanzas");
  const [r] = await admin<{ d: string }[]>`select app.org_today(${f.orgId})::text as d`;
  today = r!.d;
  const [s] = await as(f.users.finanzas, (tx) => tx<{ id: string }[]>`
    insert into public.suppliers (org_id, name, tax_id, kind, created_by) values (${f.orgId}, 'Taller Central', '80012345-6', 'reparacion', ${f.users.finanzas}) returning id`);
  supplierId = s!.id;
});
afterAll(closeAll);

async function balance(accountId: string) {
  const [b] = await as(f.users.director, (tx) => tx`select * from public.v_cash_account_balances where account_id = ${accountId}`);
  return b!;
}

describe("cuentas por pagar", () => {
  it("factura → aprobación por otra persona → coste de la unidad → pago parcial → saldo", async () => {
    const vid = await createVehicle(f);
    const invId = await as(f.users.inventario, async (tx) => {
      const [r] = await tx`select public.rpc_supplier_invoice_create(${tx.json({
        supplier_id: supplierId, invoice_number: "001-001-0001234", timbrado: "12345678", issue_date: today,
        due_date: addDays(today, 30), currency: "PYG", amount: 4_400_000, tax_amount: 400_000, concept: "Chapería y pintura",
        category: "reparacion", vehicle_id: vid, create_vehicle_cost: true, cost_kind: "reparacion",
      } as never)}) as id`;
      return r!.id as string;
    });
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_supplier_payment_register(${tx.json({ invoice_id: invId, paid_on: today, amount: 1, cash_account_id: f.pygAccount } as never)})`)))
      .toMatch(/aprobadas/);
    const [ap] = await admin`select id from public.approvals where entity_id = ${invId}`;
    await as(f.users.finanzas, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'Conforme')`);
    const costs = await admin`select amount, kind, is_estimate from public.vehicle_costs where supplier_invoice_id = ${invId}`;
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ kind: "reparacion", is_estimate: false });

    const payId = await as(f.users.finanzas, async (tx) => {
      const [r] = await tx`select public.rpc_supplier_payment_register(${tx.json({ invoice_id: invId, paid_on: today, amount: 2_000_000, cash_account_id: f.pygAccount, reference: "TRF-9" } as never)}) as id`;
      return r!.id as string;
    });
    let [inv] = await as(f.users.finanzas, (tx) => tx`select * from public.v_supplier_invoice_balances where id = ${invId}`);
    expect(n(inv!.paid_registered_pending)).toBe(2_000_000);
    expect(n(inv!.outstanding)).toBe(4_400_000);
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_supplier_payment_register(${tx.json({ invoice_id: invId, paid_on: today, amount: 2_500_000, cash_account_id: f.pygAccount } as never)})`)))
      .toMatch(/supera el saldo/);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_supplier_payment_confirm(${payId})`);
    [inv] = await as(f.users.finanzas, (tx) => tx`select * from public.v_supplier_invoice_balances where id = ${invId}`);
    expect(n(inv!.paid_confirmed)).toBe(2_000_000);
    expect(n(inv!.outstanding)).toBe(2_400_000);
    expect(n(inv!.paid_reconciled)).toBe(0);
  });

  it("factura duplicada del mismo proveedor es rechazada", async () => {
    const payload = { supplier_id: supplierId, invoice_number: "001-001-0009999", issue_date: today, due_date: today, currency: "PYG", amount: 100_000, concept: "X", category: "general" };
    await as(f.users.inventario, (tx) => tx`select public.rpc_supplier_invoice_create(${tx.json(payload as never)})`);
    expect(await errorOf(as(f.users.inventario, (tx) => tx`select public.rpc_supplier_invoice_create(${tx.json(payload as never)})`))).toMatch(/duplicate key/);
  });
});

describe("gastos", () => {
  it("se aprueban antes de pagarse y el pago genera un egreso", async () => {
    const before = await balance(f.pygAccount);
    const [e] = await as(f.users.administracion, (tx) => tx`
      select public.rpc_expense_create(${f.orgId}, ${tx.json({ expense_date: today, category: "servicios", description: "ANDE octubre", amount: 1_850_000, currency: "PYG" } as never)}) as id`);
    expect(await errorOf(as(f.users.administracion, (tx) => tx`select public.rpc_expense_pay(${e!.id}, ${f.pygAccount}, ${today})`))).toMatch(/aprobados/);
    const [ap] = await admin`select id from public.approvals where entity_id = ${e!.id}`;
    await as(f.users.finanzas, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'ok')`);
    await as(f.users.administracion, (tx) => tx`select public.rpc_expense_pay(${e!.id}, ${f.pygAccount}, ${today})`);
    const after = await balance(f.pygAccount);
    expect(n(after.registered_balance)).toBe(n(before.registered_balance) - 1_850_000);
  });
});

describe("caja y conciliación", () => {
  it("transferencias, reversión auditable y conciliación con diferencia", async () => {
    const [bank] = await admin<{ id: string }[]>`insert into public.cash_accounts (org_id, name, kind, currency) values (${f.orgId}, 'Banco PYG', 'banco', 'PYG') returning id`;
    await as(f.users.finanzas, (tx) => tx`select public.rpc_cash_movement_create(${tx.json({ account_id: f.pygAccount, occurred_on: today, direction: "ingreso", kind: "apertura", amount: 50_000_000, description: "Saldo inicial de caja" } as never)})`);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_cash_transfer(${f.pygAccount}, ${bank!.id}, 20000000, ${today}, 'Depósito bancario')`);
    expect(n((await balance(bank!.id)).registered_balance)).toBe(20_000_000);

    const [wrong] = await as(f.users.finanzas, (tx) => tx`select public.rpc_cash_movement_create(${tx.json({ account_id: bank!.id, occurred_on: today, direction: "egreso", kind: "otro", amount: 300_000, description: "Comisión bancaria (error de carga)" } as never)}) as id`);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_cash_movement_reverse(${wrong!.id}, 'Importe mal cargado')`);
    expect(n((await balance(bank!.id)).registered_balance)).toBe(20_000_000);
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_cash_movement_reverse(${wrong!.id}, 'otra vez')`))).toMatch(/ya fue revertido/);

    const movs = await admin<{ id: string }[]>`select id from public.cash_movements where account_id = ${bank!.id}`;
    const [rec] = await as(f.users.finanzas, (tx) => tx`
      select public.rpc_reconciliation_create(${bank!.id}, ${today}, 19950000, ${movs.map((m) => m.id)}, 'Extracto octubre') as id`);
    const [r] = await admin`select status, difference from public.reconciliations where id = ${rec!.id}`;
    expect(r!.status).toBe("abierta");
    expect(n(r!.difference)).toBe(-50_000);
    const b = await balance(bank!.id);
    expect(n(b.unreconciled_count)).toBe(0);
    expect(n(b.reconciled_balance)).toBe(20_000_000);
    // un movimiento conciliado no se concilia dos veces
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_reconciliation_create(${bank!.id}, ${today}, 0, ${[movs[0]!.id]})`)))
      .toMatch(/no válidos/);
  });

  it("los cobros y pagos no se registran como movimientos manuales", async () => {
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_cash_movement_create(${tx.json({ account_id: f.pygAccount, occurred_on: today, direction: "ingreso", kind: "cobro_cliente", amount: 1, description: "x x x" } as never)})`)))
      .toMatch(/desde su módulo/);
  });
});

describe("promesas de pago", () => {
  it("una promesa no es un cobro; se marca cumplida sólo con pagos confirmados", async () => {
    const cid = await createCustomer(f);
    await as(f.users.cobranzas, (tx) => tx`
      insert into public.collection_actions (org_id, customer_id, channel, result, promise_amount, promise_currency, promise_date, notes, user_id)
      values (${f.orgId}, ${cid}, 'whatsapp', 'promesa_pago', 3000000, 'PYG', ${addDays(today, 3)}, 'Paga el viernes', ${f.users.cobranzas})`);
    const [p] = await as(f.users.cobranzas, (tx) => tx`select promise_status, paid_since_promise from public.v_payment_promises where customer_id = ${cid}`);
    expect(p).toMatchObject({ promise_status: "pendiente" });
    expect(n(p!.paid_since_promise)).toBe(0);
    expect(await errorOf(as(f.users.cobranzas, (tx) => tx`
      insert into public.collection_actions (org_id, customer_id, channel, result, user_id)
      values (${f.orgId}, ${cid}, 'llamada', 'promesa_pago', ${f.users.cobranzas})`))).toMatch(/check constraint/);
  });

  it("vendedor no registra gestiones de cobranza", async () => {
    const cid = await createCustomer(f, f.users.vendedor);
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`
      insert into public.collection_actions (org_id, customer_id, channel, result, user_id)
      values (${f.orgId}, ${cid}, 'llamada', 'contactado', ${f.users.vendedor})`))).toMatch(/row-level security/);
  });
});

describe("auditoría", () => {
  it("registra las acciones sensibles con su autor", async () => {
    const rows = await as(f.users.auditor, (tx) => tx`select action, actor_id from public.audit_events where org_id = ${f.orgId} and action in ('aprobacion_aprobada','conciliacion','movimiento_revertido')`);
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["aprobacion_aprobada", "conciliacion", "movimiento_revertido"]));
    expect(rows.every((r) => r.actor_id)).toBe(true);
    const none = await as(f.users.vendedor, (tx) => tx`select count(*)::int as c from public.audit_events`);
    expect(none[0]!.c).toBe(0);
  });
});
