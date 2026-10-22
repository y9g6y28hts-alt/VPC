import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, ROLES } from "@/domain/permissions";
import { admin, as, closeAll, createCustomer, createOrg, createUser, createVehicle, errorOf, n, type OrgFixture } from "./helpers";

let f: OrgFixture;
let other: OrgFixture;

beforeAll(async () => {
  f = await createOrg("Da Silva prueba");
  other = await createOrg("Otra empresa");
});
afterAll(closeAll);

describe("matriz de permisos", () => {
  it("la copia en TypeScript coincide con la base de datos", async () => {
    const rows = await admin<{ role: string; permission: string }[]>`select role, permission from public.role_permissions`;
    for (const role of ROLES) {
      const db = rows.filter((r) => r.role === role).map((r) => r.permission).sort();
      expect(db, role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });
});

describe("aislamiento entre organizaciones", () => {
  it("un director no ve datos de otra organización", async () => {
    await createVehicle(other);
    const seen = await as(f.users.director, (tx) => tx`select org_id from public.vehicles`);
    expect(seen.every((r) => r.org_id === f.orgId)).toBe(true);
  });

  it("no puede insertar en otra organización", async () => {
    const err = await errorOf(
      as(f.users.director, (tx) => tx`
        insert into public.customers (org_id, kind, full_name, doc_type, doc_number, created_by)
        values (${other.orgId}, 'persona', 'X', 'ci', '123', ${f.users.director})`),
    );
    expect(err).toMatch(/row-level security/);
  });

  it("no puede vincular entidades de otra organización (claves compuestas)", async () => {
    const foreignBrand = other.brandId;
    const err = await errorOf(
      as(f.users.inventario, (tx) => tx`
        insert into public.vehicles (org_id, brand_id, model, year_manufacture, year_model, fuel, transmission, condition, created_by)
        values (${f.orgId}, ${foreignBrand}, 'X', 2025, 2025, 'nafta', 'manual', 'nuevo', ${f.users.inventario})`),
    );
    expect(err).toMatch(/foreign key/);
  });

  it("un usuario sin membresía no ve nada", async () => {
    const [row] = await admin<{ id: string }[]>`insert into auth.users (id, email) values (gen_random_uuid(), 'nadie@test.local') returning id`;
    const id = row!.id;
    await admin`insert into public.user_profiles (id, full_name) values (${id}, 'Nadie')`;
    const rows = await as(id, (tx) => tx`select count(*)::int as c from public.vehicles`);
    expect(rows[0]!.c).toBe(0);
  });

  it("un usuario desactivado pierde el acceso", async () => {
    const uid = await createUser(f.orgId, "director", "Ex director");
    await admin`update public.user_profiles set is_active = false where id = ${uid}`;
    const rows = await as(uid, (tx) => tx`select count(*)::int as c from public.vehicles`);
    expect(rows[0]!.c).toBe(0);
  });
});

describe("restricciones por rol", () => {
  it("vendedor: no ve costes y la vista de margen los oculta (no muestra cero)", async () => {
    const vid = await createVehicle(f);
    await as(f.users.inventario, (tx) => tx`
      insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, incurred_on, created_by)
      values (${f.orgId}, ${vid}, 'adquisicion', 'Compra', 250000000, 'PYG', '2026-08-01', ${f.users.inventario})`);
    const costs = await as(f.users.vendedor, (tx) => tx`select * from public.vehicle_costs where vehicle_id = ${vid}`);
    expect(costs).toHaveLength(0);
    const [eco] = await as(f.users.vendedor, (tx) => tx`select * from public.v_vehicle_economics where vehicle_id = ${vid}`);
    expect(eco!.total_cost_base).toBeNull();
    expect(eco!.estimated_margin_base).toBeNull();
    const [eco2] = await as(f.users.director, (tx) => tx`select * from public.v_vehicle_economics where vehicle_id = ${vid}`);
    expect(n(eco2!.total_cost_base)).toBe(250_000_000);
    expect(n(eco2!.estimated_margin_base)).toBe(50_000_000);
  });

  it("vendedor: no modifica precios ni costes", async () => {
    const vid = await createVehicle(f);
    // El vendedor no tiene inventory.edit: la política RLS no le deja ver la fila para actualizar.
    const res = await as(f.users.vendedor, (tx) => tx`update public.vehicles set list_price = 1 where id = ${vid} returning id`);
    expect(res).toHaveLength(0);
    // Inventario edita la ficha pero no el precio.
    const err = await errorOf(as(f.users.inventario, (tx) => tx`update public.vehicles set list_price = 1 where id = ${vid}`));
    expect(err).toMatch(/modificar precios/);
    await as(f.users.inventario, (tx) => tx`update public.vehicles set color = 'Blanco' where id = ${vid}`);
  });

  it("corregir un coste histórico requiere permiso explícito y queda auditado", async () => {
    const vid = await createVehicle(f);
    const [c] = await as(f.users.inventario, (tx) => tx<{ id: string }[]>`
      insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, incurred_on, created_by)
      values (${f.orgId}, ${vid}, 'transporte', 'Flete', 3000000, 'PYG', '2026-08-02', ${f.users.inventario}) returning id`);
    const blocked = await as(f.users.inventario, (tx) => tx`update public.vehicle_costs set amount = 1 where id = ${c!.id} returning id`);
    expect(blocked).toHaveLength(0);
    await as(f.users.finanzas, (tx) => tx`update public.vehicle_costs set amount = 3200000 where id = ${c!.id}`);
    const audit = await admin`select * from public.audit_events where entity_type = 'vehicle_costs' and entity_id = ${c!.id} and action = 'update'`;
    expect(audit).toHaveLength(1);
    expect(n(audit[0]!.before_data.amount)).toBe(3_000_000);
    expect(n(audit[0]!.after_data.amount)).toBe(3_200_000);
    expect(audit[0]!.actor_id).toBe(f.users.finanzas);
  });

  it("nadie modifica estados comerciales ni cuotas por fuera de las funciones transaccionales", async () => {
    const vid = await createVehicle(f);
    expect(await errorOf(as(f.users.director, (tx) => tx`update public.vehicles set commercial_status = 'entregado' where id = ${vid}`)))
      .toMatch(/disponibilidad comercial/);
    expect(await errorOf(as(f.users.director, (tx) => tx`
      insert into public.installments (org_id, contract_id, seq, kind, due_date, currency, principal)
      values (${f.orgId}, gen_random_uuid(), 1, 'cuota', '2026-12-01', 'PYG', 1)`))).toMatch(/permission denied/);
    expect(await errorOf(as(f.users.director, (tx) => tx`delete from public.audit_events`))).toMatch(/permission denied/);
  });

  it("retirar y reincorporar una unidad sí está permitido", async () => {
    const vid = await createVehicle(f);
    await as(f.users.inventario, (tx) => tx`update public.vehicles set commercial_status = 'retirado' where id = ${vid}`);
    await as(f.users.inventario, (tx) => tx`update public.vehicles set commercial_status = 'disponible' where id = ${vid}`);
    const ev = await admin`select to_status from public.vehicle_status_events where vehicle_id = ${vid} and dimension = 'commercial' order by id`;
    expect(ev.map((e) => e.to_status)).toEqual(["disponible", "retirado", "disponible"]);
  });

  it("vendedor sólo ve sus clientes; el control de duplicados no filtra datos", async () => {
    const seller2 = await createUser(f.orgId, "vendedor", "Vendedor 2");
    const mine = await createCustomer(f, f.users.vendedor, "4100200");
    const theirs = await createCustomer(f, seller2, "4100201");
    const visible = await as(f.users.vendedor, (tx) => tx`select id from public.customers where id in (${mine}, ${theirs})`);
    expect(visible.map((r) => r.id)).toEqual([mine]);
    const dups = await as(f.users.vendedor, (tx) => tx`select * from public.rpc_customer_duplicates(${f.orgId}, 'ci', '4.100.201', null, null)`);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ id: theirs, match_on: "documento", visible: false });
  });

  it("documento duplicado del mismo cliente es rechazado con formato distinto", async () => {
    await createCustomer(f, undefined, "5200300");
    const err = await errorOf(createCustomer(f, undefined, "5.200.300"));
    expect(err).toMatch(/duplicate key/);
  });

  it("vendedor no reasigna el responsable de cobranza", async () => {
    const cid = await createCustomer(f, f.users.vendedor, "6100100");
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`update public.customers set collector_id = ${f.users.cobranzas} where id = ${cid}`)))
      .toMatch(/responsables de cobranza/);
  });

  it("nadie cambia su propio rol", async () => {
    const err = await errorOf(as(f.users.admin_tecnico, (tx) => tx`
      update public.memberships set role = 'director' where user_id = ${f.users.admin_tecnico}`));
    expect(err).toMatch(/propio rol/);
  });

  it("documentos restringidos sólo con permiso", async () => {
    const vid = await createVehicle(f);
    await as(f.users.inventario, (tx) => tx`
      insert into public.documents (org_id, entity_type, entity_id, title, storage_path, mime_type, size_bytes, is_restricted, uploaded_by)
      values (${f.orgId}, 'vehicle', ${vid}, 'Factura de compra', ${`${f.orgId}/vehicle/${vid}/factura.pdf`}, 'application/pdf', 1000, true, ${f.users.inventario}),
             (${f.orgId}, 'vehicle', ${vid}, 'Ficha técnica', ${`${f.orgId}/vehicle/${vid}/ficha.pdf`}, 'application/pdf', 1000, false, ${f.users.inventario})`);
    const seller = await as(f.users.vendedor, (tx) => tx`select title from public.documents where entity_id = ${vid}`);
    expect(seller.map((d) => d.title)).toEqual(["Ficha técnica"]);
    const fin = await as(f.users.finanzas, (tx) => tx`select title from public.documents where entity_id = ${vid} order by title`);
    expect(fin.map((d) => d.title)).toEqual(["Factura de compra", "Ficha técnica"]);
    const tech = await as(f.users.admin_tecnico, (tx) => tx`select title from public.documents where entity_id = ${vid}`);
    expect(tech).toHaveLength(0);
  });

  it("auditor lee todo pero no escribe", async () => {
    const vid = await createVehicle(f);
    expect(await as(f.users.auditor, (tx) => tx`select id from public.vehicles where id = ${vid}`)).toHaveLength(1);
    expect(await errorOf(as(f.users.auditor, (tx) => tx`
      insert into public.customers (org_id, kind, full_name, doc_type, doc_number, created_by)
      values (${f.orgId}, 'persona', 'X', 'ci', '999', ${f.users.auditor})`))).toMatch(/row-level security/);
  });

  it("anon no tiene acceso", async () => {
    const { app } = await import("./helpers");
    const err = await errorOf(app.begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select * from public.vehicles`;
    }));
    expect(err).toMatch(/permission denied/);
  });
});
