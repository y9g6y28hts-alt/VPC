#!/usr/bin/env node
// =============================================================================
// SÓLO DESARROLLO LOCAL. Ejecuta Supabase Auth (GoTrue) y una pasarela HTTP que
// expone /auth/v1 como lo hace Supabase, para que la app use el mismo cliente
// (@supabase/ssr) en local y en producción.
//
//   GOTRUE_BIN=.dev/gotrue npm run auth:dev
//
// Storage y la API de datos no se emulan: la app accede a PostgreSQL de forma
// directa (DATABASE_URL) y, en local, guarda archivos en storage-local/.
// =============================================================================
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { existsSync } from "node:fs";
import { DEV_AUTH_PORT, DEV_GATEWAY_PORT, DEV_JWT_SECRET } from "./dev-env.mjs";

const bin = process.env.GOTRUE_BIN ?? ".dev/gotrue";
if (!existsSync(bin)) {
  console.error(`No se encontró el binario de Supabase Auth en ${bin}. Ver docs/DESARROLLO.md.`);
  process.exit(1);
}
const dbName = process.env.DB_NAME ?? "dasilva_dev";

const gotrue = spawn(bin, ["serve"], {
  stdio: "inherit",
  env: {
    ...process.env,
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: `postgres://supabase_auth_admin:auth_dev_only@127.0.0.1:5432/${dbName}`,
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:auth_dev_only@127.0.0.1:5432/${dbName}`,
    GOTRUE_SITE_URL: "http://localhost:3000",
    API_EXTERNAL_URL: `http://localhost:${DEV_GATEWAY_PORT}/auth/v1`,
    GOTRUE_API_HOST: "127.0.0.1",
    PORT: String(DEV_AUTH_PORT),
    GOTRUE_JWT_SECRET: DEV_JWT_SECRET,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "true",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_LOG_LEVEL: "warn",
    DB_NAMESPACE: "auth",
  },
});

const gateway = createServer((req, res) => {
  if (!req.url?.startsWith("/auth/v1")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Sólo /auth/v1 está disponible en la pasarela local" }));
    return;
  }
  const upstream = request(
    { host: "127.0.0.1", port: DEV_AUTH_PORT, method: req.method, path: req.url.slice("/auth/v1".length) || "/", headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (e) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `Supabase Auth no responde: ${e.message}` }));
  });
  req.pipe(upstream);
});
gateway.listen(DEV_GATEWAY_PORT, "127.0.0.1", () => {
  console.log(`Pasarela de Supabase Auth local: http://localhost:${DEV_GATEWAY_PORT}/auth/v1`);
});

const stop = () => {
  gateway.close();
  gotrue.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
gotrue.on("exit", (code) => {
  console.error(`Supabase Auth terminó (código ${code})`);
  gateway.close();
  process.exit(code ?? 1);
});
