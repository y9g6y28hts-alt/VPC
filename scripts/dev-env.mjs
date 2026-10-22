// SÓLO DESARROLLO LOCAL: configuración y claves de prueba firmadas con un
// secreto local. Nunca usar estos valores en producción.
import { createHmac } from "node:crypto";

export const DEV_JWT_SECRET = process.env.DEV_JWT_SECRET ?? "dasilva-local-dev-only-secret-0123456789abcdef";
export const DEV_AUTH_PORT = Number(process.env.DEV_AUTH_PORT ?? 9999);
export const DEV_GATEWAY_PORT = Number(process.env.DEV_GATEWAY_PORT ?? 54321);

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function signJwt(payload, secret = DEV_JWT_SECRET) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const iat = 1767225600; // 2026-01-01
const exp = iat + 10 * 365 * 24 * 3600;
export const DEV_ANON_KEY = signJwt({ iss: "dasilva-local", role: "anon", iat, exp });
export const DEV_SERVICE_KEY = signJwt({ iss: "dasilva-local", role: "service_role", iat, exp });
