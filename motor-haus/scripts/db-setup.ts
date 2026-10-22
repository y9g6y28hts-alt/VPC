// =============================================================================
// Motor Haus · Instalación de la base en un PostgreSQL gestionado (Neon, Vercel
// Postgres, RDS…). No requiere superusuario: basta el rol propietario de la base
// con CREATEROLE (el rol por defecto de Neon lo tiene).
//
//   MH_ADMIN_DATABASE_URL  conexión del propietario (directa, no pooled)
//   MH_APP_DB_PASSWORD     contraseña para el rol de la aplicación (mh_app)
//   MH_APP_DB_ROLE         nombre del rol de la aplicación (opcional, por defecto mh_app)
//
// Uso: npx tsx scripts/db-setup.ts   (o npm run db:setup con un .env)
// No usar contra Supabase: allí el esquema auth y los roles ya existen.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const url = process.env.MH_ADMIN_DATABASE_URL;
const password = process.env.MH_APP_DB_PASSWORD;
const role = process.env.MH_APP_DB_ROLE ?? "mh_app";

async function main() {
  if (!url) throw new Error("Defina MH_ADMIN_DATABASE_URL (conexión del propietario de la base)");
  if (!password || password.length < 16) throw new Error("Defina MH_APP_DB_PASSWORD (mínimo 16 caracteres)");
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("MH_APP_DB_ROLE inválido");
  const root = path.resolve(__dirname, "..");
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const exists = await db.query("select to_regclass('public.organizations') is not null as e");
    if (exists.rows[0].e) {
      console.log("La base ya tiene el esquema de Motor Haus: no se modifica.");
      return;
    }
    const shim = readFileSync(path.join(root, "supabase/local/000_supabase_shim.sql"), "utf8")
      .replaceAll("mh_app", role)
      .replace("'mh_app_local_only'", "'__pending__'".replace("__pending__", "x"));
    console.log("→ shim (roles anon/authenticated/service_role, auth.uid(), autenticación local)");
    await db.query(shim);
    await db.query("select set_config('mh.pw', $1, false)", [password]);
    await db.query(`do $$ begin execute format('alter role ${role} with login password %L', current_setting('mh.pw')); end $$`);
    for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
      console.log(`→ ${f}`);
      await db.query(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
    }
    await db.query(`do $$ begin execute format('grant connect on database %I to ${role}', current_database()); end $$`);
    console.log(`\nBase lista. La aplicación debe conectarse como el rol "${role}" (DATABASE_URL).`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error("✗", e.message); process.exitCode = 1; });
