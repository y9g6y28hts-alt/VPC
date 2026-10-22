#!/usr/bin/env node
// Genera src/server/demo/sql-bundle.generated.ts con el SQL que necesita la
// demo autónoma (base embebida). Se ejecuta antes de cada build (prebuild);
// tests/unit/sql-bundle.test.ts verifica que esté sincronizado.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export function buildSqlBundle() {
  const read = (...p) => readFileSync(join(root, ...p), "utf8");
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()
    .map((name) => ({ name, sql: read("supabase/migrations", name) }));
  return [
    "// GENERADO por scripts/bundle-sql.mjs — no editar a mano.",
    `export const BOOTSTRAP_SQL = ${JSON.stringify(read("supabase/dev/bootstrap.sql"))};`,
    `export const AUTH_SHIM_SQL = ${JSON.stringify(read("supabase/dev/auth-shim.sql"))};`,
    `export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = ${JSON.stringify(migrations)};`,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, "src/server/demo/sql-bundle.generated.ts"), buildSqlBundle());
  console.log("sql-bundle.generated.ts actualizado");
}
