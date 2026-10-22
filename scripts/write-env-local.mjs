#!/usr/bin/env node
// SÓLO DESARROLLO LOCAL: genera .env.local apuntando a Postgres local y a la
// pasarela de Supabase Auth local. No sobrescribe un archivo existente.
import { existsSync, writeFileSync } from "node:fs";
import { DEV_ANON_KEY, DEV_GATEWAY_PORT, DEV_SERVICE_KEY } from "./dev-env.mjs";

if (existsSync(".env.local") && !process.argv.includes("--force")) {
  console.log(".env.local ya existe (use --force para regenerarlo)");
  process.exit(0);
}
writeFileSync(
  ".env.local",
  [
    "# Generado por scripts/write-env-local.mjs — SÓLO DESARROLLO LOCAL",
    `NEXT_PUBLIC_SUPABASE_URL=http://localhost:${DEV_GATEWAY_PORT}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${DEV_ANON_KEY}`,
    "DATABASE_URL=postgres://dasilva_app:dasilva_app_dev_only@127.0.0.1:5432/dasilva_dev",
    `SUPABASE_SERVICE_ROLE_KEY=${DEV_SERVICE_KEY}`,
    "STORAGE_MODE=local",
    "",
  ].join("\n"),
);
console.log(".env.local creado");
