#!/usr/bin/env node
// =============================================================================
// SÓLO DESARROLLO LOCAL. Recrea la base de datos local y aplica las migraciones.
//
//   npm run db:reset              base vacía (sin datos de negocio)
//   npm run db:seed-demo          base + organización de DEMOSTRACIÓN aislada
//
// Variables:
//   DATABASE_ADMIN_URL  superusuario local (por defecto postgres@127.0.0.1)
//   DB_NAME             base a recrear (por defecto dasilva_dev)
//   GOTRUE_BIN          binario de Supabase Auth; si existe, crea el esquema
//                       auth real. Si no, usa supabase/dev/auth-shim.sql.
// =============================================================================
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres_dev_only@127.0.0.1:5432/postgres";
const dbName = process.env.DB_NAME ?? "dasilva_dev";
const withDemo = process.argv.includes("--demo");
const gotrueBin = process.env.GOTRUE_BIN;

if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`DB_NAME inválido: ${dbName}`);
if (process.env.NODE_ENV === "production") throw new Error("db-reset no se ejecuta en producción");

export async function resetDatabase({ name = dbName, demo = withDemo, gotrue = gotrueBin, quiet = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(m);
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();

  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${name}`;
  const sql = postgres(dbUrl.toString(), { max: 1, onnotice: () => {} });

  const bootstrap = readFileSync(join(root, "supabase/dev/bootstrap.sql"), "utf8")
    .replace("current_database_placeholder", name);
  await sql.unsafe(bootstrap);

  if (gotrue && existsSync(gotrue)) {
    const authUrl = new URL(dbUrl);
    authUrl.username = "supabase_auth_admin";
    authUrl.password = "auth_dev_only";
    const res = spawnSync(gotrue, ["migrate"], {
      env: {
        ...process.env,
        GOTRUE_DB_DRIVER: "postgres",
        DATABASE_URL: authUrl.toString(),
        GOTRUE_DB_DATABASE_URL: authUrl.toString(),
        GOTRUE_JWT_SECRET: "migrate-only",
        GOTRUE_SITE_URL: "http://localhost:3000",
        API_EXTERNAL_URL: "http://localhost:9999",
        GOTRUE_API_HOST: "localhost",
        PORT: "9999",
        DB_NAMESPACE: "auth",
      },
      encoding: "utf8",
    });
    if (res.status !== 0) throw new Error(`gotrue migrate falló:\n${res.stderr}\n${res.stdout}`);
    await sql.unsafe(`grant usage on schema auth to anon, authenticated, service_role, dasilva_app;
                      grant execute on all functions in schema auth to anon, authenticated, service_role;`);
    log("· esquema auth creado por Supabase Auth");
  } else {
    await sql.unsafe(readFileSync(join(root, "supabase/dev/auth-shim.sql"), "utf8"));
    log("· esquema auth: shim de pruebas");
  }

  const migDir = join(root, "supabase/migrations");
  for (const file of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await sql.unsafe(readFileSync(join(migDir, file), "utf8"));
    } catch (err) {
      await sql.end();
      throw new Error(`Error en ${file}: ${err.message}${err.position ? ` (posición ${err.position})` : ""}`);
    }
    log(`· ${file}`);
  }

  if (demo) {
    await sql.unsafe(readFileSync(join(root, "supabase/seed/demo.sql"), "utf8"));
    log("· datos de DEMOSTRACIÓN cargados (organización aislada, is_demo = true)");
  }
  await sql.end();
  return dbUrl.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase()
    .then((url) => console.log(`Base lista: ${url.replace(/:[^:@/]+@/, ":***@")}`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
