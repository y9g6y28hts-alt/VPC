// =============================================================================
// Genera la base de demostración embebida (demo-db/motor-haus.tar.gz) durante el
// build: esquema completo + seed por funciones de negocio, en PostgreSQL
// embebido (PGlite). La app la usa automáticamente cuando no hay una base
// configurada (MH_DATABASE_URL / DATABASE_URL), p. ej. en Vercel sin base.
// Omitir con MH_SKIP_DEMO_DB=1.
// =============================================================================
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DEMO_DB_DIR, dumpEmbedded } from "@/server/driver";
import { closePool } from "@/server/gateway";
import { runSeed } from "./seed";

async function main() {
  if (process.env.MH_SKIP_DEMO_DB === "1") { console.log("Base de demostración omitida (MH_SKIP_DEMO_DB=1)."); return; }
  const t0 = Date.now();
  process.env.MH_EMBEDDED_DB = "1";
  process.env.MH_EMBEDDED_FRESH = "1";
  console.log("Motor Haus · generando base de demostración embebida…");
  await runSeed();
  const bytes = await dumpEmbedded();
  mkdirSync(DEMO_DB_DIR, { recursive: true });
  // Secreto de sesión propio de este build, usado solo si no se define MH_SESSION_SECRET.
  writeFileSync(path.join(DEMO_DB_DIR, "session-secret.txt"), randomBytes(32).toString("hex"));
  console.log(`Base de demostración lista (${(bytes / 1024 / 1024).toFixed(1)} MB) en ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
}

main().catch((e) => { console.error("✗ No se pudo generar la base de demostración:", e); process.exitCode = 1; }).finally(closePool);
