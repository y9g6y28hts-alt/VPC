"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, type ActionState } from "@/lib/action-state";
import { supabaseServer } from "@/server/supabase";
import { ORG_COOKIE, getContext } from "./context";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Ingrese un correo válido"),
  password: z.string().min(1, "Ingrese su contraseña"),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return fail("Revise los datos.", { fieldErrors });
  }
  const unavailable = "No se pudo contactar el servicio de autenticación. Revise la configuración en /estado.";
  let error: { status?: number } | null;
  try {
    const supabase = await supabaseServer();
    ({ error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password }));
  } catch {
    return fail(unavailable);
  }
  if (error) {
    if (error.status === 429) return fail("Demasiados intentos. Espere unos minutos y vuelva a intentar.");
    // Credenciales rechazadas: mensaje genérico que no revela si el correo existe.
    if (error.status && error.status >= 400 && error.status < 500) return fail("Correo o contraseña incorrectos.");
    return fail(unavailable);
  }
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/";
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  (await cookies()).delete(ORG_COOKIE);
  redirect("/ingresar");
}

export async function switchOrg(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const orgId = String(formData.get("orgId") ?? "");
  if (!ctx || !ctx.orgs.some((o) => o.id === orgId)) redirect("/");
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}
