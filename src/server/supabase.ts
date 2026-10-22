import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { ConfigError, serverEnv } from "./env";

/** Cliente de Supabase con la sesión del usuario (cookies). */
export async function supabaseServer() {
  // Primero las cookies: marca la ruta como dinámica antes de cualquier validación de entorno.
  const store = await cookies();
  const env = serverEnv();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Llamado desde un Server Component: el proxy renueva las cookies.
        }
      },
    },
  });
}

/**
 * Cliente administrativo (service role). Sólo para acciones que la API de
 * usuario no permite, como invitar usuarios. Requiere SUPABASE_SERVICE_ROLE_KEY.
 */
export function supabaseAdmin() {
  const env = serverEnv();
  if (!env.serviceRoleKey) {
    throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY no está configurada: no se pueden administrar usuarios.");
  }
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
