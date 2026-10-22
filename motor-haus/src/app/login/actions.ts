"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { authMode, createLocalSession, destroySession, supabaseServerClient } from "@/server/session";
import { verifyLocalPassword } from "@/server/db";
import type { ActionState } from "@/server/action";

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
  return { ok: true, message: "Ingresando…", redirectTo: "/", at: Date.now() };
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
