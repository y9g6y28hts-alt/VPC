import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDealSchedule, toRpcPayload } from "@/domain/financing/deal-schedule";
import { addDays, addMonths } from "@/domain/dates";
import { agingBucket } from "@/domain/collections/aging";
import { admin, as, closeAll, createCustomer, createOrg, createVehicle, errorOf, n, type OrgFixture } from "./helpers";

let f: OrgFixture;
let today: string;

beforeAll(async () => {
  f = await createOrg("Flujo de ventas");
  const [r] = await admin<{ d: string }[]>`select app.org_today(${f.orgId})::text as d`;
  today = r!.d;
});
afterAll(closeAll);

async function createDeal(opts: {
  vehicleId: string;
  customerId: string;
  sellerId?: string;
  listPrice?: number;
  discount?: number;
  down?: number;
  tradeIn?: { appraisalId: string; value: number };
  paymentType?: "contado" | "financiado";
  currency?: "PYG" | "USD";
}): Promise<string> {
  const seller = opts.sellerId ?? f.users.vendedor;
  return as(seller, async (tx) => {
    const [d] = await tx<{ id: string }[]>`
      insert into public.deals (org_id, customer_id, vehicle_id, seller_id, currency, list_price, discount_amount,
                                trade_in_appraisal_id, trade_in_value, down_payment, payment_type, financing_terms, created_by)
      values (${f.orgId}, ${opts.customerId}, ${opts.vehicleId}, ${seller}, ${opts.currency ?? "PYG"},
              ${opts.listPrice ?? 300_000_000}, ${opts.discount ?? 0}, ${opts.tradeIn?.appraisalId ?? null},
              ${opts.tradeIn?.value ?? 0}, ${opts.down ?? 60_000_000}, ${opts.paymentType ?? "financiado"},
              ${(opts.paymentType ?? "financiado") === "financiado" ? tx.json({ method: "frances", ratePercent: 18, rateConvention: "nominal_annual", termMonths: 12, firstDueDate: today } as never) : null},
              ${seller})
      returning id`;
    return d!.id;
  });
}

function scheduleFor(signedOn: string, o: { list?: number; discount?: number; down?: number; tradeIn?: number; months?: number; rate?: number; currency?: "PYG" | "USD" } = {}) {
  const s = buildDealSchedule({
    currency: o.currency ?? "PYG",
    listPrice: o.list ?? 300_000_000,
    discount: o.discount ?? 0,
    tradeInValue: o.tradeIn ?? 0,
    downPayment: o.down ?? 60_000_000,
    operationDate: signedOn,
    financing:
      (o.list ?? 300_000_000) - (o.discount ?? 0) - (o.tradeIn ?? 0) - (o.down ?? 60_000_000) > 0
        ? { method: "frances", ratePercent: o.rate ?? 18, rateConvention: "nominal_annual", termMonths: o.months ?? 12, firstDueDate: addMonths(signedOn, 1) }
        : null,
  });
  return { s, payload: toRpcPayload(s) };
}

async function formalize(dealId: string, signedOn: string, payload: ReturnType<typeof toRpcPayload>, user = f.users.administracion) {
  return as(user, async (tx) => {
    const [r] = await tx<{ id: string }[]>`
      select public.rpc_deal_formalize(${dealId}, ${signedOn}, ${tx.json(payload.plan as never)}, ${tx.json(payload.schedule as never)}, ${f.users.cobranzas}) as id`;
    return r!.id;
  });
}

async function balances(contractId: string) {
  const [b] = await as(f.users.director, (tx) => tx`select * from public.v_contract_balances where contract_id = ${contractId}`);
  return b!;
}

async function consistent(contractId: string) {
  const [c] = await as(f.users.director, (tx) => tx`select * from public.rpc_contract_consistency(${contractId})`);
  expect(c!.consistent, `contrato ${contractId}: libro ${c!.ledger_balance}, cuotas ${c!.installments_outstanding}, a favor ${c!.unapplied_credit}`).toBe(true);
  return c!;
}

async function registerPayment(contractId: string, customerId: string, amount: number, extra: Record<string, unknown> = {}) {
  return as(f.users.cobranzas, async (tx) => {
    const [r] = await tx<{ id: string }[]>`select public.rpc_payment_register(${tx.json({
      customer_id: customerId, contract_id: contractId, received_on: today, method: "transferencia",
      cash_account_id: f.pygAccount, currency: "PYG", amount, reference: `REF-${Math.random()}`, ...extra,
    } as never)}) as id`;
    return r!.id;
  });
}

async function confirm(paymentId: string, user = f.users.administracion) {
  return as(user, (tx) => tx`select public.rpc_payment_confirm(${paymentId}) as unapplied`);
}

describe("reservas concurrentes", () => {
  it("dos reservas simultáneas de la misma unidad: sólo una prospera", async () => {
    const vid = await createVehicle(f);
    const c1 = await createCustomer(f, f.users.vendedor);
    const c2 = await createCustomer(f, f.users.vendedor);
    const expires = new Date(Date.now() + 3 * 86400_000).toISOString();
    const results = await Promise.allSettled(
      [c1, c2, c1, c2].map((c) => as(f.users.vendedor, (tx) => tx`select public.rpc_reservation_create(${vid}, ${c}, ${expires}) as id`)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const reasons = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason.message));
    expect(reasons.every((m) => /no está disponible/.test(m))).toBe(true);
    const [v] = await admin`select commercial_status, contract_status from public.vehicles where id = ${vid}`;
    expect(v).toMatchObject({ commercial_status: "reservado", contract_status: "reservado" });
  });

  it("una reserva vencida libera la unidad automáticamente", async () => {
    const vid = await createVehicle(f);
    const c1 = await createCustomer(f, f.users.vendedor);
    const c2 = await createCustomer(f, f.users.vendedor);
    await as(f.users.vendedor, (tx) => tx`select public.rpc_reservation_create(${vid}, ${c1}, ${new Date(Date.now() + 60_000).toISOString()})`);
    await admin`update public.reservations set expires_at = now() - interval '1 minute' where vehicle_id = ${vid}`;
    await as(f.users.vendedor, (tx) => tx`select public.rpc_reservation_create(${vid}, ${c2}, ${new Date(Date.now() + 86400_000).toISOString()})`);
    const rows = await admin`select status, customer_id from public.reservations where vehicle_id = ${vid} order by created_at`;
    expect(rows.map((r) => r.status)).toEqual(["vencida", "activa"]);
  });

  it("no se vende a otro cliente una unidad reservada", async () => {
    const vid = await createVehicle(f);
    const owner = await createCustomer(f, f.users.vendedor);
    const intruder = await createCustomer(f, f.users.vendedor);
    await as(f.users.vendedor, (tx) => tx`select public.rpc_reservation_create(${vid}, ${owner}, ${new Date(Date.now() + 86400_000).toISOString()})`);
    const deal = await createDeal({ vehicleId: vid, customerId: intruder });
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${deal})`))).toMatch(/reservada para otro cliente/);
  });
});

describe("venta financiada de punta a punta", () => {
  let vid: string, cid: string, dealId: string, contractId: string;
  const signedOn = () => addDays(today, -95);

  it("descuento sobre el límite queda pendiente y el vendedor no puede aprobarlo", async () => {
    vid = await createVehicle(f);
    cid = await createCustomer(f, f.users.vendedor);
    dealId = await createDeal({ vehicleId: vid, customerId: cid, discount: 12_000_000 });
    const [r] = await as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${dealId}) as s`);
    expect(r!.s).toBe("pendiente_aprobacion");
    const [ap] = await admin`select id, kind, status from public.approvals where entity_id = ${dealId}`;
    expect(ap).toMatchObject({ kind: "descuento", status: "pendiente" });
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'ok')`))).toMatch(/permiso/);
    // condiciones bloqueadas fuera de borrador
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`update public.deals set discount_amount = 1 where id = ${dealId}`))).toMatch(/borrador/);
    await as(f.users.gerencia_comercial, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'Cliente frecuente')`);
    const [d] = await admin`select status from public.deals where id = ${dealId}`;
    expect(d!.status).toBe("aprobada");
  });

  it("el historial registra la operación y los cambios de estado", async () => {
    const ev = await admin`select event from public.deal_events where deal_id = ${dealId} order by id`;
    expect(ev.map((e) => e.event)).toEqual(["creada", "estado", "estado"]);
  });

  it("una venta financiada sin condiciones no se puede enviar", async () => {
    const vid2 = await createVehicle(f);
    const c2 = await createCustomer(f, f.users.vendedor);
    const d = await as(f.users.vendedor, (tx) => tx`
      insert into public.deals (org_id, customer_id, vehicle_id, seller_id, currency, list_price, down_payment, payment_type, created_by)
      values (${f.orgId}, ${c2}, ${vid2}, ${f.users.vendedor}, 'PYG', 300000000, 60000000, 'financiado', ${f.users.vendedor}) returning id`);
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${d[0]!.id})`))).toMatch(/condiciones de financiación/);
  });

  it("rechaza un cronograma que no cuadra con la operación", async () => {
    const { payload } = scheduleFor(signedOn(), { discount: 0 });
    expect(await errorOf(formalize(dealId, signedOn(), payload))).toMatch(/capital de las cuotas/);
  });

  it("vendedor no puede formalizar", async () => {
    const { payload } = scheduleFor(signedOn(), { discount: 12_000_000 });
    expect(await errorOf(formalize(dealId, signedOn(), payload, f.users.vendedor))).toMatch(/deals.formalize/);
  });

  it("formaliza: contrato, cuotas, cuenta corriente y estados de la unidad", async () => {
    const { s, payload } = scheduleFor(signedOn(), { discount: 12_000_000 });
    contractId = await formalize(dealId, signedOn(), payload);
    const [c] = await admin`select * from public.contracts where id = ${contractId}`;
    expect(n(c!.sale_price)).toBe(288_000_000);
    expect(n(c!.financed_amount)).toBe(228_000_000);
    const inst = await admin`select * from public.installments where contract_id = ${contractId} order by seq`;
    expect(inst).toHaveLength(13);
    expect(inst.reduce((a, i) => a + n(i.interest), 0)).toBe(s.totalInterest);
    const [v] = await admin`select commercial_status, contract_status from public.vehicles where id = ${vid}`;
    expect(v).toMatchObject({ commercial_status: "vendido_pendiente_entrega", contract_status: "contrato_firmado" });
    const b = await balances(contractId);
    expect(n(b.outstanding)).toBe(288_000_000 + s.totalInterest);
    await consistent(contractId);
  });

  it("dos formalizaciones de la misma unidad: la segunda falla", async () => {
    const other = await createCustomer(f, f.users.vendedor);
    const d2 = await createDeal({ vehicleId: vid, customerId: other });
    // forzado a aprobada para aislar la carrera en la formalización
    await admin`update public.deals set status = 'aprobada' where id = ${d2}`;
    const { payload } = scheduleFor(signedOn());
    expect(await errorOf(formalize(d2, signedOn(), payload))).toMatch(/ya no está disponible/);
  });

  it("la mora se calcula sobre vencimientos reales", async () => {
    const b = await balances(contractId);
    // Firmado hace 95 días: entrega inicial (día 0) y cuotas 1-3 vencidas
    expect(n(b.overdue_installments)).toBe(4);
    expect(n(b.max_days_overdue)).toBe(95);
    expect(agingBucket(n(b.max_days_overdue)).label).toBe("Más de 90 días");
    const [bucket] = await admin`select app.aging_bucket(${f.orgId}, ${b.max_days_overdue}::int) as l`;
    expect(bucket!.l).toBe("Más de 90 días");
  });

  it("un pago registrado no cuenta como cobro hasta confirmarse", async () => {
    const before = await balances(contractId);
    const pid = await registerPayment(contractId, cid, 60_000_000);
    const after = await balances(contractId);
    expect(n(after.outstanding)).toBe(n(before.outstanding));
    expect(n(after.cash_collected)).toBe(0);
    await confirm(pid);
    const confirmed = await balances(contractId);
    expect(n(confirmed.cash_collected)).toBe(60_000_000);
    expect(n(confirmed.outstanding)).toBe(n(before.outstanding) - 60_000_000);
    // La entrega inicial (la más antigua) queda saldada y deja de estar vencida
    const [down] = await admin`select * from public.v_installment_balances where contract_id = ${contractId} and kind = 'entrega_inicial'`;
    expect(down).toMatchObject({ payment_state: "pagada", days_overdue: 0 });
    await consistent(contractId);
  });

  it("un pago cubre varias cuotas y una cuota recibe varios pagos", async () => {
    const cuotas = await admin`select id, amount from public.installments where contract_id = ${contractId} and kind = 'cuota' order by seq`;
    const c1 = n(cuotas[0]!.amount);
    // paga una cuota y media
    const p1 = await registerPayment(contractId, cid, c1 + Math.floor(c1 / 2));
    await confirm(p1);
    const a1 = await admin`select installment_id, amount from public.payment_allocations where payment_id = ${p1} order by created_at`;
    expect(a1).toHaveLength(2);
    expect(n(a1[0]!.amount)).toBe(c1);
    // completa la segunda cuota con otro pago
    const p2 = await registerPayment(contractId, cid, c1 - Math.floor(c1 / 2));
    await confirm(p2);
    const [second] = await admin`select * from public.v_installment_balances where id = ${cuotas[1]!.id}`;
    expect(second).toMatchObject({ payment_state: "pagada" });
    const payers = await admin`select distinct payment_id from public.payment_allocations where installment_id = ${cuotas[1]!.id}`;
    expect(payers).toHaveLength(2);
    await consistent(contractId);
  });

  it("detecta pagos duplicados y exige confirmación explícita", async () => {
    const payload = { reference: "DUP-001" };
    const p = await registerPayment(contractId, cid, 1_000_000, payload);
    expect(await errorOf(registerPayment(contractId, cid, 1_000_000, payload))).toMatch(/Posible pago duplicado/);
    const p2 = await registerPayment(contractId, cid, 1_000_000, { ...payload, allow_duplicate: true });
    await as(f.users.cobranzas, (tx) => tx`select public.rpc_payment_void(${p2}, 'Cargado dos veces')`);
    await confirm(p);
    await consistent(contractId);
  });

  it("revierte un pago confirmado con trazabilidad y restituye la deuda", async () => {
    const before = await balances(contractId);
    const pid = await registerPayment(contractId, cid, 5_000_000);
    await confirm(pid);
    expect(await errorOf(as(f.users.cobranzas, (tx) => tx`select public.rpc_payment_reverse(${pid}, 'Transferencia rechazada')`)))
      .toMatch(/payments.reverse/);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_payment_reverse(${pid}, 'Transferencia rechazada por el banco')`);
    const after = await balances(contractId);
    expect(n(after.outstanding)).toBe(n(before.outstanding));
    expect(n(after.cash_collected)).toBe(n(before.cash_collected));
    const net = await admin`select coalesce(sum(amount), 0) as s from public.payment_allocations where payment_id = ${pid}`;
    expect(n(net[0]!.s)).toBe(0);
    const mov = await admin`select direction, kind, amount from public.cash_movements where customer_payment_id = ${pid} order by created_at`;
    expect(mov.map((m) => [m.direction, m.kind, n(m.amount)])).toEqual([["ingreso", "cobro_cliente", 5_000_000], ["egreso", "reversion", 5_000_000]]);
    // ni se borra ni se modifica
    expect(await errorOf(admin`delete from public.payment_allocations where payment_id = ${pid}`)).toMatch(/no se pueden modificar/);
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_payment_reverse(${pid}, 'otra vez más')`))).toMatch(/Sólo se revierten/);
    await consistent(contractId);
  });

  it("los movimientos confirmados no se borran ni se editan silenciosamente", async () => {
    const [m] = await admin`select id from public.cash_movements where org_id = ${f.orgId} limit 1`;
    expect(await errorOf(admin`delete from public.cash_movements where id = ${m!.id}`)).toMatch(/no se borran/);
    expect(await errorOf(admin`update public.cash_movements set amount = 1 where id = ${m!.id}`)).toMatch(/no se modifican/);
    expect(await errorOf(admin`update public.contract_ledger_entries set credit = 0 where contract_id = ${contractId}`)).toMatch(/no se pueden modificar/);
  });

  it("nota de crédito y recargo requieren aprobación y mantienen la consistencia", async () => {
    const before = await balances(contractId);
    const [nc] = await as(f.users.administracion, (tx) => tx`
      select public.rpc_contract_request_adjustment(${contractId}, 'nota_credito', 2000000, 'Bonificación por demora en entrega', 'Acordado con dirección') as id`);
    expect(await errorOf(as(f.users.administracion, (tx) => tx`select public.rpc_approval_decide(${nc!.id}, true, null)`))).toMatch(/permiso/);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_approval_decide(${nc!.id}, true, 'Aprobado')`);
    const [rc] = await as(f.users.finanzas, (tx) => tx`
      select public.rpc_contract_request_adjustment(${contractId}, 'recargo', 350000, 'Recargo por mora', 'Atraso mayor a 90 días', ${addDays(today, 5)}) as id`);
    // separación de funciones: quien lo pidió no lo aprueba
    expect(await errorOf(as(f.users.finanzas, (tx) => tx`select public.rpc_approval_decide(${rc!.id}, true, 'ok')`))).toMatch(/separación de funciones/);
    await as(f.users.director, (tx) => tx`select public.rpc_approval_decide(${rc!.id}, true, 'Autorizado')`);
    const after = await balances(contractId);
    expect(n(after.outstanding)).toBe(n(before.outstanding) - 2_000_000 + 350_000);
    expect(n(after.cash_collected)).toBe(n(before.cash_collected));
    await consistent(contractId);
  });

  it("la entrega exige la entrega inicial cobrada; luego queda entregada", async () => {
    await as(f.users.administracion, (tx) => tx`select public.rpc_deal_deliver(${dealId}, ${today}, 'Entregado con 2 llaves')`);
    const [v] = await admin`select commercial_status from public.vehicles where id = ${vid}`;
    expect(v!.commercial_status).toBe("entregado");
    expect(await errorOf(as(f.users.director, (tx) => tx`select public.rpc_deal_cancel(${dealId}, 'Arrepentimiento')`))).toMatch(/entregada no se anula/);
  });

  it("refinancia el saldo con aprobación y nueva versión del contrato", async () => {
    const before = await balances(contractId);
    const outstanding = n(before.outstanding);
    const s = buildDealSchedule({
      currency: "PYG", listPrice: outstanding, discount: 0, tradeInValue: 0, downPayment: 0, operationDate: today,
      financing: { method: "aleman", ratePercent: 1.2, rateConvention: "monthly", termMonths: 18, firstDueDate: addMonths(today, 1) },
    });
    const p = toRpcPayload(s);
    const [rq] = await as(f.users.administracion, (tx) => tx`
      select public.rpc_contract_request_refinance(${contractId}, ${tx.json(p.plan as never)}, ${tx.json(p.schedule as never)}, 'Cliente solicita extender plazo') as id`);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_approval_decide(${rq!.id}, true, 'Aprobado por comité')`);
    const after = await balances(contractId);
    expect(n(after.overdue_amount)).toBe(0);
    expect(n(after.outstanding)).toBe(outstanding + s.totalInterest);
    const [c] = await admin`select current_version from public.contracts where id = ${contractId}`;
    expect(c!.current_version).toBe(2);
    const versions = await admin`select version_no from public.contract_versions where contract_id = ${contractId} order by 1`;
    expect(versions.map((v) => v.version_no)).toEqual([1, 2]);
    await consistent(contractId);
  });
});

describe("contado, seña y trade-in", () => {
  it("registrar una seña exige permiso de cobros; la reserva no queda a medias", async () => {
    const vid = await createVehicle(f, { list_price: 150_000_000, min_price: 140_000_000 });
    const cid = await createCustomer(f, f.users.vendedor);
    const err = await errorOf(as(f.users.gerencia_comercial, (tx) => tx`
      select public.rpc_reservation_create(${vid}, ${cid}, ${new Date(Date.now() + 86400_000).toISOString()}, 'Seña',
        ${tx.json({ amount: 5_000_000, currency: "PYG", method: "efectivo", cash_account_id: f.pygAccount, received_on: today } as never)})`));
    expect(err).toMatch(/payments.register/);
    const [v] = await admin`select commercial_status from public.vehicles where id = ${vid}`;
    expect(v!.commercial_status).toBe("disponible");
    expect(await admin`select id from public.reservations where vehicle_id = ${vid}`).toHaveLength(0);
  });

  it("seña registrada por administración y confirmada, luego contado", async () => {
    const vid = await createVehicle(f, { list_price: 150_000_000, min_price: 140_000_000 });
    const cid = await createCustomer(f, f.users.vendedor);
    // director tiene todos los permisos
    const [r] = await as(f.users.director, (tx) => tx`
      select public.rpc_reservation_create(${vid}, ${cid}, ${new Date(Date.now() + 86400_000).toISOString()}, 'Seña',
        ${tx.json({ amount: 5_000_000, currency: "PYG", method: "efectivo", cash_account_id: f.pygAccount, received_on: today } as never)}) as id`);
    const [pay] = await admin`select id from public.customer_payments where reservation_id = ${r!.id}`;
    await confirm(pay!.id);
    const deal = await createDeal({ vehicleId: vid, customerId: cid, listPrice: 150_000_000, down: 150_000_000, paymentType: "contado" });
    expect((await as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${deal}) as s`))[0]!.s).toBe("aprobada");
    const { payload } = scheduleFor(today, { list: 150_000_000, down: 150_000_000 });
    const contractId = await formalize(deal, today, payload);
    const b = await balances(contractId);
    expect(n(b.outstanding)).toBe(145_000_000);
    const [res] = await admin`select status from public.reservations where id = ${r!.id}`;
    expect(res!.status).toBe("convertida");
    await consistent(contractId);
  });

  it("trade-in: tasación aprobada, aceptada, aplicada como pago en especie e ingresada al inventario", async () => {
    const vid = await createVehicle(f, { list_price: 200_000_000, min_price: 190_000_000 });
    const cid = await createCustomer(f, f.users.vendedor);
    const appraisalId = await as(f.users.vendedor, async (tx) => {
      const [a] = await tx<{ id: string }[]>`
        insert into public.trade_in_appraisals (org_id, customer_id, brand_name, model, year_model, mileage_km, currency,
          market_value_estimate, market_value_source, market_value_date, offered_value, expected_resale_price,
          estimated_repair_costs, appraiser_id, created_by)
        values (${f.orgId}, ${cid}, 'Changan', 'CS55', 2022, 48000, 'PYG', 95000000, 'Relevamiento de 3 avisos clasificados', ${today},
                80000000, 98000000, 3500000, ${f.users.vendedor}, ${f.users.vendedor}) returning id`;
      await tx`insert into public.appraisal_inspections (org_id, appraisal_id, area, rating, notes, repair_estimate, inspected_by)
               values (${f.orgId}, ${a!.id}, 'neumaticos', 'regular', 'Cambiar 2 cubiertas', 3500000, ${f.users.vendedor})`;
      await tx`select public.rpc_tradein_submit(${a!.id})`;
      return a!.id;
    });
    const [ap] = await admin`select id from public.approvals where entity_id = ${appraisalId} and status = 'pendiente'`;
    await as(f.users.gerencia_comercial, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'Valor razonable')`);
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select public.rpc_tradein_customer_decision(${appraisalId}, true, 85000000)`)))
      .toMatch(/no superar el valor ofrecido/);
    await as(f.users.vendedor, (tx) => tx`select public.rpc_tradein_customer_decision(${appraisalId}, true, 78000000)`);

    const deal = await createDeal({ vehicleId: vid, customerId: cid, listPrice: 200_000_000, down: 122_000_000, paymentType: "contado", tradeIn: { appraisalId, value: 78_000_000 } });
    await as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${deal})`);
    const { payload } = scheduleFor(today, { list: 200_000_000, down: 122_000_000, tradeIn: 78_000_000 });
    const contractId = await formalize(deal, today, payload);
    const b = await balances(contractId);
    expect(n(b.outstanding)).toBe(122_000_000);
    expect(n(b.cash_collected)).toBe(0); // el usado no es cobro en efectivo
    await consistent(contractId);

    const usedId = await as(f.users.inventario, async (tx) => {
      const [x] = await tx`select public.rpc_tradein_acquire(${appraisalId}, ${tx.json({ brand_id: f.brandId, list_price: 98_000_000, min_price: 92_000_000 } as never)}, ${today}) as id`;
      return x!.id as string;
    });
    const [eco] = await as(f.users.director, (tx) => tx`select * from public.v_vehicle_economics where vehicle_id = ${usedId}`);
    expect(n(eco!.acquisition_cost_base)).toBe(78_000_000);
    expect(n(eco!.estimated_cost_base)).toBe(3_500_000);
    expect(n(eco!.estimated_margin_base)).toBe(98_000_000 - 78_000_000 - 3_500_000);
    const [used] = await admin`select origin, condition from public.vehicles where id = ${usedId}`;
    expect(used).toMatchObject({ origin: "trade_in", condition: "usado" });
  });
});

describe("monedas", () => {
  it("contrato en USD con pago en guaraníes: separa monedas y convierte con tipo registrado", async () => {
    const vid = await createVehicle(f, { list_price: 45_000, min_price: 42_000, price_currency: "USD" });
    const cid = await createCustomer(f, f.users.vendedor);
    const deal = await createDeal({ vehicleId: vid, customerId: cid, currency: "USD", listPrice: 45_000, down: 15_000 });
    // sin tipo de cambio no se puede comparar con el mínimo ni convertir → requiere aprobación
    await admin`insert into public.exchange_rates (org_id, rate_date, from_currency, to_currency, rate) values (${f.orgId}, ${addDays(today, -1)}, 'USD', 'PYG', 7350)`;
    expect((await as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${deal}) as s`))[0]!.s).toBe("aprobada");
    const { payload } = scheduleFor(today, { currency: "USD", list: 45_000, down: 15_000, months: 24, rate: 9.5 });
    const contractId = await formalize(deal, today, payload);
    const [d] = await admin`select fx_rate_to_base from public.deals where id = ${deal}`;
    expect(n(d!.fx_rate_to_base)).toBe(7350);

    // Pago de 110.250.000 Gs = 15.000 USD
    const pid = await registerPayment(contractId, cid, 110_250_000);
    const [p] = await admin`select currency, amount, contract_currency, amount_contract, fx_rate_to_contract from public.customer_payments where id = ${pid}`;
    expect(p!.currency).toBe("PYG");
    expect(p!.contract_currency).toBe("USD");
    expect(n(p!.amount_contract)).toBeCloseTo(15_000, 2);
    await confirm(pid);
    const [mov] = await admin`select currency, amount, account_id from public.cash_movements where customer_payment_id = ${pid}`;
    expect(mov).toMatchObject({ currency: "PYG", account_id: f.pygAccount });
    expect(n(mov!.amount)).toBe(110_250_000);
    await consistent(contractId);
  });

  it("rechaza guaraníes con decimales y cuentas de otra moneda", async () => {
    const vid = await createVehicle(f);
    expect(await errorOf(admin`update public.vehicles set list_price = 1000.5 where id = ${vid}`)).toMatch(/check constraint/);
    const [c] = await admin`select id, customer_id from public.contracts where org_id = ${f.orgId} and currency = 'PYG' limit 1`;
    expect(await errorOf(registerPayment(c!.id, c!.customer_id, 100.5))).toMatch(/decimales/);
    expect(await errorOf(registerPayment(c!.id, c!.customer_id, 100, { cash_account_id: f.usdAccount }))).toMatch(/misma moneda/);
  });
});

describe("anulación de venta formalizada", () => {
  it("sólo sin cobros aplicados; libera la unidad y da de baja el saldo", async () => {
    const vid = await createVehicle(f);
    const cid = await createCustomer(f, f.users.vendedor);
    const deal = await createDeal({ vehicleId: vid, customerId: cid });
    await as(f.users.vendedor, (tx) => tx`select public.rpc_deal_submit(${deal})`);
    const { payload } = scheduleFor(today);
    const contractId = await formalize(deal, today, payload);
    const pid = await registerPayment(contractId, cid, 1_000_000);
    await confirm(pid);
    expect(await errorOf(as(f.users.gerencia_comercial, (tx) => tx`select public.rpc_deal_cancel(${deal}, 'Desiste de la compra')`)))
      .toMatch(/cobros aplicados/);
    await as(f.users.finanzas, (tx) => tx`select public.rpc_payment_reverse(${pid}, 'Devolución al cliente')`);
    await as(f.users.gerencia_comercial, (tx) => tx`select public.rpc_deal_cancel(${deal}, 'Desiste de la compra')`);
    const [v] = await admin`select commercial_status, contract_status from public.vehicles where id = ${vid}`;
    expect(v).toMatchObject({ commercial_status: "disponible", contract_status: "sin_contrato" });
    const b = await balances(contractId);
    expect(n(b.outstanding)).toBe(0);
    await consistent(contractId);
  });
});
