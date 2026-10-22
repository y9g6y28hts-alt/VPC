"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { authMode, createLocalSession, destroySession, supabaseServerClient } from "@/server/session";
import { verifyLocalPassword } from "@/server/db";
import type { ActionState } from "@/server/action";
import { DEMO_PASSWORD, DEMO_USERS, demoLoginEnabled } from "@/server/demo";

const schema = z.object({ email: z.string().trim().email("Correo inválido"), password: z.string().min(1, "Ingrese la contraseña") });

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, at: Date.now() };
  const { email, password } = parsed.data;
  try {
    if ((await authMode()) === "supabase") {
      const sb = await supabaseServerClient();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: "Credenciales inválidas.", at: Date.now() };
    } else {
      const id = await verifyLocalPassword(email, password);
      if (!id) return { ok: false, error: "Credenciales inválidas.", at: Date.now() };
      await createLocalSession({ sub: id, email: email.toLowerCase() });
    }
  } catch (e) {
    console.error("[motor-haus] login:", e);
    return { ok: false, error: "No fue posible iniciar sesión. Verifique la configuración del servidor.", at: Date.now() };
  }
  redirect("/");
}

/** Entrada con un usuario de demostración (un toque). Verifica igualmente la contraseña en la base. */
export async function demoLoginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = DEMO_USERS.find((u) => u.key === fd.get("demo"));
  try {
    if ((await authMode()) !== "local" || !demoLoginEnabled() || !user) {
      return { ok: false, error: "El acceso de demostración no está disponible.", at: Date.now() };
    }
    const id = await verifyLocalPassword(user.email, DEMO_PASSWORD);
    if (!id) return { ok: false, error: "El usuario de demostración no existe en esta base.", at: Date.now() };
    await createLocalSession({ sub: id, email: user.email });
  } catch (e) {
    console.error("[motor-haus] demo login:", e);
    return { ok: false, error: "No fue posible iniciar la demostración. Intente nuevamente.", at: Date.now() };
  }
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
