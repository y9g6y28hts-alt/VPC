/**
 * Demo autónoma: PostgreSQL embebido (PGlite, WebAssembly) dentro del propio
 * servidor. Se aplican las mismas migraciones que en producción (RLS,
 * funciones, auditoría) y se cargan los datos de demostración. Vive en
 * memoria: al reiniciarse el servidor, la demo vuelve a su estado inicial.
 */
import { createSql, type Sql } from "@/server/db/client";
import { demoUserId } from "@/server/auth/demo-session";
import { seedDemo } from "@/server/demo/seed";
import { AUTH_SHIM_SQL, BOOTSTRAP_SQL, MIGRATIONS } from "@/server/demo/sql-bundle.generated";

export async function startEmbeddedDemo(): Promise<Sql> {
  const started = Date.now();
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

  const db = await PGlite.create({ extensions: { pgcrypto, btree_gist } });
  // Servidor de protocolo PostgreSQL local: la app usa el mismo cliente (postgres.js) que en producción.
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await server.start();
  const port = (server as unknown as { port: number }).port;
  // PGlite es de una sola sesión: una conexión, las transacciones se serializan.
  const sql = createSql(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 });

  await sql.unsafe(BOOTSTRAP_SQL.replace("current_database_placeholder", "postgres"));
  await sql.unsafe(AUTH_SHIM_SQL);
  for (const m of MIGRATIONS) await sql.unsafe(m.sql);
  await seedDemo({
    admin: sql,
    app: sql,
    createAuthUser: async (email) => {
      const id = demoUserId(email);
      await sql`insert into auth.users (id, email) values (${id}, ${email})`;
      return id;
    },
  });
  console.log(`[demo] base embebida lista en ${Date.now() - started} ms`);
  return sql;
}
