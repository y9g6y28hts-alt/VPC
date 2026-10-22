import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Claims } from "./gateway";
import { DomainError } from "./errors";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEMO_DB_DIR, getDriver, isEmbedded } from "./driver";

// -----------------------------------------------------------------------------
// Autenticación
//  · supabase: Supabase Auth. La sesión se valida contra el servicio de Auth
//    (auth.getUser) en cada request; nunca se confía en un JWT sin verificar.
//  · local: credenciales en auth.users de la base local (solo desarrollo y
//    demostraciones). Cookie firmada con HMAC-SHA256, httpOnly, 8 horas.
// -----------------------------------------------------------------------------

const COOKIE = "mh_session";
const TTL_SECONDS = 8 * 60 * 60;

export type AuthMode = "supabase" | "local";

export async function authMode(): Promise<AuthMode> {
  const mode = (process.env.MH_AUTH_MODE ?? "local") as AuthMode;
  if (mode === "local") await getDriver().catch(() => undefined); // resuelve si la base es la embebida
  // La base embebida solo contiene datos de demostración: allí la autenticación local está permitida.
  if (mode === "local" && process.env.NODE_ENV === "production" && process.env.MH_ALLOW_LOCAL_AUTH !== "true" && !isEmbedded()) {
    throw new DomainError("INTERNAL", "La autenticación local está deshabilitada en producción. Configure MH_AUTH_MODE=supabase.");
  }
  return mode;
}

let buildSecret: string | undefined;
function secret(): Buffer {
  let s = process.env.MH_SESSION_SECRET ?? "";
  if (!s && isEmbedded()) {
    // Secreto aleatorio generado en el build de la base de demostración.
    buildSecret ??= readFileSync(path.join(DEMO_DB_DIR, "session-secret.txt"), "utf8").trim();
    s = buildSecret;
  }
  if (s.length < 32) throw new DomainError("INTERNAL", "MH_SESSION_SECRET debe tener al menos 32 caracteres.");
  return Buffer.from(s);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export async function createLocalSession(claims: Claims): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_SECONDS,
  });
}

function readLocal(token: string | undefined): Claims | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims & { exp: number };
    if (!data.sub || data.exp < Date.now() / 1000) return null;
    return { sub: data.sub, email: data.email };
  } catch {
    return null;
  }
}

export async function supabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new DomainError("INTERNAL", "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* render de servidor */ }
      },
    },
  });
}

export async function currentClaims(): Promise<Claims | null> {
  if ((await authMode()) === "supabase") {
    const sb = await supabaseServerClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return null;
    return { sub: data.user.id, email: data.user.email ?? "" };
  }
  const jar = await cookies();
  return readLocal(jar.get(COOKIE)?.value);
}

export async function destroySession(): Promise<void> {
  if ((await authMode()) === "supabase") {
    const sb = await supabaseServerClient();
    await sb.auth.signOut();
    return;
  }
  (await cookies()).delete(COOKIE);
}
