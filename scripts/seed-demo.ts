/**
 * =============================================================================
 * SÓLO DESARROLLO / DEMOSTRACIÓN.
 *
 * Crea una organización de DEMOSTRACIÓN aislada (is_demo = true) con usuarios
 * por rol y operaciones de ejemplo. Todo se registra mediante las mismas
 * funciones transaccionales que usa la aplicación, de modo que saldos, mora y
 * márgenes son consistentes. Valores deterministas (sin números aleatorios).
 * Los nombres de personas, empresas y documentos son ficticios.
 *
 *   npm run db:seed-demo                (requiere PostgreSQL local)
 *   GOTRUE_BIN=.dev/gotrue npm run db:seed-demo   (además crea usuarios con
 *                                        contraseña en Supabase Auth local)
 * =============================================================================
 */
import { randomUUID } from "node:crypto";
// @ts-expect-error módulo ESM sin tipos
import { resetDatabase } from "./db-reset.mjs";
// @ts-expect-error módulo ESM sin tipos
import { DEV_GATEWAY_PORT, DEV_SERVICE_KEY } from "./dev-env.mjs";
import { createSql, withUser, type Tx } from "../src/server/db/client";
import { buildDealSchedule, toRpcPayload, type FinancingTerms } from "../src/domain/financing/deal-schedule";
import { addDays, addMonths } from "../src/domain/dates";
import type { Role } from "../src/domain/permissions";

const DB = process.env.DB_NAME ?? "dasilva_dev";
const DEMO_PASSWORD = "DemoDaSilva2026!";
const GOTRUE = process.env.GOTRUE_BIN;

if (process.env.NODE_ENV === "production") throw new Error("El seed de demostración no se ejecuta en producción");

const USERS: Array<{ role: Role; name: string; email: string }> = [
  { role: "director", name: "Dirección Demo", email: "director@demo.dasilva.local" },
  { role: "administracion", name: "Laura Giménez", email: "administracion@demo.dasilva.local" },
  { role: "gerencia_comercial", name: "Marcos Ayala", email: "gerencia@demo.dasilva.local" },
  { role: "vendedor", name: "Sofía Villalba", email: "vendedor@demo.dasilva.local" },
  { role: "vendedor", name: "Diego Ortiz", email: "vendedor2@demo.dasilva.local" },
  { role: "cobranzas", name: "Patricia Rojas", email: "cobranzas@demo.dasilva.local" },
  { role: "inventario", name: "Hugo Benítez", email: "inventario@demo.dasilva.local" },
  { role: "finanzas", name: "Andrea Cáceres", email: "finanzas@demo.dasilva.local" },
  { role: "auditor", name: "Auditoría Demo", email: "auditor@demo.dasilva.local" },
  { role: "admin_tecnico", name: "Soporte Técnico", email: "tecnico@demo.dasilva.local" },
];

async function main() {
  const adminUrl = await resetDatabase({ name: DB, demo: false, gotrue: GOTRUE, quiet: false });
  const admin = createSql(adminUrl, { max: 2 });
  const app = createSql(`postgres://dasilva_app:dasilva_app_dev_only@127.0.0.1:5432/${DB}`, { max: 4 });

  // ---------------------------------------------------------------- usuarios
  const uid: Record<string, string> = {};
  const gatewayUp = GOTRUE
    ? await fetch(`http://localhost:${DEV_GATEWAY_PORT}/auth/v1/health`).then((r) => r.ok).catch(() => false)
    : false;
  for (const u of USERS) {
    let id: string;
    if (gatewayUp) {
      const res = await fetch(`http://localhost:${DEV_GATEWAY_PORT}/auth/v1/admin/users`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${DEV_SERVICE_KEY}`, apikey: DEV_SERVICE_KEY },
        body: JSON.stringify({ email: u.email, password: DEMO_PASSWORD, email_confirm: true }),
      });
      if (!res.ok) throw new Error(`No se pudo crear ${u.email}: ${res.status} ${await res.text()}`);
      id = ((await res.json()) as { id: string }).id;
    } else {
      id = randomUUID();
      await admin`insert into auth.users (id, email) values (${id}, ${u.email})`;
    }
    await admin`insert into public.user_profiles (id, full_name) values (${id}, ${u.name})`;
    uid[u.email] = id;
  }
  const by = (email: string) => uid[email]!;
  const U = {
    director: by("director@demo.dasilva.local"),
    admin: by("administracion@demo.dasilva.local"),
    gerente: by("gerencia@demo.dasilva.local"),
    sofia: by("vendedor@demo.dasilva.local"),
    diego: by("vendedor2@demo.dasilva.local"),
    cobranzas: by("cobranzas@demo.dasilva.local"),
    inventario: by("inventario@demo.dasilva.local"),
    finanzas: by("finanzas@demo.dasilva.local"),
  };
  const as = <T,>(userId: string, fn: (tx: Tx) => Promise<T>) => withUser({ userId }, fn, app);

  // ------------------------------------------------------------ organización
  const [org] = await admin<{ id: string }[]>`
    insert into public.organizations (name, legal_name, tax_id, is_demo)
    values ('Da Silva Automotores — DEMO', 'Organización de demostración', null, true) returning id`;
  const orgId = org!.id;
  for (const u of USERS) {
    await admin`insert into public.memberships (org_id, user_id, role) values (${orgId}, ${by(u.email)}, ${u.role})`;
  }
  const [todayRow] = await admin<{ d: string }[]>`select app.org_today(${orgId})::text as d`;
  const today = todayRow!.d;
  const T = (days: number) => addDays(today, days);

  const [branch] = await admin<{ id: string }[]>`insert into public.branches (org_id, name, city) values (${orgId}, 'Casa central (demo)', 'Asunción') returning id`;
  const brands: Record<string, string> = {};
  for (const [i, name] of ["Range Rover", "Ford", "Changan"].entries()) {
    const [b] = await admin<{ id: string }[]>`insert into public.brands (org_id, name, sort_order) values (${orgId}, ${name}, ${i}) returning id`;
    brands[name] = b!.id;
  }
  const cats: Record<string, string> = {};
  for (const name of ["SUV", "Pick-up", "Sedán", "Hatchback"]) {
    const [c] = await admin<{ id: string }[]>`insert into public.vehicle_categories (org_id, name) values (${orgId}, ${name}) returning id`;
    cats[name] = c!.id;
  }
  for (const [name, req] of [["Título / cédula del automotor", true], ["Factura de compra", true], ["Despacho de importación", false], ["Ficha técnica", false]] as const) {
    await admin`insert into public.document_types (org_id, entity_type, name, is_required) values (${orgId}, 'vehicle', ${name}, ${req})`;
  }
  const [cajaPyg] = await admin<{ id: string }[]>`insert into public.cash_accounts (org_id, name, kind, currency) values (${orgId}, 'Caja principal Gs.', 'caja', 'PYG') returning id`;
  const [bancoPyg] = await admin<{ id: string }[]>`insert into public.cash_accounts (org_id, name, kind, currency, bank_name) values (${orgId}, 'Banco cuenta Gs. (demo)', 'banco', 'PYG', 'Banco (demo)') returning id`;
  const [bancoUsd] = await admin<{ id: string }[]>`insert into public.cash_accounts (org_id, name, kind, currency, bank_name) values (${orgId}, 'Banco cuenta US$ (demo)', 'banco', 'USD', 'Banco (demo)') returning id`;
  await admin`insert into public.exchange_rates (org_id, rate_date, from_currency, to_currency, rate, source, created_by) values
    (${orgId}, ${T(-200)}, 'USD', 'PYG', 7300, 'manual (demostración)', ${U.finanzas}),
    (${orgId}, ${T(-60)}, 'USD', 'PYG', 7320, 'manual (demostración)', ${U.finanzas}),
    (${orgId}, ${T(-2)}, 'USD', 'PYG', 7350, 'manual (demostración)', ${U.finanzas})`;

  // Saldos iniciales
  for (const [acc, amount] of [[cajaPyg!.id, 85_000_000], [bancoPyg!.id, 1_250_000_000], [bancoUsd!.id, 180_000]] as const) {
    await as(U.finanzas, (tx) => tx`select public.rpc_cash_movement_create(${tx.json({ account_id: acc, occurred_on: T(-210), direction: "ingreso", kind: "apertura", amount, description: "Saldo inicial (demostración)" } as never)})`);
  }

  // -------------------------------------------------------------- proveedores
  const sup: Record<string, string> = {};
  for (const [key, name, kind, ruc] of [
    ["imp", "Importadora Demo S.A.", "vehiculos", "80000001-1"],
    ["tra", "Transportes Demo", "transporte", "80000002-2"],
    ["tal", "Taller Mecánico Demo", "reparacion", "80000003-3"],
    ["ges", "Gestoría Demo", "documentacion", "80000004-4"],
    ["inm", "Inmobiliaria Demo", "general", "80000005-5"],
  ] as const) {
    const [s] = await as(U.finanzas, (tx) => tx<{ id: string }[]>`insert into public.suppliers (org_id, name, kind, tax_id, created_by) values (${orgId}, ${name}, ${kind}, ${ruc}, ${U.finanzas}) returning id`);
    sup[key] = s!.id;
  }

  // ---------------------------------------------------------------- vehículos
  type V = { key: string; brand: string; cat: string; model: string; version: string; ym: number; km: number; fuel: string; tr: string; color: string; cond: "nuevo" | "usado"; origin: string; cur: "PYG" | "USD"; list: number; min: number; acq: number; cost: number; extra?: Array<[string, string, number, boolean]>; phys?: string; prep?: string; docs?: string };
  const VEHICLES: V[] = [
    { key: "evoque", brand: "Range Rover", cat: "SUV", model: "Range Rover Evoque", version: "Dynamic SE P250", ym: 2025, km: 0, fuel: "nafta", tr: "automatica", color: "Gris Eiger", cond: "nuevo", origin: "importacion", cur: "USD", list: 78_000, min: 74_000, acq: -70 - 60, cost: 59_500, extra: [["transporte", "Flete marítimo y terrestre", 2_100, false], ["importacion", "Despacho y tributos", 6_900, false]] },
    { key: "velar", brand: "Range Rover", cat: "SUV", model: "Range Rover Velar", version: "Dynamic HSE P400", ym: 2025, km: 0, fuel: "hibrido", tr: "automatica", color: "Blanco Fuji", cond: "nuevo", origin: "importacion", cur: "USD", list: 98_500, min: 94_000, acq: -40, cost: 76_000, extra: [["transporte", "Flete", 2_300, false], ["importacion", "Despacho y tributos", 8_400, false]] },
    { key: "sport", brand: "Range Rover", cat: "SUV", model: "Range Rover Sport", version: "Autobiography", ym: 2024, km: 18_400, fuel: "hibrido", tr: "automatica", color: "Negro Santorini", cond: "usado", origin: "compra_local", cur: "USD", list: 139_000, min: 132_000, acq: -165, cost: 118_000, extra: [["preparacion", "Detailing y revisión", 1_200, false]] },
    { key: "evoque22", brand: "Range Rover", cat: "SUV", model: "Range Rover Evoque", version: "S D180", ym: 2022, km: 41_000, fuel: "diesel", tr: "automatica", color: "Azul Portofino", cond: "usado", origin: "compra_local", cur: "USD", list: 46_000, min: 43_500, acq: -25, cost: 38_000, extra: [["reparacion", "Pastillas y discos (presupuesto)", 900, true]], prep: "en_proceso" },
    { key: "ranger", brand: "Ford", cat: "Pick-up", model: "Ranger", version: "XLT 3.0 V6 4x4 AT", ym: 2026, km: 0, fuel: "diesel", tr: "automatica", color: "Blanco Ártico", cond: "nuevo", origin: "compra_local", cur: "PYG", list: 365_000_000, min: 348_000_000, acq: -170, cost: 298_000_000, extra: [["documentacion", "Inscripción y chapa", 3_200_000, false]] },
    { key: "raptor", brand: "Ford", cat: "Pick-up", model: "Ranger Raptor", version: "3.0 V6 Twin Turbo", ym: 2025, km: 0, fuel: "nafta", tr: "automatica", color: "Naranja Code", cond: "nuevo", origin: "compra_local", cur: "PYG", list: 525_000_000, min: 505_000_000, acq: -210, cost: 452_000_000 },
    { key: "territory", brand: "Ford", cat: "SUV", model: "Territory", version: "Titanium 1.8T", ym: 2026, km: 0, fuel: "nafta", tr: "automatica", color: "Gris Carbonizado", cond: "nuevo", origin: "compra_local", cur: "PYG", list: 245_000_000, min: 236_000_000, acq: -50, cost: 205_000_000 },
    { key: "bronco", brand: "Ford", cat: "SUV", model: "Bronco Sport", version: "Badlands 2.0T", ym: 2025, km: 0, fuel: "nafta", tr: "automatica", color: "Verde Eruption", cond: "nuevo", origin: "compra_local", cur: "PYG", list: 330_000_000, min: 316_000_000, acq: -95, cost: 279_000_000 },
    { key: "everest", brand: "Ford", cat: "SUV", model: "Everest", version: "Titanium 3.0 V6", ym: 2026, km: 0, fuel: "diesel", tr: "automatica", color: "Azul Atlas", cond: "nuevo", origin: "importacion", cur: "PYG", list: 420_000_000, min: 404_000_000, acq: -5, cost: 362_000_000, phys: "en_transito", docs: "en_tramite" },
    { key: "ranger23", brand: "Ford", cat: "Pick-up", model: "Ranger", version: "XLS 2.2 4x2 MT", ym: 2023, km: 52_300, fuel: "diesel", tr: "manual", color: "Plata", cond: "usado", origin: "compra_local", cur: "PYG", list: 198_000_000, min: 188_000_000, acq: -130, cost: 165_000_000, extra: [["reparacion", "Embrague", 4_800_000, false]] },
    { key: "cs35", brand: "Changan", cat: "SUV", model: "CS35 Plus", version: "Luxury 1.4T", ym: 2026, km: 0, fuel: "nafta", tr: "automatica", color: "Blanco", cond: "nuevo", origin: "importacion", cur: "PYG", list: 139_000_000, min: 133_000_000, acq: -35, cost: 112_000_000 },
    { key: "cs55", brand: "Changan", cat: "SUV", model: "CS55 Plus", version: "Luxury 1.5T", ym: 2026, km: 0, fuel: "nafta", tr: "automatica", color: "Gris", cond: "nuevo", origin: "importacion", cur: "PYG", list: 175_000_000, min: 168_000_000, acq: -120, cost: 141_000_000 },
    { key: "unik", brand: "Changan", cat: "SUV", model: "UNI-K", version: "2.0T AWD", ym: 2025, km: 0, fuel: "nafta", tr: "automatica", color: "Negro", cond: "nuevo", origin: "importacion", cur: "PYG", list: 245_000_000, min: 236_000_000, acq: -60, cost: 198_000_000 },
    { key: "hunter", brand: "Changan", cat: "Pick-up", model: "Hunter", version: "2.0T 4x4", ym: 2025, km: 0, fuel: "diesel", tr: "automatica", color: "Rojo", cond: "nuevo", origin: "importacion", cur: "PYG", list: 212_000_000, min: 204_000_000, acq: -80, cost: 171_000_000 },
    { key: "alsvin", brand: "Changan", cat: "Sedán", model: "Alsvin", version: "1.5 DCT", ym: 2026, km: 0, fuel: "nafta", tr: "dct", color: "Plata", cond: "nuevo", origin: "importacion", cur: "PYG", list: 99_000_000, min: 95_000_000, acq: -15, cost: 79_000_000, prep: "en_proceso", phys: "en_preparacion" },
    { key: "cs55b", brand: "Changan", cat: "SUV", model: "CS55 Plus", version: "Luxury 1.5T", ym: 2026, km: 0, fuel: "nafta", tr: "automatica", color: "Azul", cond: "nuevo", origin: "importacion", cur: "PYG", list: 175_000_000, min: 168_000_000, acq: -150, cost: 141_000_000 },
  ];
  const veh: Record<string, string> = {};
  for (const v of VEHICLES) {
    const id = await as(U.inventario, async (tx) => {
      const [r] = await tx<{ id: string }[]>`
        insert into public.vehicles (org_id, branch_id, brand_id, category_id, model, version, year_manufacture, year_model, vin,
          mileage_km, fuel, transmission, color, condition, origin, location, acquisition_date, supplier_id, responsible_id,
          price_currency, physical_status, prep_status, doc_status, created_by)
        values (${orgId}, ${branch!.id}, ${brands[v.brand]!}, ${cats[v.cat]!}, ${v.model}, ${v.version}, ${v.ym - (v.cond === "nuevo" ? 1 : 0)}, ${v.ym},
          ${`DEMO${v.key.toUpperCase().padEnd(13, "X").slice(0, 13)}`}, ${v.km}, ${v.fuel}, ${v.tr}, ${v.color}, ${v.cond}, ${v.origin},
          ${v.phys === "en_transito" ? "En tránsito" : "Salón principal"}, ${T(v.acq)}, ${v.cond === "nuevo" ? sup.imp! : null}, ${U.inventario},
          ${v.cur}, ${v.phys ?? "listo"}, ${v.prep ?? "completa"}, ${v.docs ?? "completa"}, ${U.inventario})
        returning id`;
      const rate = v.cur === "USD" ? 7300 : 1;
      await tx`insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base, incurred_on, supplier_id, created_by)
               values (${orgId}, ${r!.id}, 'adquisicion', 'Costo de adquisición', ${v.cost}, ${v.cur}, ${rate}, ${T(v.acq)}, ${v.cond === "nuevo" ? sup.imp! : null}, ${U.inventario})`;
      for (const [kind, desc, amount, est] of v.extra ?? []) {
        await tx`insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, fx_rate_to_base, incurred_on, is_estimate, created_by)
                 values (${orgId}, ${r!.id}, ${kind}, ${desc}, ${amount}, ${v.cur}, ${rate}, ${T(v.acq + 3)}, ${est}, ${U.inventario})`;
      }
      return r!.id;
    });
    // precios: los fija gerencia comercial (permiso inventory.pricing.edit)
    await as(U.gerente, (tx) => tx`update public.vehicles set list_price = ${v.list}, min_price = ${v.min} where id = ${id}`);
    veh[v.key] = id;
  }

  // ----------------------------------------------------------------- clientes
  const CUSTOMERS: Array<[string, string, "persona" | "empresa", "ci" | "ruc", string, string, string]> = [
    ["c1", "Carlos Benítez", "persona", "ci", "1000101", "0981 100 101", "sofia"],
    ["c2", "María José Duarte", "persona", "ci", "1000102", "0982 100 102", "sofia"],
    ["c3", "Agroganadera Demo S.A.", "empresa", "ruc", "80100103-1", "0983 100 103", "diego"],
    ["c4", "Roberto Insfrán", "persona", "ci", "1000104", "0984 100 104", "diego"],
    ["c5", "Lucía Fernández", "persona", "ci", "1000105", "0985 100 105", "sofia"],
    ["c6", "Constructora Demo SRL", "empresa", "ruc", "80100106-6", "0986 100 106", "diego"],
    ["c7", "Javier Acosta", "persona", "ci", "1000107", "0987 100 107", "sofia"],
    ["c8", "Natalia Ramírez", "persona", "ci", "1000108", "0971 100 108", "diego"],
    ["c9", "Gustavo Martínez", "persona", "ci", "1000109", "0972 100 109", "sofia"],
    ["c10", "Paola Escobar", "persona", "ci", "1000110", "0973 100 110", "diego"],
  ];
  const cus: Record<string, string> = {};
  const sellerOf: Record<string, string> = {};
  for (const [key, name, kind, docType, doc, phone, seller] of CUSTOMERS) {
    const sellerId = seller === "sofia" ? U.sofia : U.diego;
    const [c] = await as(sellerId, (tx) => tx<{ id: string }[]>`
      insert into public.customers (org_id, kind, full_name, doc_type, doc_number, phone, email, city, assigned_seller_id, created_by, source)
      values (${orgId}, ${kind}, ${name}, ${docType}, ${doc}, ${phone}, ${`${key}@cliente.demo`}, 'Asunción', ${sellerId}, ${sellerId}, 'Salón')
      returning id`);
    cus[key] = c!.id;
    sellerOf[key] = sellerId;
  }

  // ------------------------------------------------------------- operaciones
  async function deal(o: { c: string; v: string; cur: "PYG" | "USD"; list: number; disc?: number; down: number; trade?: { id: string; value: number }; type?: "contado" | "financiado" }) {
    const seller = sellerOf[o.c]!;
    const [d] = await as(seller, (tx) => tx<{ id: string }[]>`
      insert into public.deals (org_id, customer_id, vehicle_id, seller_id, currency, list_price, discount_amount, trade_in_appraisal_id,
                                trade_in_value, down_payment, payment_type, created_by)
      values (${orgId}, ${cus[o.c]!}, ${veh[o.v]!}, ${seller}, ${o.cur}, ${o.list}, ${o.disc ?? 0}, ${o.trade?.id ?? null},
              ${o.trade?.value ?? 0}, ${o.down}, ${o.type ?? "financiado"}, ${seller}) returning id`);
    const [s] = await as(seller, (tx) => tx<{ s: string }[]>`select public.rpc_deal_submit(${d!.id}) as s`);
    if (s!.s === "pendiente_aprobacion") {
      const [ap] = await admin<{ id: string }[]>`select id from public.approvals where entity_id = ${d!.id} and status = 'pendiente'`;
      await as(U.gerente, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'Aprobado (demostración)')`);
    }
    return d!.id;
  }

  async function formalize(dealId: string, signedOn: string, o: { cur: "PYG" | "USD"; list: number; disc?: number; down: number; trade?: number; fin?: Omit<FinancingTerms, "firstDueDate"> }) {
    const s = buildDealSchedule({
      currency: o.cur, listPrice: o.list, discount: o.disc ?? 0, tradeInValue: o.trade ?? 0, downPayment: o.down, operationDate: signedOn,
      financing: o.fin ? { ...o.fin, firstDueDate: addMonths(signedOn, 1) } : null,
    });
    const p = toRpcPayload(s);
    const [c] = await as(U.admin, (tx) => tx<{ id: string }[]>`
      select public.rpc_deal_formalize(${dealId}, ${signedOn}, ${tx.json(p.plan as never)}, ${tx.json(p.schedule as never)}, ${U.cobranzas}) as id`);
    return { contractId: c!.id, schedule: s };
  }

  async function pay(contractId: string, customer: string, amount: number, on: string, cur: "PYG" | "USD" = "PYG", ref?: string) {
    const account = cur === "USD" ? bancoUsd!.id : bancoPyg!.id;
    const [p] = await as(U.cobranzas, (tx) => tx<{ id: string }[]>`select public.rpc_payment_register(${tx.json({
      customer_id: cus[customer]!, contract_id: contractId, received_on: on, method: "transferencia", cash_account_id: account,
      currency: cur, amount, reference: ref ?? `DEMO-${on}-${amount}`,
    } as never)}) as id`);
    await as(U.admin, (tx) => tx`select public.rpc_payment_confirm(${p!.id})`);
    return p!.id;
  }

  const fin18 = { method: "frances" as const, ratePercent: 18, rateConvention: "nominal_annual" as const };

  // 1) Ranger XLT — financiada hace 185 días; pagó 1 cuota y media y dejó de pagar (> 90 días)
  {
    const o = { cur: "PYG" as const, list: 365_000_000, disc: 5_000_000, down: 110_000_000, fin: { ...fin18, termMonths: 24 } };
    const d = await deal({ c: "c1", v: "ranger", ...o });
    const { contractId, schedule } = await formalize(d, T(-185), o);
    await pay(contractId, "c1", 110_000_000, T(-185));
    const cuota = schedule.regularPayment!;
    await pay(contractId, "c1", cuota, T(-153));
    await pay(contractId, "c1", Math.round(cuota / 2), T(-120));
    await as(U.admin, (tx) => tx`select public.rpc_deal_deliver(${d}, ${T(-183)}, 'Entregada (demostración)')`);
    await as(U.cobranzas, (tx) => tx`insert into public.collection_actions (org_id, customer_id, contract_id, channel, result, promise_amount, promise_currency, promise_date, notes, next_action, next_action_at, user_id, occurred_at)
      values (${orgId}, ${cus.c1!}, ${contractId}, 'llamada', 'promesa_pago', ${cuota}, 'PYG', ${T(-5)}, 'Prometió pagar una cuota al cobrar una venta de ganado', 'Volver a llamar', ${T(0)}, ${U.cobranzas}, ${T(-12) + "T14:00:00-03:00"})`);
  }

  // 2) CS55 Plus — 100 días; al día salvo la última cuota (1–30 días)
  {
    const o = { cur: "PYG" as const, list: 175_000_000, down: 55_000_000, fin: { ...fin18, termMonths: 18 } };
    const d = await deal({ c: "c2", v: "cs55", ...o });
    const { contractId, schedule } = await formalize(d, T(-100), o);
    await pay(contractId, "c2", 55_000_000, T(-100));
    await pay(contractId, "c2", schedule.regularPayment!, T(-70));
    await pay(contractId, "c2", schedule.regularPayment!, T(-41));
    await as(U.admin, (tx) => tx`select public.rpc_deal_deliver(${d}, ${T(-98)}, null)`);
    await as(U.cobranzas, (tx) => tx`insert into public.collection_actions (org_id, customer_id, contract_id, channel, result, promise_amount, promise_currency, promise_date, notes, next_action_at, user_id)
      values (${orgId}, ${cus.c2!}, ${contractId}, 'whatsapp', 'promesa_pago', ${schedule.regularPayment!}, 'PYG', ${T(3)}, 'Confirma transferencia el viernes', ${T(4)}, ${U.cobranzas})`);
  }

  // 3) Evoque (USD) — 70 días, pago en guaraníes convertido; atrasado 31–60 días
  {
    const o = { cur: "USD" as const, list: 78_000, down: 31_200, fin: { method: "frances" as const, ratePercent: 9.5, rateConvention: "effective_annual" as const, termMonths: 36 } };
    const d = await deal({ c: "c3", v: "evoque", ...o });
    const { contractId } = await formalize(d, T(-70), o);
    await pay(contractId, "c3", 31_200, T(-70), "USD");
    await as(U.admin, (tx) => tx`select public.rpc_deal_deliver(${d}, ${T(-66)}, null)`);
    await as(U.cobranzas, (tx) => tx`insert into public.collection_actions (org_id, customer_id, contract_id, channel, result, notes, next_action, next_action_at, user_id)
      values (${orgId}, ${cus.c3!}, ${contractId}, 'email', 'sin_respuesta', 'Se envió estado de cuenta al área de administración', 'Visitar oficina', ${T(-1)}, ${U.cobranzas})`);
  }

  // 4) Territory — contado hace 20 días, entregada
  {
    const o = { cur: "PYG" as const, list: 245_000_000, disc: 4_000_000, down: 241_000_000 };
    const d = await deal({ c: "c4", v: "territory", ...o, type: "contado" });
    const { contractId } = await formalize(d, T(-20), o);
    await pay(contractId, "c4", 241_000_000, T(-20));
    await as(U.admin, (tx) => tx`select public.rpc_deal_deliver(${d}, ${T(-18)}, null)`);
  }

  // 5) UNI-K con trade-in de un CS15 usado — formalizada hace 6 días, pendiente de entrega
  {
    const [a] = await as(U.diego, (tx) => tx<{ id: string }[]>`
      insert into public.trade_in_appraisals (org_id, customer_id, brand_name, model, version, year_model, mileage_km, vin, color, fuel, transmission,
        doc_status, currency, market_value_estimate, market_value_source, market_value_date, offered_value, expected_resale_price,
        estimated_repair_costs, appraiser_notes, appraiser_id, created_by)
      values (${orgId}, ${cus.c6!}, 'Changan', 'CS15', '1.5 MT', 2021, 63000, 'DEMOCS15TRADEIN', 'Blanco', 'nafta', 'manual',
        'completa', 'PYG', 72000000, 'Relevamiento de 4 avisos clasificados (demostración)', ${T(-12)}, 60000000, 74000000,
        3500000, 'Desgaste normal; requiere neumáticos', ${U.diego}, ${U.diego}) returning id`);
    for (const [area, rating, notes, est] of [["mecanica", "bueno", "Motor y caja sin observaciones", 0], ["carroceria", "regular", "Rayones en paragolpes", 1_200_000], ["neumaticos", "regular", "Reemplazar 2 cubiertas", 2_300_000]] as const) {
      await as(U.diego, (tx) => tx`insert into public.appraisal_inspections (org_id, appraisal_id, area, rating, notes, repair_estimate, inspected_by)
        values (${orgId}, ${a!.id}, ${area}, ${rating}, ${notes}, ${est}, ${U.diego})`);
    }
    await as(U.diego, (tx) => tx`select public.rpc_tradein_submit(${a!.id})`);
    const [ap] = await admin<{ id: string }[]>`select id from public.approvals where entity_id = ${a!.id} and status = 'pendiente'`;
    await as(U.gerente, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'Valor razonable para reventa')`);
    await as(U.diego, (tx) => tx`select public.rpc_tradein_customer_decision(${a!.id}, true, 58000000)`);
    const o = { cur: "PYG" as const, list: 245_000_000, down: 70_000_000, trade: 58_000_000, fin: { ...fin18, termMonths: 12 } };
    const d = await deal({ c: "c6", v: "unik", ...o, trade: { id: a!.id, value: 58_000_000 } });
    const { contractId } = await formalize(d, T(-6), o);
    await pay(contractId, "c6", 70_000_000, T(-6));
    await as(U.inventario, (tx) => tx`select public.rpc_tradein_acquire(${a!.id}, ${tx.json({ brand_id: brands.Changan, category_id: cats.SUV, list_price: 74_000_000, min_price: 70_000_000, location: "Playa de usados" } as never)}, ${T(-6)})`);
  }

  // 6) Bronco Sport — descuento 6% pendiente de aprobación
  {
    const dId = await as(U.sofia, (tx) => tx<{ id: string }[]>`
      insert into public.deals (org_id, customer_id, vehicle_id, seller_id, currency, list_price, discount_amount, down_payment, payment_type, created_by)
      values (${orgId}, ${cus.c5!}, ${veh.bronco!}, ${U.sofia}, 'PYG', 330000000, 19800000, 100000000, 'financiado', ${U.sofia}) returning id`);
    await as(U.sofia, (tx) => tx`select public.rpc_deal_submit(${dId[0]!.id})`);
  }

  // 7) Velar — reserva activa con seña en USD, vence en 2 días
  {
    const [r] = await as(U.director, (tx) => tx<{ id: string }[]>`
      select public.rpc_reservation_create(${veh.velar!}, ${cus.c7!}, ${new Date(Date.now() + 2 * 86400_000).toISOString()}, 'Espera aprobación de crédito bancario',
        ${tx.json({ amount: 5_000, currency: "USD", method: "transferencia", cash_account_id: bancoUsd!.id, received_on: T(-1), reference: "DEMO-SENA-VELAR" } as never)}) as id`);
    const [p] = await admin<{ id: string }[]>`select id from public.customer_payments where reservation_id = ${r!.id}`;
    await as(U.admin, (tx) => tx`select public.rpc_payment_confirm(${p!.id})`);
  }

  // 8) Hunter — financiada hace 45 días, al día
  {
    const o = { cur: "PYG" as const, list: 212_000_000, down: 72_000_000, fin: { method: "aleman" as const, ratePercent: 1.4, rateConvention: "monthly" as const, termMonths: 24 } };
    const d = await deal({ c: "c8", v: "hunter", ...o });
    const { contractId, schedule } = await formalize(d, T(-45), o);
    await pay(contractId, "c8", 72_000_000, T(-45));
    await pay(contractId, "c8", schedule.rows.find((r) => r.kind === "cuota")!.total, T(-15));
    await as(U.admin, (tx) => tx`select public.rpc_deal_deliver(${d}, ${T(-44)}, null)`);
  }

  // 9) Ranger usada — vendida ayer, entrega inicial aún sin cobrar
  {
    const o = { cur: "PYG" as const, list: 198_000_000, down: 60_000_000, fin: { ...fin18, termMonths: 12 } };
    const d = await deal({ c: "c9", v: "ranger23", ...o });
    await formalize(d, T(-1), o);
  }

  // Oportunidades abiertas
  const stages = Object.fromEntries((await admin<{ key: string; id: string }[]>`select key, id from public.pipeline_stages where org_id = ${orgId}`).map((s) => [s.key, s.id]));
  for (const [c, v, stage, title, value] of [
    ["c10", "cs35", "propuesta", "CS35 Plus para uso familiar", 139_000_000],
    ["c5", "bronco", "negociacion", "Bronco Sport — financiación 24 meses", 310_200_000],
    ["c7", "velar", "reserva", "Velar con crédito bancario", 98_500 * 7350],
    ["c3", "raptor", "interesado", "Segunda unidad para la flota", 525_000_000],
  ] as const) {
    await as(sellerOf[c]!, (tx) => tx`insert into public.opportunities (org_id, customer_id, vehicle_id, stage_id, seller_id, title, expected_value, currency, next_action, next_action_at, created_by)
      values (${orgId}, ${cus[c]!}, ${veh[v]!}, ${stages[stage]!}, ${sellerOf[c]!}, ${title}, ${value}, 'PYG', 'Seguimiento', ${T(2)}, ${sellerOf[c]!})`);
  }

  // ------------------------------------------------------ cuentas por pagar
  async function invoice(by: string, p: Record<string, unknown>, approve = true) {
    const [r] = await as(by, (tx) => tx<{ id: string }[]>`select public.rpc_supplier_invoice_create(${tx.json(p as never)}) as id`);
    if (approve) {
      const [ap] = await admin<{ id: string }[]>`select id from public.approvals where entity_id = ${r!.id} and status = 'pendiente'`;
      await as(U.finanzas, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'Conforme')`);
    }
    return r!.id;
  }
  await invoice(U.inventario, { supplier_id: sup.tra, invoice_number: "001-001-0004512", issue_date: T(-10), due_date: T(5), currency: "PYG", amount: 6_600_000, tax_amount: 600_000, concept: "Traslado Everest desde puerto", category: "transporte", vehicle_id: veh.everest, create_vehicle_cost: true, cost_kind: "transporte" });
  const repairInv = await invoice(U.inventario, { supplier_id: sup.tal, invoice_number: "002-001-0000789", issue_date: T(-40), due_date: T(-10), currency: "PYG", amount: 4_800_000, tax_amount: 436_364, concept: "Cambio de embrague Ranger XLS", category: "reparacion", vehicle_id: veh.ranger23 });
  await invoice(U.inventario, { supplier_id: sup.ges, invoice_number: "001-002-0001220", issue_date: T(-3), due_date: T(27), currency: "PYG", amount: 2_750_000, tax_amount: 250_000, concept: "Inscripción y chapas (3 unidades)", category: "documentacion" }, false);
  const [rp] = await as(U.finanzas, (tx) => tx<{ id: string }[]>`select public.rpc_supplier_payment_register(${tx.json({ invoice_id: repairInv, paid_on: T(-12), amount: 2_000_000, cash_account_id: bancoPyg!.id, reference: "TRF-DEMO-1" } as never)}) as id`);
  await as(U.finanzas, (tx) => tx`select public.rpc_supplier_payment_confirm(${rp!.id})`);

  // ------------------------------------------------------------------ gastos
  for (const [date, cat, desc, amount, approve, pay] of [
    [T(-35), "alquiler", "Alquiler de salón — mes anterior", 28_000_000, true, true],
    [T(-5), "alquiler", "Alquiler de salón — mes en curso", 28_000_000, true, false],
    [T(-8), "servicios", "Energía eléctrica", 3_450_000, true, true],
    [T(-2), "marketing", "Campaña en redes (demostración)", 6_500_000, false, false],
  ] as const) {
    const [e] = await as(U.admin, (tx) => tx<{ id: string }[]>`select public.rpc_expense_create(${orgId}, ${tx.json({ expense_date: date, category: cat, description: desc, amount, currency: "PYG", supplier_id: cat === "alquiler" ? sup.inm : null } as never)}) as id`);
    if (approve) {
      const [ap] = await admin<{ id: string }[]>`select id from public.approvals where entity_id = ${e!.id} and status = 'pendiente'`;
      await as(U.finanzas, (tx) => tx`select public.rpc_approval_decide(${ap!.id}, true, 'ok')`);
    }
    if (pay) await as(U.admin, (tx) => tx`select public.rpc_expense_pay(${e!.id}, ${bancoPyg!.id}, ${date}, null)`);
  }

  // ------------------------------------------------- conciliación con diferencia
  const movs = await admin<{ id: string }[]>`select id from public.cash_movements where account_id = ${cajaPyg!.id} and occurred_on <= ${T(-30)}`;
  await as(U.finanzas, (tx) => tx`select public.rpc_reconciliation_create(${cajaPyg!.id}, ${T(-30)}, 84850000, ${movs.map((m) => m.id)}, 'Arqueo de caja (demostración): faltante a investigar')`);

  // ----------------------------------------------------------- verificación
  const bad = await admin`select c.number from public.contracts c join public.v_contract_balances b on b.contract_id = c.id
                          where c.org_id = ${orgId} and b.ledger_balance <> b.outstanding - b.unapplied_credit`;
  if (bad.length) throw new Error(`Contratos inconsistentes: ${bad.map((b) => b.number).join(", ")}`);

  await app.end();
  await admin.end();
  console.log("\nOrganización de DEMOSTRACIÓN creada.");
  console.log(gatewayUp ? `Usuarios (contraseña: ${DEMO_PASSWORD}):` : "Usuarios creados sin contraseña (Supabase Auth local no está en ejecución):");
  for (const u of USERS) console.log(`  ${u.role.padEnd(19)} ${u.email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
