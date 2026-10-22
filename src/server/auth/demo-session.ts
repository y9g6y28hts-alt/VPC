import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Sesión de la demo autónoma (sin Supabase Auth): el visitante elige un
 * usuario de demostración y se guarda su id en una cookie firmada. Sólo se
 * usa cuando no hay DATABASE_URL (ver isEmbeddedDemo).
 */
export const DEMO_COOKIE = "ds_demo_user";
const SECRET = process.env.DEMO_SESSION_SECRET ?? "da-silva-os-demo";

const sign = (id: string) => createHmac("sha256", SECRET).update(id).digest("base64url");

/** Id estable a partir del correo: la sesión sigue válida aunque el servidor reinicie la demo. */
export function demoUserId(email: string): string {
  const h = createHash("sha256").update(`dasilva-demo:${email.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function readDemoSession(): Promise<string | null> {
  const raw = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  if (!id || !mac) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export async function writeDemoSession(userId: string): Promise<void> {
  (await cookies()).set(DEMO_COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearDemoSession(): Promise<void> {
  (await cookies()).delete(DEMO_COOKIE);
}
