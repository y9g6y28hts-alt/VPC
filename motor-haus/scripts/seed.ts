// =============================================================================
// Motor Haus · Datos de demostración
// -----------------------------------------------------------------------------
// TODOS los datos creados aquí son ficticios y quedan identificados: la
// organización tiene is_demo = true y la interfaz lo muestra permanentemente.
// El seed no inserta saldos ni estados a mano: recorre las funciones de negocio
// reales (alta, recepción, preparación, negociación, aprobación, formalización,
// cobros, conciliación), actuando como cada usuario con su rol.
// Uso: npm run db:reset && npm run db:seed
// =============================================================================

import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { closePool, Db, withUser } from "@/server/gateway";
import { saveScenario, ScenarioParams } from "@/server/services/financing";
import { addDays, addMonths } from "@/domain/finance/dates";

const DEMO_PASSWORD = process.env.MH_DEMO_PASSWORD ?? "MotorHaus-Demo-2026";
const admin = new Pool({ connectionString: process.env.MH_ADMIN_DATABASE_URL });

type Role = "ceo" | "cfo" | "sales_manager" | "sales_advisor" | "collections" | "inventory_manager" | "imports_manager" | "auditor" | "tech_admin";
const PEOPLE: Array<{ key: string; email: string; name: string; title: string; role: Role }> = [
  { key: "ceo", email: "direccion@motorhaus.demo", name: "Alejandro Benítez", title: "Director general", role: "ceo" },
  { key: "cfo", email: "finanzas@motorhaus.demo", name: "Carolina Rojas", title: "Directora financiera", role: "cfo" },
  { key: "gerente", email: "comercial@motorhaus.demo", name: "Martín Giménez", title: "Gerente comercial", role: "sales_manager" },
  { key: "sofia", email: "asesor1@motorhaus.demo", name: "Sofía Duarte", title: "Asesora de ventas", role: "sales_advisor" },
  { key: "diego", email: "asesor2@motorhaus.demo", name: "Diego Acosta", title: "Asesor de ventas", role: "sales_advisor" },
  { key: "cobranzas", email: "cobranzas@motorhaus.demo", name: "Lucía Ferreira", title: "Responsable de cobranzas", role: "collections" },
  { key: "inventario", email: "inventario@motorhaus.demo", name: "Ramón Villalba", title: "Responsable de inventario", role: "inventory_manager" },
  { key: "importaciones", email: "importaciones@motorhaus.demo", name: "Paula Cáceres", title: "Responsable de importaciones", role: "imports_manager" },
  { key: "auditor", email: "auditor@motorhaus.demo", name: "Jorge Ortiz", title: "Auditor externo", role: "auditor" },
  { key: "admin", email: "admin@motorhaus.demo", name: "Soporte Técnico", title: "Administrador técnico", role: "tech_admin" },
];

const users: Record<string, { id: string; email: string }> = {};
let ORG = "";
let TODAY = "";
const d = (days: number) => addDays(TODAY, days);

function as<T>(who: string, fn: (db: Db) => Promise<T>, asOfDate?: string): Promise<T> {
  const u = users[who];
  return withUser({ sub: u.id, email: u.email }, fn, { asOfDate });
}
const rpc = <T = unknown>(who: string, fn: string, args: Record<string, unknown>, asOfDate?: string) =>
  as<T>(who, (db) => db.rpc<T>(fn, args), asOfDate);

// -----------------------------------------------------------------------------
// Catálogo de unidades ficticias
// -----------------------------------------------------------------------------
interface UnitSpec {
  key: string;
  category: string; make: string; model: string; version: string; year: number; usage: number; usageUnit?: string;
  ext: string; int: string; equipment: string[];
  origin: "import" | "local_purchase"; originCountry?: string;
  currency?: "USD" | "PYG";
  purchase: number; costs?: Array<[string, "actual" | "estimated", number]>;
  list: number; min: number; offer?: number;
  identifier: [string, string];
  acquiredDaysAgo: number; receivedDaysAgo?: number; stage: "available" | "transit" | "customs" | "preparation" | "evaluation";
  location?: string;
}

const UNITS: UnitSpec[] = [
  // Vendidas (se formalizan más abajo)
  { key: "gt3", category: "supercar", make: "Porsche", model: "911 GT3", version: "992 Touring", year: 2024, usage: 3200, ext: "GT Silver", int: "Negro / Race-Tex", equipment: ["Paquete Clubsport", "Frenos PCCB", "Elevador eje delantero"], origin: "import", originCountry: "Alemania", purchase: 228000, costs: [["transport", "actual", 6500], ["import_fees", "actual", 14200], ["preparation", "actual", 1200]], list: 289000, min: 272000, identifier: ["vin", "WP0ZZZ99ZRS2DEMO1"], acquiredDaysAgo: 230, receivedDaysAgo: 205, stage: "available" },
  { key: "urus", category: "premium_suv", make: "Lamborghini", model: "Urus", version: "S", year: 2024, usage: 6100, ext: "Giallo Auge", int: "Nero Ade", equipment: ["Paquete Pearl Capsule", "Sistema B&O", "Techo panorámico"], origin: "import", originCountry: "Italia", purchase: 241000, costs: [["transport", "actual", 7200], ["import_fees", "actual", 16800], ["taxes", "actual", 9100]], list: 318000, min: 299000, identifier: ["vin", "ZPBUB3ZL5RLDEMO02"], acquiredDaysAgo: 220, receivedDaysAgo: 190, stage: "available" },
  { key: "g63", category: "premium_suv", make: "Mercedes-AMG", model: "G 63", version: "Grand Edition", year: 2024, usage: 4200, ext: "Kalahari Gold Magno", int: "Negro Nappa", equipment: ["Paquete Night", "Burmester", "Asientos activos"], origin: "local_purchase", purchase: 196000, costs: [["preparation", "actual", 2100]], list: 238000, min: 225000, identifier: ["vin", "W1NYC7HJ9RXDEMO03"], acquiredDaysAgo: 170, receivedDaysAgo: 168, stage: "available" },
  { key: "bentley", category: "sedan_gt", make: "Bentley", model: "Continental GT", version: "Speed W12", year: 2023, usage: 11800, ext: "Beluga", int: "Linen / Beluga", equipment: ["Mulliner Driving Spec", "Naim Audio", "Rotating Display"], origin: "import", originCountry: "Reino Unido", purchase: 182000, costs: [["transport", "actual", 6900], ["import_fees", "actual", 12100]], list: 236000, min: 221000, identifier: ["vin", "SCBCG2ZG0PCDEMO04"], acquiredDaysAgo: 300, receivedDaysAgo: 270, stage: "available" },
  { key: "rrsv", category: "premium_suv", make: "Land Rover", model: "Range Rover", version: "SV LWB P615", year: 2025, usage: 2100, ext: "Sunrise Copper", int: "Perlino", equipment: ["Executive Class Comfort", "Meridian Signature", "Cristal SV"], origin: "local_purchase", purchase: 214000, costs: [["preparation", "actual", 900]], list: 262000, min: 248000, identifier: ["vin", "SALKA9E70SADEMO05"], acquiredDaysAgo: 120, receivedDaysAgo: 118, stage: "available" },
  { key: "roma", category: "supercar", make: "Ferrari", model: "Roma", version: "Spider", year: 2024, usage: 2900, ext: "Rosso Portofino", int: "Cuoio", equipment: ["Paquete Carbono", "Pantalla pasajero", "Cámara 360"], origin: "import", originCountry: "Italia", purchase: 218000, costs: [["transport", "actual", 7000], ["import_fees", "actual", 15500]], list: 279000, min: 262000, identifier: ["vin", "ZFF09RPA0R0DEMO06"], acquiredDaysAgo: 160, receivedDaysAgo: 140, stage: "available" },
  { key: "ducati", category: "motorcycle", make: "Ducati", model: "Panigale V4", version: "S", year: 2025, usage: 380, ext: "Ducati Red", int: "—", equipment: ["Öhlins Smart EC 2.0", "Llantas forjadas", "Akrapovič"], origin: "import", originCountry: "Italia", purchase: 31500, costs: [["transport", "actual", 1400], ["import_fees", "actual", 2600]], list: 44900, min: 41500, identifier: ["vin", "ZDMAAKEW0SBDEMO07"], acquiredDaysAgo: 110, receivedDaysAgo: 95, stage: "available" },
  { key: "riva", category: "boat", make: "Riva", model: "Iseo", version: "27", year: 2023, usage: 140, usageUnit: "h", ext: "Blanco / caoba", int: "Cuero marino", equipment: ["Joystick", "Teca", "Toldo bimini"], origin: "import", originCountry: "Italia", purchase: 312000, costs: [["transport", "actual", 18500], ["import_fees", "actual", 21000]], list: 405000, min: 382000, identifier: ["hull", "IT-RAM27DEMO08"], acquiredDaysAgo: 260, receivedDaysAgo: 230, stage: "available" },
  { key: "gle", category: "premium_suv", make: "Mercedes-Benz", model: "GLE", version: "450 4MATIC", year: 2024, usage: 15000, ext: "Blanco Polar", int: "Negro", equipment: ["Paquete AMG Line", "Techo panorámico"], origin: "local_purchase", currency: "PYG", purchase: 690000000, costs: [["preparation", "actual", 6500000]], list: 815000000, min: 780000000, identifier: ["vin", "W1N1671591ADEMO09"], acquiredDaysAgo: 80, receivedDaysAgo: 78, stage: "available" },
  // Disponibles en salón
  { key: "db12", category: "sedan_gt", make: "Aston Martin", model: "DB12", version: "Coupé", year: 2025, usage: 1200, ext: "Iridescent Emerald", int: "Obsidian Black", equipment: ["Bowers & Wilkins", "Paquete Carbono exterior"], origin: "import", originCountry: "Reino Unido", purchase: 205000, costs: [["transport", "actual", 6800], ["import_fees", "actual", 14600], ["repairs", "estimated", 1800]], list: 262000, min: 248000, identifier: ["vin", "SCFRMFAW1SGDEMO10"], acquiredDaysAgo: 75, receivedDaysAgo: 58, stage: "available" },
  { key: "artura", category: "supercar", make: "McLaren", model: "Artura", version: "Performance", year: 2024, usage: 4800, ext: "Ember Orange", int: "Carbon Black", equipment: ["Paquete Tech Lux", "Clubsport seats"], origin: "import", originCountry: "Reino Unido", purchase: 198000, costs: [["transport", "actual", 6800], ["import_fees", "actual", 13900]], list: 249000, min: 236000, identifier: ["vin", "SBM16AEA6RWDEMO11"], acquiredDaysAgo: 245, receivedDaysAgo: 228, stage: "available" },
  { key: "cullinan", category: "premium_suv", make: "Rolls-Royce", model: "Cullinan", version: "Black Badge", year: 2024, usage: 3900, ext: "Diamond Black", int: "Mandarin / Black", equipment: ["Starlight Headliner", "Viewing Suite", "Bespoke Audio"], origin: "import", originCountry: "Reino Unido", purchase: 392000, costs: [["transport", "actual", 9500], ["import_fees", "actual", 28400], ["taxes", "actual", 12300]], list: 498000, min: 472000, identifier: ["vin", "SLATV4C08RUDEMO12"], acquiredDaysAgo: 130, receivedDaysAgo: 112, stage: "available" },
  { key: "cayenne", category: "premium_suv", make: "Porsche", model: "Cayenne", version: "Turbo GT", year: 2024, usage: 7800, ext: "Arctic Grey", int: "Negro / Shade Green", equipment: ["Escape deportivo titanio", "Paquete Carbono"], origin: "local_purchase", purchase: 171000, costs: [["preparation", "actual", 800]], list: 209000, min: 197000, identifier: ["vin", "WP1ZZZ9YZRDDEMO13"], acquiredDaysAgo: 48, receivedDaysAgo: 46, stage: "available" },
  { key: "pagoda", category: "classic", make: "Mercedes-Benz", model: "280 SL", version: "W113 Pagoda", year: 1969, usage: 86400, ext: "Signal Red", int: "Cognac", equipment: ["Hardtop original", "Caja automática", "Documentación de época"], origin: "import", originCountry: "Estados Unidos", purchase: 132000, costs: [["transport", "actual", 5400], ["import_fees", "actual", 8800], ["repairs", "actual", 9200], ["repairs", "estimated", 3500]], list: 178000, min: 165000, identifier: ["chassis", "113044-10-DEMO14"], acquiredDaysAgo: 330, receivedDaysAgo: 300, stage: "available" },
  { key: "m1000", category: "motorcycle", make: "BMW Motorrad", model: "M 1000 RR", version: "M Competition", year: 2024, usage: 900, ext: "Light White / M", int: "—", equipment: ["Llantas carbono M", "Paquete M Competition"], origin: "local_purchase", purchase: 36500, costs: [], list: 46500, min: 43800, identifier: ["vin", "WB10E6106R6DEMO15"], acquiredDaysAgo: 34, receivedDaysAgo: 33, stage: "available" },
  { key: "etype", category: "classic", make: "Jaguar", model: "E-Type", version: "Series 1 4.2 Roadster", year: 1966, usage: 71200, ext: "British Racing Green", int: "Biscuit", equipment: ["Matching numbers", "Restauración certificada"], origin: "import", originCountry: "Reino Unido", purchase: 168000, costs: [["transport", "actual", 6100], ["import_fees", "actual", 9900]], list: 224000, min: 209000, identifier: ["chassis", "1E1DEMO16"], acquiredDaysAgo: 90, receivedDaysAgo: 70, stage: "available" },
  // En preparación, tránsito, aduana, evaluación
  { key: "sf90", category: "supercar", make: "Ferrari", model: "SF90", version: "Stradale Assetto Fiorano", year: 2023, usage: 5400, ext: "Bianco Cervino", int: "Nero", equipment: ["Assetto Fiorano", "Llantas carbono"], origin: "import", originCountry: "Italia", purchase: 452000, costs: [["transport", "actual", 9800], ["import_fees", "actual", 31500], ["preparation", "estimated", 2400]], list: 569000, min: 541000, identifier: ["vin", "ZFF95NLA0P0DEMO17"], acquiredDaysAgo: 40, receivedDaysAgo: 9, stage: "preparation" },
  { key: "dbx", category: "premium_suv", make: "Aston Martin", model: "DBX", version: "707", year: 2025, usage: 600, ext: "Satin Xenon Grey", int: "Onyx", equipment: ["Paquete 23\"", "Bowers & Wilkins"], origin: "import", originCountry: "Reino Unido", purchase: 221000, costs: [["transport", "estimated", 7000], ["import_fees", "estimated", 15800]], list: 279000, min: 264000, identifier: ["vin", "SCMVUBBW0SFDEMO18"], acquiredDaysAgo: 35, stage: "transit" },
  { key: "huracan", category: "supercar", make: "Lamborghini", model: "Huracán", version: "STO", year: 2023, usage: 3100, ext: "Blu Laufey", int: "Nero Cosmus", equipment: ["Lift system", "Telemetría"], origin: "import", originCountry: "Italia", purchase: 338000, costs: [["transport", "actual", 8600], ["import_fees", "estimated", 24500]], list: 425000, min: 402000, identifier: ["vin", "ZHWUB6ZF7PLDEMO19"], acquiredDaysAgo: 62, stage: "customs" },
  { key: "speedtail", category: "sedan_gt", make: "Porsche", model: "Taycan", version: "Turbo GT Weissach", year: 2025, usage: 300, ext: "Purple Sky", int: "Race-Tex", equipment: ["Paquete Weissach"], origin: "import", originCountry: "Alemania", purchase: 214000, costs: [["transport", "estimated", 6500]], list: 268000, min: 254000, identifier: ["vin", "WP0ZZZY1ZSSDEMO20"], acquiredDaysAgo: 20, stage: "transit" },
  { key: "defender", category: "premium_suv", make: "Land Rover", model: "Defender", version: "OCTA Edition One", year: 2025, usage: 8900, ext: "Faroe Green", int: "Burnt Sienna", equipment: ["Paquete 6D Dynamics"], origin: "local_purchase", purchase: 0, list: 0, min: 0, identifier: ["vin", "SALEA7EU9S2DEMO21"], acquiredDaysAgo: 0, stage: "evaluation" },
];

const unitIds: Record<string, string> = {};
const loc: Record<string, string> = {};
const acct: Record<string, string> = {};
const sup: Record<string, string> = {};
const customers: Record<string, string> = {};

async function createUnit(spec: UnitSpec) {
  const currency = spec.currency ?? "USD";
  const acquiredOn = d(-spec.acquiredDaysAgo);
  const id = await rpc<string>("inventario", "create_unit", {
    p_org: ORG,
    p_unit: {
      category: spec.category, make: spec.make, model: spec.model, version: spec.version, year_built: spec.year,
      model_year: spec.year, usage_value: spec.usage, usage_unit: spec.usageUnit ?? "km", exterior_color: spec.ext,
      interior_color: spec.int, equipment: spec.equipment, origin: spec.origin, origin_country: spec.originCountry,
      currency, acquisition_status: spec.stage === "evaluation" ? "evaluation" : "approved",
      responsible_user_id: users.inventario.id,
    },
    p_identifiers: [{ kind: spec.identifier[0], value: spec.identifier[1] }],
  });
  unitIds[spec.key] = id;
  if (spec.stage === "evaluation") return id;

  await rpc("inventario", "register_unit_cost", {
    p_unit: id, p_concept: "purchase_price", p_nature: "actual", p_amount: spec.purchase, p_currency: currency,
    p_incurred_on: acquiredOn, p_description: "Precio de compra según factura del proveedor",
  });
  for (const [concept, nature, amount] of spec.costs ?? []) {
    await rpc("inventario", "register_unit_cost", {
      p_unit: id, p_concept: concept, p_nature: nature, p_amount: amount, p_currency: currency,
      p_incurred_on: addDays(acquiredOn, 5), p_description: nature === "estimated" ? "Estimación inicial" : "Coste registrado",
    });
  }
  await rpc("inventario", "change_unit_status", {
    p_unit: id, p_dimension: "acquisition", p_to: "acquired", p_reason: "Compra formalizada", p_effective_date: acquiredOn,
  });
  if (spec.stage === "transit" || spec.stage === "customs") {
    await rpc("importaciones", "change_unit_status", { p_unit: id, p_dimension: "logistics", p_to: "in_transit", p_reason: "Embarque despachado" });
    if (spec.stage === "customs") {
      await rpc("importaciones", "change_unit_status", { p_unit: id, p_dimension: "logistics", p_to: "in_customs", p_reason: "Arribo a puerto, ingreso a aduana" });
    }
    return id;
  }
  await rpc("inventario", "receive_unit", {
    p_unit: id, p_location: loc[spec.location ?? (spec.stage === "preparation" ? "TALLER" : "SALON")],
    p_received_on: d(-(spec.receivedDaysAgo ?? spec.acquiredDaysAgo)), p_notes: "Recepción física e inspección de ingreso",
  });
  if (spec.stage === "preparation") {
    // Deja tareas obligatorias pendientes a propósito.
    const tasks = await as("inventario", (db) => db.rows<{ id: string; title: string }>(
      "select id, title from public.preparation_tasks where unit_id = $1 order by sort_order", [id]));
    await rpc("inventario", "complete_preparation_task", { p_task: tasks[0].id, p_status: "done" });
    return id;
  }
  await completePreparation(id);
  await rpc("gerente", "set_unit_price", { p_unit: id, p_list: spec.list, p_minimum: spec.min, p_offer: spec.offer ?? null, p_reason: "Precio de salida aprobado por gerencia" });
  if ((spec.receivedDaysAgo ?? 0) > 150) {
    await rpc("gerente", "set_unit_price", { p_unit: id, p_list: Math.round(spec.list * 0.97), p_minimum: Math.round(spec.min * 0.97), p_offer: null, p_reason: "Ajuste por antigüedad en stock" });
  }
  await rpc("inventario", "change_unit_status", {
    p_unit: id, p_dimension: "commercial", p_to: "available", p_reason: "Unidad lista para salón",
    p_effective_date: d(-(spec.receivedDaysAgo ?? spec.acquiredDaysAgo) + 3),
  });
  return id;
}

async function completePreparation(unitId: string) {
  const tasks = await as("inventario", (db) => db.rows<{ id: string; status: string }>(
    "select id, status from public.preparation_tasks where unit_id = $1", [unitId]));
  for (const t of tasks) if (t.status === "pending") await rpc("inventario", "complete_preparation_task", { p_task: t.id, p_status: "done" });
  const docs = await as("inventario", (db) => db.rows<{ id: string }>("select id from public.unit_documents where unit_id = $1", [unitId]));
  for (const doc of docs) await rpc("inventario", "set_unit_document_status", { p_doc: doc.id, p_status: "verified" });
  await rpc("inventario", "change_unit_status", { p_unit: unitId, p_dimension: "preparation", p_to: "ready", p_reason: "Checklist de preparación completo" });
}

async function createCustomer(key: string, who: string, data: Record<string, unknown>, doc?: [string, string]) {
  const id = await as(who, (db) => db.one<{ id: string }>(
    `insert into public.customers (organization_id, kind, display_name, legal_name, email, phone, city, country, preferences, owner_user_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [ORG, data.kind ?? "individual", data.name, data.legal ?? null, data.email ?? null, data.phone ?? null, data.city ?? "Asunción",
     "Paraguay", JSON.stringify(data.preferences ?? {}), users[who].id, users[who].id])).then((r) => r.id);
  if (doc) {
    await rpc(who, "set_customer_sensitive", { p_customer: id, p_document_type: doc[0], p_document_number: doc[1], p_tax_id: null, p_address: null });
  }
  customers[key] = id;
  return id;
}

interface SaleSpec {
  unit: string; customer: string; advisor: string; contractDaysAgo: number; price: number; down: number;
  plan?: Omit<ScenarioParams, "startDate" | "firstDueDate" | "upfront"> & { firstDueOffsetMonths?: number };
  tradeIn?: { appraisal: string; accepted: number };
}

async function sell(spec: SaleSpec): Promise<{ contract: string; deal: string }> {
  const contractDate = d(-spec.contractDaysAgo);
  const deal = await rpc<string>(spec.advisor, "create_deal", { p_org: ORG, p_customer: customers[spec.customer], p_unit: unitIds[spec.unit] });
  if (spec.tradeIn) {
    await rpc(spec.advisor, "attach_trade_in", { p_deal: deal, p_appraisal: spec.tradeIn.appraisal, p_accepted_value: spec.tradeIn.accepted });
  }
  await rpc(spec.advisor, "update_deal_terms", {
    p_deal: deal, p_items: [{ unit_id: unitIds[spec.unit], negotiated_price: spec.price }], p_cash_down: spec.down,
    p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null,
    p_notes: "Operación de demostración", p_valid_until: null,
  });
  if (spec.plan) {
    const { firstDueOffsetMonths, ...plan } = spec.plan;
    const planId = await as(spec.advisor, (db) => saveScenario(db, deal, "Plan contratado", {
      ...plan, startDate: contractDate, firstDueDate: addMonths(contractDate, firstDueOffsetMonths ?? plan.monthsPerPeriod), upfront: [],
    }));
    await rpc(spec.advisor, "select_financing_plan", { p_deal: deal, p_plan: planId });
  }
  const status = await rpc<string>(spec.advisor, "submit_deal", { p_deal: deal });
  if (status === "pending_approval") {
    const pending = await as("gerente", (db) => db.rows<{ id: string }>(
      "select id from public.approvals where entity_type = 'deal' and entity_id = $1 and status = 'pending'", [deal]));
    for (const a of pending) await rpc("gerente", "decide_approval", { p_approval: a.id, p_decision: "approved", p_note: "Autorizado por condiciones del cliente" });
  }
  const contract = await rpc<string>("cfo", "formalize_deal", { p_deal: deal, p_contract_date: contractDate });
  return { contract, deal };
}

async function pay(contract: string, customer: string, amount: number | string, effective: string, opts: {
  method?: string; reference?: string; confirm?: boolean; account?: string; currency?: string;
} = {}) {
  const payment = await rpc<string>("cobranzas", "record_customer_payment", {
    p_org: ORG, p_customer: customers[customer], p_contract: contract, p_amount: amount, p_currency: opts.currency ?? "USD",
    p_effective_date: effective, p_method: opts.method ?? "transfer",
    p_reference: opts.method === "cash" ? null : (opts.reference ?? `TRF-${effective.replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`),
    p_cash_account: acct[opts.account ?? "USD_BANK"], p_idempotency_key: randomUUID(), p_notes: null, p_allocations: null,
  });
  if (opts.confirm !== false) await rpc("cfo", "confirm_payment", { p_payment: payment, p_note: "Conciliado con extracto bancario" });
  return payment;
}

async function installments(contract: string) {
  return as("cfo", (db) => db.rows<{ id: string; seq: number; due_date: string; total_due: string; kind: string }>(
    "select id, seq, due_date, total_due, kind from public.installment_status where contract_id = $1 order by seq", [contract]));
}

/** Paga las cuotas con vencimiento hasta `untilDaysAgo` (inclusive), en su fecha. */
async function payUntil(contract: string, customer: string, untilDaysAgo: number, opts: { lateDays?: number } = {}) {
  for (const i of await installments(contract)) {
    if (i.due_date <= d(-untilDaysAgo)) {
      const when = addDays(i.due_date, opts.lateDays ?? 0);
      await pay(contract, customer, i.total_due, when > TODAY ? TODAY : when);
    }
  }
}

async function main() {
  if (!process.env.MH_ADMIN_DATABASE_URL || !process.env.DATABASE_URL) {
    throw new Error("Defina DATABASE_URL y MH_ADMIN_DATABASE_URL (ver .env.example)");
  }
  TODAY = (await admin.query<{ d: string }>("select (now() at time zone coalesce($1, 'America/Asuncion'))::date::text as d", [process.env.MH_TIMEZONE ?? null])).rows[0].d;
  const existing = await admin.query("select 1 from public.organizations limit 1");
  if (existing.rowCount) throw new Error("La base ya contiene datos. Ejecute npm run db:reset antes del seed.");

  // 1. Usuarios y organización (único paso con privilegios de servicio)
  for (const p of PEOPLE) {
    const r = await admin.query<{ id: string }>("select auth_local.create_user($1, $2, $3) as id", [p.email, DEMO_PASSWORD, p.name]);
    users[p.key] = { id: r.rows[0].id, email: p.email };
    await admin.query("update public.user_profiles set title = $2 where id = $1", [r.rows[0].id, p.title]);
  }
  ORG = (await admin.query<{ id: string }>("select public.create_organization('Motor Haus', 'USD', true, $1) as id", [users.ceo.id])).rows[0].id;
  await admin.query(
    `update public.organizations set legal_name = 'Motor Haus S.A. (DEMO)', tax_id = '80000000-0 (ficticio)',
       address = 'Av. Demostración 1234, Asunción', phone = '+595 21 000 000', email = 'contacto@motorhaus.demo' where id = $1`, [ORG]);
  const branch = (await admin.query<{ id: string }>(
    "insert into public.branches (organization_id, code, name, address) values ($1, 'ASU', 'Showroom Asunción', 'Av. Demostración 1234') returning id", [ORG])).rows[0].id;
  for (const p of PEOPLE) {
    if (p.key === "ceo") continue;
    await admin.query("insert into public.memberships (organization_id, user_id, role_code, branch_id, created_by) values ($1, $2, $3, $4, $5)",
      [ORG, users[p.key].id, p.role, branch, users.ceo.id]);
  }
  await admin.query("update public.memberships set branch_id = $2 where organization_id = $1 and branch_id is null", [ORG, branch]);
  console.log("✓ organización y usuarios");

  // 2. Configuración operativa (como usuarios con permiso)
  for (const [code, name, kind] of [["SALON", "Showroom principal", "showroom"], ["DEPO", "Depósito norte", "warehouse"],
    ["TALLER", "Taller de preparación", "workshop"], ["PUERTO", "Puerto / Aduana", "customs"]] as const) {
    loc[code] = (await as("inventario", (db) => db.one<{ id: string }>(
      "insert into public.locations (organization_id, branch_id, code, name, kind) values ($1, $2, $3, $4, $5) returning id",
      [ORG, branch, code, name, kind]))).id;
  }
  for (const [key, name, kind, ccy, opening] of [["USD_BANK", "Banco · Cuenta corriente USD", "bank", "USD", 1_250_000],
    ["PYG_BANK", "Banco · Cuenta corriente PYG", "bank", "PYG", 1_800_000_000], ["USD_CASH", "Caja fuerte USD", "cash", "USD", 40_000]] as const) {
    acct[key] = (await as("cfo", (db) => db.one<{ id: string }>(
      `insert into public.cash_accounts (organization_id, name, kind, currency, bank_name, account_number_masked, opening_balance, opening_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [ORG, name, kind, ccy, kind === "bank" ? "Banco Demo S.A." : null, kind === "bank" ? "•••• 4321" : null, opening, d(-365)]))).id;
  }
  for (const [key, name, kind, country] of [["porsche", "Exportadora Stuttgart GmbH (demo)", "vehicle_seller", "Alemania"],
    ["italia", "Auto Italia Export S.r.l. (demo)", "vehicle_seller", "Italia"], ["uk", "British Prestige Export Ltd (demo)", "vehicle_seller", "Reino Unido"],
    ["naviera", "Transatlántica Logística (demo)", "logistics", "Paraguay"], ["despachante", "Despachos Aduaneros Demo", "customs_broker", "Paraguay"],
    ["taller", "Taller Precisión Demo", "workshop", "Paraguay"], ["inmobiliaria", "Inmobiliaria Centro Demo", "operating", "Paraguay"]] as const) {
    sup[key] = (await as("importaciones", (db) => db.one<{ id: string }>(
      "insert into public.suppliers (organization_id, name, kind, country) values ($1, $2, $3, $4) returning id", [ORG, name, kind, country]))).id;
  }
  await as("cfo", (db) => db.rows("update public.org_policies set grace_days = 3, min_effective_annual_rate = 0.06 where organization_id = $1", [ORG]));
  console.log("✓ ubicaciones, cuentas, proveedores y políticas");

  // 3. Inventario
  for (const spec of UNITS) await createUnit(spec);
  console.log(`✓ ${UNITS.length} unidades`);

  // Importaciones en curso
  const po = (await as("importaciones", (db) => db.one<{ id: string }>(
    `insert into public.purchase_orders (organization_id, number, supplier_id, order_date, currency, status, created_by)
     values ($1, 'OC-2026-00031', $2, $3, 'USD', 'approved', $4) returning id`, [ORG, sup.uk, d(-40), users.importaciones.id]))).id;
  await as("importaciones", (db) => db.rows(
    "insert into public.purchase_order_lines (organization_id, purchase_order_id, currency, unit_id, description, amount) values ($1, $2, 'USD', $3, 'Aston Martin DBX 707', 221000)",
    [ORG, po, unitIds.dbx]));
  const ships = [
    { ref: "EMB-0412", units: ["dbx"], origin: "Reino Unido", port: "Southampton", mode: "sea", departed: d(-30), eta: d(12), status: "in_transit" },
    { ref: "EMB-0398", units: ["huracan"], origin: "Italia", port: "Génova", mode: "sea", departed: d(-55), eta: d(-21), status: "in_customs" },
    { ref: "EMB-0420", units: ["speedtail"], origin: "Alemania", port: "Hamburgo", mode: "sea", departed: d(-12), eta: d(26), status: "in_transit" },
  ];
  const shipmentIds: Record<string, string> = {};
  for (const s of ships) {
    const id = (await as("importaciones", (db) => db.one<{ id: string }>(
      `insert into public.shipments (organization_id, reference, purchase_order_id, carrier_supplier_id, origin_country, origin_port, destination,
         transport_mode, departed_on, eta, status, responsible_user_id, tracking)
       values ($1, $2, $3, $4, $5, $6, 'Asunción vía Villeta', $7, $8, $9, 'in_transit', $10, $11) returning id`,
      [ORG, s.ref, s.ref === "EMB-0412" ? po : null, sup.naviera, s.origin, s.port, s.mode, s.departed, s.eta, users.importaciones.id,
       `MSKU${Math.floor(1000000 + Math.random() * 8999999)}`]))).id;
    shipmentIds[s.ref] = id;
    for (const u of s.units) {
      await as("importaciones", (db) => db.rows("insert into public.shipment_units (shipment_id, unit_id, organization_id) values ($1, $2, $3)", [id, unitIds[u], ORG]));
    }
  }
  // Demora: la ETA del embarque del Huracán se movió y ya pasó.
  await as("importaciones", (db) => db.rows("update public.shipments set status = 'arrived_port', eta = $2 where id = $1", [shipmentIds["EMB-0398"], d(-14)]));
  await as("importaciones", (db) => db.rows("update public.shipments set status = 'in_customs' where id = $1", [shipmentIds["EMB-0398"]]));
  await as("importaciones", (db) => db.rows(
    `insert into public.import_events (organization_id, shipment_id, event_type, severity, description, actor_id)
     values ($1, $2, 'incident', 'warning', 'Aduana solicitó certificado de origen adicional. Despachante gestionando.', $3)`,
    [ORG, shipmentIds["EMB-0398"], users.importaciones.id]));
  console.log("✓ importaciones");

  // 4. Clientes
  await createCustomer("ferreira", "sofia", { name: "Ricardo Ferreira (demo)", email: "r.ferreira@cliente.demo", phone: "+595 981 000 101", preferences: { categorias: ["supercar"] } }, ["ci", "1.234.567"]);
  await createCustomer("grupo", "diego", { kind: "company", name: "Grupo Agroindustrial Norte S.A. (demo)", legal: "Grupo Agroindustrial Norte S.A.", email: "compras@agronorte.demo", phone: "+595 21 000 202" }, ["ruc", "80012345-6"]);
  await createCustomer("valdez", "sofia", { name: "Mariana Valdez (demo)", email: "mvaldez@cliente.demo", phone: "+595 982 000 303" }, ["ci", "2.345.678"]);
  await createCustomer("benitez", "diego", { name: "Hugo Benítez Ríos (demo)", email: "hbr@cliente.demo", phone: "+595 983 000 404" }, ["ci", "3.456.789"]);
  await createCustomer("costa", "sofia", { name: "Fernanda Costa (demo)", email: "fcosta@cliente.demo", phone: "+595 984 000 505", city: "Ciudad del Este" }, ["passport", "BR-DEMO-555"]);
  await createCustomer("lopez", "diego", { name: "Andrés López Insfrán (demo)", email: "alopez@cliente.demo", phone: "+595 985 000 606" }, ["ci", "4.567.890"]);
  await createCustomer("nautica", "sofia", { kind: "company", name: "Náutica del Lago S.R.L. (demo)", email: "admin@nauticalago.demo", phone: "+595 21 000 707" }, ["ruc", "80098765-4"]);
  await createCustomer("ortega", "diego", { name: "Valeria Ortega (demo)", email: "vortega@cliente.demo", phone: "+595 986 000 808" }, ["ci", "5.678.901"]);
  await createCustomer("rivas", "sofia", { name: "Tomás Rivas (demo)", email: "trivas@cliente.demo", phone: "+595 987 000 909" }, ["ci", "6.789.012"]);
  await createCustomer("medina", "diego", { name: "Gabriela Medina (demo)", email: "gmedina@cliente.demo", phone: "+595 988 000 010" }, ["ci", "7.890.123"]);
  for (const [cust, who, kind, summary] of [
    ["ferreira", "sofia", "visit", "Visita al salón; interés en GT3 y prueba dinámica coordinada."],
    ["valdez", "sofia", "test_drive", "Prueba de manejo G 63. Consultó financiación a 36 meses."],
    ["rivas", "sofia", "inquiry", "Consulta por Aston Martin DB12; tiene un Porsche Macan para entregar."],
    ["medina", "diego", "inquiry", "Interés en Rolls-Royce Cullinan; solicitó comparar dos planes."],
    ["ortega", "diego", "follow_up", "Seguimiento de propuesta de McLaren Artura."],
  ] as const) {
    await as(who, (db) => db.rows(
      "insert into public.customer_interactions (organization_id, customer_id, channel, kind, summary, user_id, occurred_at) values ($1, $2, 'in_person', $3, $4, $5, now() - interval '3 days')",
      [ORG, customers[cust], kind, summary, users[who].id]));
  }
  console.log("✓ clientes");

  // 5. Tasación aceptada en una venta (Ferrari Roma con Porsche Macan como parte de pago)
  const tiMacan = await rpc<string>("diego", "create_appraisal", { p_org: ORG, p_customer: customers.lopez, p_data: {
    category: "premium_suv", make: "Porsche", model: "Macan", version: "GTS", year_built: 2022, usage_value: 28400, currency: "USD",
    identifier_kind: "vin", identifier_value: "WP1ZZZ95ZNLDEMO30", history_notes: "Único dueño, service oficial al día." } });
  await rpc("diego", "record_appraisal_inspection", { p_appraisal: tiMacan, p_items: [
    { item: "Motor y transmisión", result: "ok" }, { item: "Carrocería", result: "attention", notes: "Rayón en paragolpes trasero" },
    { item: "Neumáticos", result: "attention", notes: "Reemplazo en 5.000 km" }, { item: "Interior", result: "ok" }],
    p_conditions: { body_condition: "good", interior_condition: "excellent", tires_condition: "fair", mechanical_condition: "excellent",
      documentation_status: "complete", inspector_report: "Unidad en buen estado general. Reacondicionamiento menor." } });
  await rpc("diego", "add_appraisal_cost", { p_appraisal: tiMacan, p_concept: "tires", p_amount: 2400, p_description: "Juego de neumáticos" });
  await rpc("diego", "add_appraisal_cost", { p_appraisal: tiMacan, p_concept: "reconditioning", p_amount: 1100, p_description: "Pintura paragolpes y detailing" });
  await rpc("diego", "value_appraisal", { p_appraisal: tiMacan, p_market_value: 78000, p_market_source: "Relevamiento de 6 avisos comparables y cotización de mayorista",
    p_market_date: d(-50), p_proposed_price: 66000, p_expected_resale: 79500, p_uncertainty: "low", p_lien_payoff: 0 });
  await rpc("diego", "submit_appraisal", { p_appraisal: tiMacan });

  // 6. Ventas formalizadas
  const s1 = await sell({ unit: "gt3", customer: "ferreira", advisor: "sofia", contractDaysAgo: 150, price: 279000, down: 279000 });
  await pay(s1.contract, "ferreira", 279000, d(-150), { reference: "TRF-GT3-0001" });
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.gt3, p_delivered_on: d(-147), p_notes: "Entrega con presentación técnica" });

  const s2 = await sell({ unit: "urus", customer: "grupo", advisor: "diego", contractDaysAgo: 140, price: 301000, down: 95000,
    plan: { system: "french", rateType: "effective_annual", rate: "0.11", termPeriods: 24, monthsPerPeriod: 1, balloons: [] } });
  await payUntil(s2.contract, "grupo", 80);
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.urus, p_delivered_on: d(-136) });

  const s3 = await sell({ unit: "g63", customer: "valdez", advisor: "sofia", contractDaysAgo: 125, price: 229000, down: 69000,
    plan: { system: "german", rateType: "effective_annual", rate: "0.105", termPeriods: 36, monthsPerPeriod: 1, balloons: [] } });
  await payUntil(s3.contract, "valdez", 30);
  const s3inst = await installments(s3.contract);
  const nextS3 = s3inst.find((i) => i.due_date > d(-30) && i.kind === "installment")!;
  await pay(s3.contract, "valdez", nextS3.total_due, d(-1), { confirm: false, reference: "TRF-G63-PEND" });
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.g63, p_delivered_on: d(-120) });

  const s4 = await sell({ unit: "bentley", customer: "benitez", advisor: "diego", contractDaysAgo: 200, price: 222500, down: 60000,
    plan: { system: "french", rateType: "effective_annual", rate: "0.12", termPeriods: 30, monthsPerPeriod: 1,
      balloons: [{ period: 6, amount: "15000.00" }, { period: 12, amount: "15000.00" }] } });
  await pay(s4.contract, "benitez", 60000, d(-200));
  const s4inst = await installments(s4.contract);
  await pay(s4.contract, "benitez", s4inst[1].total_due, s4inst[1].due_date);
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.bentley, p_delivered_on: d(-195) });

  const s5 = await sell({ unit: "rrsv", customer: "costa", advisor: "sofia", contractDaysAgo: 75, price: 252000, down: 132000,
    plan: { system: "zero_interest", rateType: "none", rate: "0", termPeriods: 12, monthsPerPeriod: 1, balloons: [] } });
  await payUntil(s5.contract, "costa", 40);
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.rrsv, p_delivered_on: d(-72) });

  const s6 = await sell({ unit: "roma", customer: "lopez", advisor: "diego", contractDaysAgo: 45, price: 268000, down: 80000,
    tradeIn: { appraisal: tiMacan, accepted: 66000 },
    plan: { system: "french", rateType: "effective_annual", rate: "0.115", termPeriods: 18, monthsPerPeriod: 1, balloons: [] } });
  await payUntil(s6.contract, "lopez", 0);
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.roma, p_delivered_on: d(-43) });
  await rpc("inventario", "acquire_trade_in", { p_appraisal: tiMacan, p_location: loc.TALLER, p_received_on: d(-43) });

  const s7 = await sell({ unit: "ducati", customer: "rivas", advisor: "sofia", contractDaysAgo: 6, price: 43900, down: 43900 });
  await pay(s7.contract, "rivas", 43900, d(-5), { method: "card", reference: "POS-77812" });
  await as("inventario", (db) => db.rows(
    "insert into public.unit_documents (organization_id, unit_id, doc_type, label, required_for_sale) values ($1, $2, 'transfer_form', 'Formulario de transferencia firmado', true)",
    [ORG, unitIds.ducati]));

  const s8 = await sell({ unit: "riva", customer: "nautica", advisor: "sofia", contractDaysAgo: 95, price: 389000, down: 120000,
    plan: { system: "french", rateType: "nominal_annual", rate: "0.10", termPeriods: 24, monthsPerPeriod: 1, balloons: [] } });
  await pay(s8.contract, "nautica", 120000, d(-95));
  const s8inst = await installments(s8.contract);
  await pay(s8.contract, "nautica", s8inst[1].total_due, s8inst[1].due_date);
  const bounced = await pay(s8.contract, "nautica", s8inst[2].total_due, s8inst[2].due_date, { method: "check", reference: "CHQ-004512" });
  await rpc("cfo", "reverse_payment", { p_payment: bounced, p_reason: "Cheque rechazado por fondos insuficientes" });
  await rpc("inventario", "deliver_unit", { p_unit: unitIds.riva, p_delivered_on: d(-90) });

  const s9 = await sell({ unit: "gle", customer: "medina", advisor: "diego", contractDaysAgo: 20, price: 805000000, down: 805000000 });
  await pay(s9.contract, "medina", 805000000, d(-20), { currency: "PYG", account: "PYG_BANK" });
  console.log("✓ ventas, cobros y entregas");

  // 7. Gestión de cobranzas
  const promiseId = await rpc<string>("cobranzas", "log_collection_action", {
    p_org: ORG, p_customer: customers.costa, p_contract: s5.contract, p_channel: "whatsapp", p_outcome: "promise",
    p_promise_amount: 10000, p_promise_currency: "USD", p_promise_date: d(-6), p_next_action: "Confirmar transferencia",
    p_next_action_date: d(-5), p_notes: "La clienta se comprometió a transferir la cuota vencida." }, d(-12));
  await admin.query("update public.collection_actions set contacted_at = $2::date + time '10:30' where id = $1", [promiseId, d(-12)]);
  await rpc("cobranzas", "log_collection_action", {
    p_org: ORG, p_customer: customers.benitez, p_contract: s4.contract, p_channel: "phone", p_outcome: "no_answer",
    p_promise_amount: null, p_promise_currency: null, p_promise_date: null, p_next_action: "Visita al domicilio comercial",
    p_next_action_date: TODAY, p_notes: "Tercer intento sin respuesta." });
  await rpc("cobranzas", "log_collection_action", {
    p_org: ORG, p_customer: customers.grupo, p_contract: s2.contract, p_channel: "email", p_outcome: "promise",
    p_promise_amount: 18000, p_promise_currency: "USD", p_promise_date: d(4), p_next_action: "Verificar ingreso",
    p_next_action_date: d(5), p_notes: "Tesorería del cliente confirma pago con la próxima cosecha." });

  // 8. Negociaciones en curso
  // a) Aprobada, sin formalizar, con dos escenarios para comparar (Cullinan)
  const dCull = await rpc<string>("diego", "create_deal", { p_org: ORG, p_customer: customers.medina, p_unit: unitIds.cullinan });
  await rpc("diego", "update_deal_terms", { p_deal: dCull, p_items: [{ unit_id: unitIds.cullinan, negotiated_price: 489000 }], p_cash_down: 180000,
    p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null, p_notes: null, p_valid_until: d(10) });
  const planA = await as("diego", (db) => saveScenario(db, dCull, "A · Francés 24 meses", {
    system: "french", rateType: "effective_annual", rate: "0.105", termPeriods: 24, monthsPerPeriod: 1, startDate: TODAY,
    firstDueDate: addMonths(TODAY, 1), balloons: [], upfront: [] }));
  await as("diego", (db) => saveScenario(db, dCull, "B · 36 meses con refuerzos", {
    system: "french", rateType: "effective_annual", rate: "0.115", termPeriods: 36, monthsPerPeriod: 1, startDate: TODAY,
    firstDueDate: addMonths(TODAY, 1), balloons: [{ period: 12, amount: "40000.00" }, { period: 24, amount: "40000.00" }], upfront: [] }));
  await rpc("diego", "select_financing_plan", { p_deal: dCull, p_plan: planA });
  await rpc("diego", "submit_deal", { p_deal: dCull });
  await rpc("diego", "issue_document", { p_org: ORG, p_kind: "proposal", p_entity_id: dCull, p_options: {} });

  // b) Pendiente de aprobación por descuento (DB12) con tasación pendiente
  const tiRivas = await rpc<string>("sofia", "create_appraisal", { p_org: ORG, p_customer: customers.rivas, p_data: {
    category: "premium_suv", make: "BMW", model: "X5", version: "M Competition", year_built: 2021, usage_value: 52000, currency: "USD",
    identifier_kind: "vin", identifier_value: "5YMJU0C0XM9DEMO31" } });
  await rpc("sofia", "record_appraisal_inspection", { p_appraisal: tiRivas, p_items: [{ item: "Motor y transmisión", result: "attention", notes: "Pérdida leve de aceite" }],
    p_conditions: { body_condition: "good", interior_condition: "good", tires_condition: "good", mechanical_condition: "fair", documentation_status: "complete" } });
  await rpc("sofia", "add_appraisal_cost", { p_appraisal: tiRivas, p_concept: "repairs", p_amount: 4800, p_description: "Retenes y servicio mayor" });
  await rpc("sofia", "value_appraisal", { p_appraisal: tiRivas, p_market_value: 61000, p_market_source: "Cotización de dos mayoristas", p_market_date: d(-2),
    p_proposed_price: 55000, p_expected_resale: 62500, p_uncertainty: "medium", p_lien_payoff: 12000 });
  await rpc("sofia", "submit_appraisal", { p_appraisal: tiRivas });

  const dDb12 = await rpc<string>("sofia", "create_deal", { p_org: ORG, p_customer: customers.rivas, p_unit: unitIds.db12 });
  await rpc("sofia", "update_deal_terms", { p_deal: dDb12, p_items: [{ unit_id: unitIds.db12, negotiated_price: 239500 }], p_cash_down: 239500,
    p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null, p_notes: "Cliente pide 8,6 % de descuento", p_valid_until: d(5) });
  await rpc("sofia", "submit_deal", { p_deal: dDb12 });

  // c) Borrador con margen bajo (Artura)
  const dArt = await rpc<string>("diego", "create_deal", { p_org: ORG, p_customer: customers.ortega, p_unit: unitIds.artura });
  await rpc("diego", "update_deal_terms", { p_deal: dArt, p_items: [{ unit_id: unitIds.artura, negotiated_price: 226000 }], p_cash_down: 226000,
    p_other_credits: 0, p_other_credits_note: null, p_financed_charges: 0, p_financed_charges_note: null, p_notes: "Unidad con 228 días en stock", p_valid_until: d(7) });

  // d) Reservas (una por vencer)
  await rpc("sofia", "reserve_unit", { p_unit: unitIds.cayenne, p_customer: customers.ferreira, p_conditions: "Reserva sin seña mientras el cliente define financiación", p_hours: 20 });
  await rpc("diego", "reserve_unit", { p_unit: unitIds.cullinan, p_customer: customers.medina, p_deal: dCull,
    p_conditions: "Reserva con seña de USD 10.000 a confirmar", p_hours: 120 });
  console.log("✓ negociaciones, tasaciones y reservas");

  // 9. Proveedores: facturas y pagos
  const payables: Array<{ supplier: string; doc: string; concept: string; category: string; amount: number; issue: number; due: number; unit?: string; approve?: boolean; pay?: boolean }> = [
    { supplier: "uk", doc: "INV-UK-8812", concept: "Aston Martin DBX 707 · saldo de compra", category: "vehicle_purchase", amount: 221000, issue: -35, due: 15, unit: "dbx", approve: true },
    { supplier: "naviera", doc: "FLE-2026-311", concept: "Flete marítimo EMB-0398", category: "logistics", amount: 8600, issue: -50, due: 5, unit: "huracan", approve: true },
    { supplier: "despachante", doc: "DES-1045", concept: "Honorarios despacho Huracán STO", category: "customs", amount: 3200, issue: -25, due: -8, unit: "huracan", approve: true },
    { supplier: "taller", doc: "TAL-559", concept: "Preparación SF90 Stradale", category: "maintenance", amount: 2400, issue: -3, due: 27, unit: "sf90" },
    { supplier: "inmobiliaria", doc: "ALQ-2026-10", concept: "Alquiler showroom octubre", category: "operating", amount: 18000, issue: -21, due: -11, approve: true, pay: true },
    { supplier: "italia", doc: "AIE-2026-077", concept: "Ferrari SF90 Stradale · compra", category: "vehicle_purchase", amount: 452000, issue: -40, due: -20, unit: "sf90", approve: true, pay: true },
  ];
  for (const p of payables) {
    const id = await rpc<string>("importaciones", "create_supplier_payable", { p_org: ORG, p_data: {
      supplier_id: sup[p.supplier], document_number: p.doc, concept: p.concept, category: p.category, amount: p.amount, currency: "USD",
      issue_date: d(p.issue), due_date: d(p.due), unit_id: p.unit ? unitIds[p.unit] : null } });
    if (p.approve) await rpc("cfo", "decide_payable", { p_payable: id, p_decision: "approved", p_note: "Conforme a orden de compra" });
    if (p.pay) await rpc("cfo", "pay_supplier_payable", { p_payable: id, p_amount: p.amount, p_paid_on: d(p.due), p_cash_account: acct.USD_BANK, p_reference: `PAGO-${p.doc}` });
  }

  // 10. Gastos operativos registrados (necesarios para el resultado operativo)
  for (let m = 5; m >= 1; m--) {
    const date = addDays(addMonths(TODAY, -m), 0);
    await rpc("cfo", "record_cash_movement", { p_account: acct.USD_BANK, p_date: date, p_amount: -18000, p_category: "operating_expense",
      p_description: "Alquiler showroom", p_reference: `ALQ-${date.slice(0, 7)}`, p_counterparty: "Inmobiliaria Centro Demo" });
    await rpc("cfo", "record_cash_movement", { p_account: acct.USD_BANK, p_date: date, p_amount: -42000, p_category: "payroll",
      p_description: "Nómina mensual", p_reference: `NOM-${date.slice(0, 7)}`, p_counterparty: "Personal" });
  }
  await rpc("cfo", "record_cash_movement", { p_account: acct.USD_BANK, p_date: d(-15), p_amount: -42000, p_category: "payroll",
    p_description: "Nómina mensual", p_reference: `NOM-${TODAY.slice(0, 7)}`, p_counterparty: "Personal" });
  await rpc("cfo", "record_cash_movement", { p_account: acct.USD_BANK, p_date: d(9), p_amount: -6500, p_category: "tax",
    p_description: "Anticipo de impuesto (programado)", p_status: "pending" });

  // 11. Conteo físico con diferencia
  await rpc("inventario", "record_physical_count", { p_unit: unitIds.etype, p_found: true, p_observed_location: loc.DEPO,
    p_notes: "Encontrada en depósito; el sistema la registra en salón." });
  for (const k of ["pagoda", "m1000", "cayenne", "db12"]) {
    await rpc("inventario", "record_physical_count", { p_unit: unitIds[k], p_found: true, p_observed_location: loc.SALON, p_notes: null });
  }

  // 12. Objetivos comerciales
  for (let m = 0; m <= 5; m++) {
    const month = addMonths(`${TODAY.slice(0, 7)}-01`, -m);
    await as("admin", (db) => db.rows(
      "insert into public.sales_targets (organization_id, period_month, currency, target_revenue, target_units, created_by) values ($1, $2, 'USD', 600000, 3, $3)",
      [ORG, month, users.admin.id]));
  }

  // 13. Documentos emitidos
  await rpc("cobranzas", "issue_document", { p_org: ORG, p_kind: "payment_schedule", p_entity_id: s2.contract, p_options: {} });
  await rpc("cobranzas", "issue_document", { p_org: ORG, p_kind: "account_statement", p_entity_id: s4.contract, p_options: {} });
  console.log("✓ proveedores, tesorería, conteos, objetivos y documentos");

  console.log(`\nSeed completo. Organización DEMO ${ORG}. Contraseña de todos los usuarios demo: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => { console.error("✗ Seed falló:", e); process.exitCode = 1; })
  .finally(async () => { await admin.end(); await closePool(); });
