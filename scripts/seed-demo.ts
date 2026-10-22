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
import { createSql } from "../src/server/db/client";
import { DEMO_PASSWORD, USERS, seedDemo } from "../src/server/demo/seed";

const DB = process.env.DB_NAME ?? "dasilva_dev";
const GOTRUE = process.env.GOTRUE_BIN;

if (process.env.NODE_ENV === "production") throw new Error("El seed de demostración no se ejecuta en producción");

async function main() {
  const adminUrl = await resetDatabase({ name: DB, demo: false, gotrue: GOTRUE, quiet: false });
  const admin = createSql(adminUrl, { max: 2 });
  const app = createSql(`postgres://dasilva_app:dasilva_app_dev_only@127.0.0.1:5432/${DB}`, { max: 4 });

  const gatewayUp = GOTRUE
    ? await fetch(`http://localhost:${DEV_GATEWAY_PORT}/auth/v1/health`).then((r) => r.ok).catch(() => false)
    : false;
  await seedDemo({
    admin,
    app,
    createAuthUser: async (email) => {
      if (gatewayUp) {
        const res = await fetch(`http://localhost:${DEV_GATEWAY_PORT}/auth/v1/admin/users`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${DEV_SERVICE_KEY}`, apikey: DEV_SERVICE_KEY },
          body: JSON.stringify({ email, password: DEMO_PASSWORD, email_confirm: true }),
        });
        if (!res.ok) throw new Error(`No se pudo crear ${email}: ${res.status} ${await res.text()}`);
        return ((await res.json()) as { id: string }).id;
      }
      const id = randomUUID();
      await admin`insert into auth.users (id, email) values (${id}, ${email})`;
      return id;
    },
  });

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
