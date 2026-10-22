/**
 * Alta inicial de la organización real y de su primer director.
 * Se ejecuta una sola vez al poner el sistema en producción; a partir de ahí
 * los usuarios se gestionan desde Configuración → Usuarios.
 *
 *   ORG_NAME="Da Silva Automotores" \
 *   ORG_LEGAL_NAME="<razón social>" ORG_TAX_ID="<RUC>" \
 *   DIRECTOR_EMAIL="<correo>" DIRECTOR_NAME="<nombre completo>" \
 *   npx tsx scripts/create-org.ts
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y una conexión
 * con el propietario de las tablas (DATABASE_ADMIN_URL o, en Supabase, la
 * DATABASE_URL del usuario postgres). La contraseña inicial se genera al azar,
 * se muestra una vez y el director debe cambiarla en «Mi cuenta».
 * No crea datos de negocio: cuentas, unidades y clientes se cargan desde la app.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Falta la variable ${k}`);
  return v;
};

async function main() {
  const orgName = need("ORG_NAME");
  const email = need("DIRECTOR_EMAIL").toLowerCase();
  const fullName = need("DIRECTOR_NAME");
  const baseCurrency = process.env.ORG_BASE_CURRENCY === "USD" ? "USD" : "PYG";
  const brands = (process.env.ORG_BRANDS ?? "Range Rover,Ford,Changan").split(",").map((b) => b.trim()).filter(Boolean);

  const supabase = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sql = postgres(process.env.DATABASE_ADMIN_URL ?? need("DATABASE_URL"), { max: 1, prepare: false, onnotice: () => {} });

  try {
    const [existing] = await sql<{ n: number }[]>`select count(*)::int as n from public.organizations where not is_demo and name = ${orgName}`;
    if (existing!.n > 0) throw new Error(`Ya existe una organización llamada «${orgName}»`);

    const password = randomBytes(12).toString("base64url");
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error || !data.user) throw new Error(`No se pudo crear la cuenta: ${error?.message}`);
    const userId = data.user.id;

    try {
      await sql.begin(async (tx) => {
        const [org] = await tx<{ id: string }[]>`
          insert into public.organizations (name, legal_name, tax_id, base_currency, is_demo)
          values (${orgName}, ${process.env.ORG_LEGAL_NAME ?? null}, ${process.env.ORG_TAX_ID ?? null}, ${baseCurrency}, false)
          returning id`;
        await tx`insert into public.user_profiles (id, full_name) values (${userId}, ${fullName}) on conflict (id) do nothing`;
        await tx`insert into public.memberships (org_id, user_id, role) values (${org!.id}, ${userId}, 'director')`;
        for (const [i, b] of brands.entries()) {
          await tx`insert into public.brands (org_id, name, sort_order) values (${org!.id}, ${b}, ${i + 1})`;
        }
        console.log(`Organización creada: ${orgName} (${org!.id})`);
      });
    } catch (e) {
      await supabase.auth.admin.deleteUser(userId);
      throw e;
    }
    console.log(`Director: ${email}`);
    console.log(`Contraseña inicial (se muestra una sola vez): ${password}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
