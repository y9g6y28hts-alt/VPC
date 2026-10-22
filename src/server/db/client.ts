/**
 * Acceso a PostgreSQL desde el servidor.
 *
 * Toda operación iniciada por un usuario se ejecuta dentro de una transacción
 * con `SET LOCAL ROLE authenticated` y los claims del JWT de Supabase en
 * `request.jwt.claims`, exactamente como lo hace la API de datos de Supabase.
 * Así, las políticas RLS y `auth.uid()` aplican igual que en producción, y las
 * funciones transaccionales verifican permisos con la identidad real.
 *
 * DATABASE_URL debe apuntar al pooler de Supabase en modo transacción
 * (puerto 6543) o a la conexión directa. Sólo se usa en el servidor.
 */
import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

const DATE_OID = 1082;

/** Hosts remotos (Supabase) exigen TLS salvo que la URL indique sslmode. */
function sslFor(url: string): false | "require" | undefined {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode")) return undefined;
    return ["localhost", "127.0.0.1", "::1"].includes(u.hostname) ? false : "require";
  } catch {
    return undefined;
  }
}

export function createSql(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    ssl: sslFor(url),
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // El pooler de Supabase en modo transacción no admite sentencias preparadas.
    prepare: false,
    // Las fechas calendario se mantienen como "YYYY-MM-DD" (sin zona horaria).
    types: {
      date: {
        to: DATE_OID,
        from: [DATE_OID],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
    transform: { undefined: null },
    onnotice: () => {},
  });
}

const globalForSql = globalThis as unknown as { __dasilvaSql?: Promise<Sql> };

/**
 * Sin DATABASE_URL la aplicación funciona como demo autónoma: una base
 * PostgreSQL embebida (PGlite, en memoria) con las mismas migraciones y los
 * datos de demostración. Los cambios se pierden al reiniciar el servidor.
 */
export function isEmbeddedDemo(): boolean {
  return !process.env.DATABASE_URL;
}

export function getSql(): Promise<Sql> {
  if (!globalForSql.__dasilvaSql) {
    const url = process.env.DATABASE_URL;
    globalForSql.__dasilvaSql = url
      ? Promise.resolve(createSql(url))
      : import("@/server/demo/embedded").then((m) => m.startEmbeddedDemo()).catch((err) => {
          globalForSql.__dasilvaSql = undefined;
          throw err;
        });
  }
  return globalForSql.__dasilvaSql;
}

export interface DbIdentity {
  userId: string;
  email?: string | null;
}

/** Ejecuta `fn` como el usuario autenticado (RLS activo). */
export async function withUser<T>(identity: DbIdentity, fn: (tx: Tx) => Promise<T>, sqlArg?: Sql): Promise<T> {
  const sql = sqlArg ?? (await getSql());
  const claims = JSON.stringify({ sub: identity.userId, email: identity.email ?? null, role: "authenticated" });
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${identity.userId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  });
  return result as T;
}
