import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { DomainError, toDomainError } from "./errors";
import { closeDriver, getDriver, SqlClient } from "./driver";

// -----------------------------------------------------------------------------
// Gateway de datos
// Cada operación abre una transacción, adopta el rol `authenticated` y fija los
// claims JWT del usuario, igual que PostgREST en Supabase. Así el RLS y las
// funciones de negocio se aplican siempre: el servidor no tiene "modo dios".
// -----------------------------------------------------------------------------

export interface Claims { sub: string; email: string }

export interface Db {
  rows<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T>;
  maybe<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Invoca una función RPC del esquema public y devuelve su valor escalar. */
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function makeDb(client: SqlClient): Db {
  const rows = async <T extends QueryResultRow>(sql: string, params: unknown[] = []) =>
    (await client.query<T>(sql, params)).rows;
  return {
    rows,
    async one<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
      const r = await rows<T>(sql, params);
      if (r.length === 0) throw new DomainError("NOT_FOUND", "Registro no encontrado o sin acceso.");
      return r[0];
    },
    async maybe<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
      const r = await rows<T>(sql, params);
      return r.length ? r[0] : null;
    },
    async rpc<T>(fn: string, args: Record<string, unknown>) {
      if (!IDENT.test(fn)) throw new DomainError("INTERNAL", "Nombre de función inválido");
      const keys = Object.keys(args);
      keys.forEach((k) => { if (!IDENT.test(k)) throw new DomainError("INTERNAL", "Parámetro inválido"); });
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const values = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
      });
      const r = await client.query(`select public.${fn}(${named}) as result`, values);
      return r.rows[0]?.result as T;
    },
  };
}

export interface TxOptions { asOfDate?: string; opId?: string }

export async function withUser<T>(claims: Claims, fn: (db: Db) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const driver = await getDriver().catch((e) => { throw new DomainError("INTERNAL", (e as Error).message); });
  return driver.withConnection(async (client) => {
  try {
    await client.query("begin");
    await client.query(
      "select set_config('request.jwt.claims', $1, true), set_config('app.op_id', $2, true), set_config('app.as_of_date', $3, true)",
      [JSON.stringify({ sub: claims.sub, email: claims.email, role: "authenticated" }), opts.opId ?? randomUUID(), opts.asOfDate ?? ""],
    );
    // Fecha de negocio en la zona horaria de la empresa (current_date, app.today()).
    await client.query("select set_config('TimeZone', $1, true)", [process.env.MH_TIMEZONE ?? "America/Asuncion"]);
    await client.query("set local role authenticated");
    const result = await fn(makeDb(client));
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    const mapped = toDomainError(err);
    if (mapped.code === "INTERNAL") console.error("[motor-haus] error de base de datos:", (err as Error).message);
    throw mapped;
  }
  });
}

/** Solo autenticación local de desarrollo: verifica credenciales contra auth.users. */
export async function verifyLocalPassword(email: string, password: string): Promise<string | null> {
  const driver = await getDriver();
  return driver.withConnection(async (c) => {
    const r = await c.query<{ id: string | null }>("select auth_local.verify_password($1, $2) as id", [email, password]);
    return r.rows[0]?.id ?? null;
  });
}

/** Cierra las conexiones (scripts y pruebas). */
export async function closePool(): Promise<void> {
  await closeDriver();
}
