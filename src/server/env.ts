/**
 * Variables de entorno del servidor. Nunca se importan desde componentes
 * cliente: las claves privadas (DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * jamás llegan al navegador. Sólo NEXT_PUBLIC_* es público por diseño.
 */
export interface ServerEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  databaseUrl: string;
  serviceRoleKey: string | null;
  storageMode: "supabase" | "local";
}

export class ConfigError extends Error {}

export function serverEnv(): ServerEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !supabaseAnonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    !databaseUrl && "DATABASE_URL",
  ].filter(Boolean);
  if (missing.length) {
    throw new ConfigError(`Faltan variables de entorno: ${missing.join(", ")}. Ver .env.example y docs/DESARROLLO.md.`);
  }
  const storageMode = process.env.STORAGE_MODE === "local" ? "local" : "supabase";
  if (storageMode === "local" && process.env.NODE_ENV === "production") {
    throw new ConfigError("STORAGE_MODE=local no está permitido en producción.");
  }
  return {
    supabaseUrl: supabaseUrl!,
    supabaseAnonKey: supabaseAnonKey!,
    databaseUrl: databaseUrl!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    storageMode,
  };
}
