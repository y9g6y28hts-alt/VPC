// =============================================================================
// Driver de base de datos
//  · pg: PostgreSQL real (MH_DATABASE_URL / DATABASE_URL). Modo de producción.
//  · embedded: PostgreSQL embebido (PGlite, WebAssembly) cargado desde una
//    instantánea generada en el build con el seed de demostración. Se activa
//    solo cuando no hay base configurada (p. ej. un despliegue en Vercel sin
//    base). Mismo esquema, mismas funciones, RLS y roles: el gateway no cambia.
//    Los cambios viven en la memoria de cada instancia y no son permanentes.
// =============================================================================
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool, types } from "pg";

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Driver {
  kind: "pg" | "embedded";
  /** Conexión exclusiva para una transacción. */
  withConnection<T>(fn: (c: SqlClient) => Promise<T>): Promise<T>;
  /** Consultas administrativas (seed y pruebas), fuera del rol de la aplicación. */
  admin: SqlClient;
  close(): Promise<void>;
}

// numeric y bigint como texto (precisión exacta); date como texto (sin zona horaria).
types.setTypeParser(1082, (v) => v);

export const DEMO_DB_DIR = path.join(process.cwd(), "demo-db");
export const DEMO_DB_FILE = path.join(DEMO_DB_DIR, "motor-haus.tar.gz");

export function databaseUrl(): string | undefined {
  return process.env.MH_DATABASE_URL || process.env.DATABASE_URL || undefined;
}

export function isEmbedded(): boolean {
  return process.env.MH_EMBEDDED_DB === "1" || (!databaseUrl() && process.env.MH_EMBEDDED_DB !== "0");
}

declare global {
  // eslint-disable-next-line no-var
  var __mhDriver: Promise<Driver> | undefined;
}

export function getDriver(): Promise<Driver> {
  globalThis.__mhDriver ??= isEmbedded() ? embeddedDriver() : resolvePg();
  return globalThis.__mhDriver;
}

/**
 * Con MH_DATABASE_URL explícita se usa siempre esa base. Si solo existe
 * DATABASE_URL (p. ej. creada por una integración de Vercel) pero la base no
 * tiene el esquema de Motor Haus o no responde, se usa la demostración embebida
 * en lugar de fallar.
 */
async function resolvePg(): Promise<Driver> {
  const driver = pgDriver();
  if (process.env.MH_DATABASE_URL || !existsSync(DEMO_DB_FILE)) return driver;
  try {
    const ok = await driver.withConnection(async (c) =>
      (await c.query<{ ok: boolean }>("select to_regclass('public.organizations') is not null as ok")).rows[0]?.ok);
    if (ok) return driver;
    console.warn("[motor-haus] DATABASE_URL no tiene el esquema instalado: se usa la base de demostración embebida.");
  } catch (e) {
    console.warn("[motor-haus] DATABASE_URL no responde (" + (e as Error).message + "): se usa la base de demostración embebida.");
  }
  await driver.close().catch(() => undefined);
  process.env.MH_EMBEDDED_DB = "1";
  return embeddedDriver();
}

export async function closeDriver(): Promise<void> {
  if (globalThis.__mhDriver) {
    const d = await globalThis.__mhDriver;
    globalThis.__mhDriver = undefined;
    await d.close();
  }
}

function pgDriver(): Driver {
  const url = databaseUrl();
  if (!url) throw new Error("MH_DATABASE_URL / DATABASE_URL no está configurada.");
  const pool = new Pool({ connectionString: url, max: Number(process.env.MH_DB_POOL_MAX ?? 10) });
  const adminUrl = process.env.MH_ADMIN_DATABASE_URL;
  const adminPool = adminUrl ? new Pool({ connectionString: adminUrl, max: 4 }) : null;
  return {
    kind: "pg",
    async withConnection(fn) {
      const client = await pool.connect();
      try { return await fn(client as unknown as SqlClient); } finally { client.release(); }
    },
    admin: {
      query: (sql, params) => {
        if (!adminPool) throw new Error("MH_ADMIN_DATABASE_URL no está configurada.");
        return adminPool.query(sql, params) as never;
      },
    },
    async close() { await pool.end(); await adminPool?.end(); },
  };
}

/** Aplica el shim local y todas las migraciones (base vacía). */
export async function applySchema(exec: (sql: string) => Promise<unknown>, root = process.cwd()): Promise<void> {
  await exec(readFileSync(path.join(root, "supabase/local/000_supabase_shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    await exec(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
  }
}

async function embeddedDriver(): Promise<Driver> {
  const { PGlite, types: t } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const fresh = process.env.MH_EMBEDDED_FRESH === "1";
  if (!fresh && !existsSync(DEMO_DB_FILE)) {
    throw new Error("No hay base configurada ni instantánea de demostración (demo-db/). Ejecute el build completo (npm run build).");
  }
  const db = await PGlite.create({
    extensions: { pgcrypto, btree_gist },
    loadDataDir: fresh ? undefined : new Blob([readFileSync(DEMO_DB_FILE)]),
    parsers: { [t.NUMERIC]: (v: string) => v, [t.INT8]: (v: string) => v, [t.DATE]: (v: string) => v },
  });
  if (fresh) await applySchema((sql) => db.exec(sql));

  // PGlite tiene una única conexión: las transacciones se serializan.
  let queue: Promise<unknown> = Promise.resolve();
  const client: SqlClient = { query: (sql, params) => db.query(sql, params) as never };
  const driver = {
    kind: "embedded" as const,
    withConnection<T>(fn: (c: SqlClient) => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        try { return await fn(client); } finally { await db.query("reset role").catch(() => undefined); }
      });
      queue = run.catch(() => undefined);
      return run;
    },
    admin: { query: (sql: string, params?: unknown[]) => queue.then(() => db.query(sql, params)) as never },
    async close() { await db.close(); },
    __db: db,
  };
  return driver;
}

/** Exporta la base embebida a la instantánea (usado por el build). */
export async function dumpEmbedded(file = DEMO_DB_FILE): Promise<number> {
  const d = await getDriver();
  if (d.kind !== "embedded") throw new Error("Solo disponible en modo embebido");
  const { writeFileSync, mkdirSync } = await import("node:fs");
  // El objeto PGlite no se expone en la interfaz: se obtiene por un canal interno.
  const db = (d as unknown as { __db?: { dumpDataDir(c: "gzip"): Promise<Blob> } }).__db;
  if (!db) throw new Error("Instancia embebida no disponible");
  const blob = await db.dumpDataDir("gzip");
  const buf = Buffer.from(await blob.arrayBuffer());
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return buf.length;
}
