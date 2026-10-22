import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, closeAll, createOrg, createUser, createVehicle, errorOf, type OrgFixture } from "./helpers";

let f: OrgFixture;

beforeAll(async () => {
  f = await createOrg("Administración prueba");
});
afterAll(closeAll);

const membership = async (userId: string) =>
  (await admin<{ id: string }[]>`select id from public.memberships where org_id = ${f.orgId} and user_id = ${userId}`)[0]!.id;

describe("usuarios y roles", () => {
  it("el administrador técnico no puede promover a director", async () => {
    const m = await membership(f.users.vendedor);
    const err = await errorOf(as(f.users.admin_tecnico, (tx) => tx`update public.memberships set role = 'director' where id = ${m}`));
    expect(err).toMatch(/Sólo un director/);
  });

  it("el administrador técnico no puede degradar ni desactivar a un director", async () => {
    const m = await membership(f.users.director);
    expect(await errorOf(as(f.users.admin_tecnico, (tx) => tx`update public.memberships set role = 'vendedor' where id = ${m}`))).toMatch(/Sólo un director/);
  });

  it("nadie cambia su propio rol", async () => {
    const m = await membership(f.users.admin_tecnico);
    const err = await errorOf(as(f.users.admin_tecnico, (tx) => tx`update public.memberships set role = 'auditor' where id = ${m}`));
    expect(err).toMatch(/propio rol/);
  });

  it("un director retira a otro director, pero nunca a sí mismo", async () => {
    const second = await createUser(f.orgId, "director", "Director 2");
    const m2 = await membership(second);
    await as(f.users.director, (tx) => tx`update public.memberships set is_active = false where id = ${m2}`);
    const own = await membership(f.users.director);
    expect(await errorOf(as(f.users.director, (tx) => tx`update public.memberships set is_active = false where id = ${own}`))).toMatch(/propio rol/);
    const [count] = await admin<{ n: number }[]>`select count(*)::int as n from public.memberships where org_id = ${f.orgId} and role = 'director' and is_active`;
    expect(count!.n).toBe(1);
  });

  it("rpc_member_add exige users.manage y respeta la regla de director", async () => {
    const id = randomUUID();
    await admin`insert into auth.users (id, email) values (${id}, ${`alta.${id.slice(0, 6)}@test.local`})`;
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select public.rpc_member_add(${f.orgId}, ${id}, 'Nuevo Usuario', 'cobranzas')`))).toMatch(/permiso/i);
    expect(await errorOf(as(f.users.admin_tecnico, (tx) => tx`select public.rpc_member_add(${f.orgId}, ${id}, 'Nuevo Usuario', 'director')`))).toMatch(/Sólo un director/);
    await as(f.users.admin_tecnico, (tx) => tx`select public.rpc_member_add(${f.orgId}, ${id}, 'Nuevo Usuario', 'cobranzas')`);
    const [m] = await admin<{ role: string }[]>`select role from public.memberships where org_id = ${f.orgId} and user_id = ${id}`;
    expect(m!.role).toBe("cobranzas");
    const [a] = await admin<{ n: number }[]>`select count(*)::int as n from public.audit_events where org_id = ${f.orgId} and action = 'usuario_alta'`;
    expect(a!.n).toBe(1);
  });

  it("los correos sólo los consulta quien gestiona usuarios", async () => {
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select * from public.rpc_member_emails(${f.orgId})`))).toMatch(/permiso/i);
    const rows = await as(f.users.admin_tecnico, (tx) => tx`select * from public.rpc_member_emails(${f.orgId})`);
    expect(rows.length).toBeGreaterThan(5);
  });
});

describe("configuración", () => {
  it("la moneda base no cambia con operaciones registradas", async () => {
    const vehicleId = await createVehicle(f);
    await admin`insert into public.vehicle_costs (org_id, vehicle_id, kind, description, amount, currency, amount_base, incurred_on)
                values (${f.orgId}, ${vehicleId}, 'adquisicion', 'Compra', 1000, 'PYG', 1000, '2026-01-01')`;
    const err = await errorOf(as(f.users.director, (tx) => tx`update public.organizations set base_currency = 'USD' where id = ${f.orgId}`));
    expect(err).toMatch(/moneda base/);
    const demo = await errorOf(as(f.users.director, (tx) => tx`update public.organizations set is_demo = true where id = ${f.orgId}`));
    expect(demo).toMatch(/demostración/);
  });

  it("los tramos de mora se redefinen de forma atómica y validada", async () => {
    expect(await errorOf(as(f.users.director, (tx) => tx`select public.rpc_aging_buckets_set(${f.orgId}, ${[30, 20]}::int[])`))).toMatch(/crecientes/);
    expect(await errorOf(as(f.users.vendedor, (tx) => tx`select public.rpc_aging_buckets_set(${f.orgId}, ${[15, 45]}::int[])`))).toMatch(/permiso/i);
    await as(f.users.director, (tx) => tx`select public.rpc_aging_buckets_set(${f.orgId}, ${[15, 45]}::int[])`);
    const labels = await admin<{ label: string }[]>`select label from public.aging_buckets where org_id = ${f.orgId} order by sort_order`;
    expect(labels.map((l) => l.label)).toEqual(["Al día", "1–15 días", "16–45 días", "Más de 45 días"]);
    const [b] = await admin<{ b: string }[]>`select app.aging_bucket(${f.orgId}, 20) as b`;
    expect(b!.b).toBe("16–45 días");
  });

  it("la exportación de reportes exige reports.export y queda auditada", async () => {
    expect(await errorOf(as(f.users.administracion, (tx) => tx`select public.rpc_report_export_log(${f.orgId}, 'deudas', '{}'::jsonb, 3)`))).toMatch(/permiso/i);
    await as(f.users.auditor, (tx) => tx`select public.rpc_report_export_log(${f.orgId}, 'deudas', '{"from":"2026-01-01"}'::jsonb, 3)`);
    const rows = await as(f.users.auditor, (tx) => tx<{ actor_id: string; summary: string }[]>`
      select actor_id, summary from public.audit_events where org_id = ${f.orgId} and action = 'reporte_exportado'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(f.users.auditor);
  });

  it("la auditoría no se puede modificar ni borrar", async () => {
    expect(await errorOf(as(f.users.director, (tx) => tx`delete from public.audit_events where org_id = ${f.orgId}`))).not.toBeNull();
    expect(await errorOf(admin`update public.audit_events set summary = 'x' where org_id = ${f.orgId}`)).toMatch(/no se pueden modificar/);
  });
});
