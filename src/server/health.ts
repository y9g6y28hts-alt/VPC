import "server-only";
import { createSql } from "@/server/db/client";
import { ConfigError } from "@/server/env";

/**
 * Diagnóstico de puesta en marcha. Sólo informa nombres de variables y
 * resultados (ok / falta / error tipificado); nunca valores ni secretos.
 */

export type CheckStatus = "ok" | "warning" | "error" | "skipped";

export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

const isProd = process.env.NODE_ENV === "production";

/** Errores que indican configuración incompleta (no fallas transitorias). */
export function isSetupError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string };
  if (err instanceof ConfigError) return true;
  return ["ENOTFOUND", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "28P01", "28000", "3D000", "42P01", "42883", "3F000"].includes(e?.code ?? "")
    || /DATABASE_URL|variables de entorno|Tenant or user not found/i.test(e?.message ?? "");
}

function dbErrorDetail(err: unknown): { detail: string; fix: string } {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "28P01" || /password authentication failed/i.test(msg)) {
    return { detail: "La base rechazó la contraseña.", fix: "Revise la contraseña dentro de DATABASE_URL (Supabase → Project Settings → Database → Reset password si no la recuerda)." };
  }
  if (/Tenant or user not found/i.test(msg)) {
    return { detail: "El pooler no reconoce el usuario/proyecto.", fix: "Copie de nuevo la cadena «Transaction pooler»: el usuario debe ser postgres.<ref-del-proyecto>." };
  }
  if (code === "ENOTFOUND" || code === "ENETUNREACH" || code === "EHOSTUNREACH") {
    return { detail: "No se encontró o no se alcanzó el servidor de base de datos.", fix: "Use la cadena «Transaction pooler» (puerto 6543, host *.pooler.supabase.com). La conexión directa db.<ref>.supabase.co sólo funciona por IPv6 y Vercel no la alcanza." };
  }
  if (code === "ECONNREFUSED") return { detail: "El servidor rechazó la conexión.", fix: "Verifique host y puerto (6543) en DATABASE_URL." };
  if (code === "3D000") return { detail: "La base de datos indicada no existe.", fix: "La cadena de Supabase termina en /postgres." };
  if (/timeout|timed out/i.test(msg) || code === "CONNECT_TIMEOUT") return { detail: "Tiempo de conexión agotado.", fix: "Verifique que el proyecto de Supabase no esté pausado y que el host sea el del pooler." };
  return { detail: `No se pudo conectar (${code || "error sin código"}).`, fix: "Copie nuevamente la cadena «Transaction pooler» desde Supabase." };
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const dbUrl = process.env.DATABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const storage = process.env.STORAGE_MODE;

  // 1. Variables
  const envCheck = (key: string, value: string | undefined, valid: boolean, fix: string): Check => ({
    key, label: key,
    status: !value ? "error" : valid ? "ok" : "error",
    detail: !value ? "No está definida." : valid ? "Definida." : "Definida, pero el formato no es válido.",
    fix: !value || !valid ? fix : undefined,
  });
  checks.push(envCheck("NEXT_PUBLIC_SUPABASE_URL", url, !!url && /^https?:\/\/[^/]+/.test(url),
    "Supabase → Project Settings → API → Project URL (https://<ref>.supabase.co). En Vercel: Settings → Environment Variables, y luego Redeploy."));
  checks.push(envCheck("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon, !!anon && anon.length > 30,
    "Supabase → Project Settings → API → clave anon / publishable."));
  const placeholder = !!dbUrl && /\[YOUR-PASSWORD\]|<password>|<proyecto>/i.test(dbUrl);
  checks.push(envCheck("DATABASE_URL", dbUrl, !!dbUrl && /^postgres(ql)?:\/\//.test(dbUrl) && !placeholder,
    placeholder ? "Reemplace [YOUR-PASSWORD] por la contraseña real de la base." : "Supabase → Connect → «Transaction pooler» (puerto 6543)."));
  checks.push({
    key: "SUPABASE_SERVICE_ROLE_KEY", label: "SUPABASE_SERVICE_ROLE_KEY",
    status: service ? "ok" : "warning",
    detail: service ? "Definida." : "No está definida: no se podrán crear usuarios desde Configuración.",
    fix: service ? undefined : "Supabase → Project Settings → API → clave service_role (secreta, sin prefijo NEXT_PUBLIC_).",
  });
  checks.push({
    key: "STORAGE_MODE", label: "STORAGE_MODE",
    status: storage === "local" && isProd ? "error" : "ok",
    detail: storage === "local" && isProd ? "«local» no está permitido en producción." : `Modo ${storage === "local" ? "local (desarrollo)" : "supabase"}.`,
    fix: storage === "local" && isProd ? "Defina STORAGE_MODE=supabase o elimine la variable." : undefined,
  });

  // 2. Supabase Auth
  if (url && anon) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: anon }, signal: AbortSignal.timeout(5000), cache: "no-store" });
      checks.push(res.ok
        ? { key: "auth", label: "Supabase Auth", status: "ok", detail: "Responde correctamente." }
        : { key: "auth", label: "Supabase Auth", status: "error", detail: `Respondió ${res.status}.`, fix: res.status === 401 ? "La clave anon no corresponde a este proyecto." : "Verifique la URL del proyecto y que no esté pausado." });
    } catch {
      checks.push({ key: "auth", label: "Supabase Auth", status: "error", detail: "No responde.", fix: "Verifique NEXT_PUBLIC_SUPABASE_URL y que el proyecto esté activo." });
    }
  } else {
    checks.push({ key: "auth", label: "Supabase Auth", status: "skipped", detail: "Falta la URL o la clave anon." });
  }

  // 3. Base de datos, migraciones y organización
  if (dbUrl && !placeholder) {
    const sql = createSql(dbUrl, { max: 1 });
    try {
      await sql`select 1`;
      checks.push({ key: "db", label: "Conexión a la base de datos", status: "ok", detail: "Conecta correctamente." });
      const [m] = await sql<{ foundation: boolean; finance: boolean; rls: boolean; admin: boolean }[]>`
        select to_regclass('public.organizations') is not null as foundation,
               to_regclass('public.contract_ledger_entries') is not null as finance,
               exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vehicles') as rls,
               to_regprocedure('public.rpc_member_add(uuid,uuid,text,text)') is not null as admin`;
      const applied = m!.foundation && m!.finance && m!.rls && m!.admin;
      checks.push({
        key: "migrations", label: "Migraciones",
        status: applied ? "ok" : "error",
        detail: applied ? "Esquema, seguridad (RLS) y funciones instalados." : !m!.foundation ? "La base está vacía: no se aplicaron las migraciones." : "Migraciones incompletas.",
        fix: applied ? undefined : "Aplique en orden todos los archivos de supabase/migrations/ (supabase db push, o pegándolos en el SQL Editor).",
      });
      if (applied) {
        const [o] = await sql<{ real: number; members: number }[]>`
          select count(*) filter (where not is_demo)::int as real,
                 (select count(*)::int from public.memberships m join public.organizations o on o.id = m.org_id where not o.is_demo and m.is_active) as members
          from public.organizations`;
        checks.push(o!.real > 0
          ? { key: "org", label: "Organización", status: o!.members > 0 ? "ok" : "error", detail: o!.members > 0 ? "Creada, con usuarios activos." : "Creada, pero sin usuarios activos.", fix: o!.members > 0 ? undefined : "Asigne un director con npm run org:create o desde la base." }
          : { key: "org", label: "Organización", status: "error", detail: "Todavía no existe la organización ni su director.", fix: "Ejecute una vez npm run org:create (ver docs/DESPLIEGUE.md, paso 3)." });
      }
    } catch (err) {
      const { detail, fix } = dbErrorDetail(err);
      checks.push({ key: "db", label: "Conexión a la base de datos", status: "error", detail, fix });
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  } else {
    checks.push({ key: "db", label: "Conexión a la base de datos", status: "skipped", detail: "Falta DATABASE_URL válida." });
  }
  return checks;
}
