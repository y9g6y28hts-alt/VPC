/**
 * Modo de funcionamiento. La aplicación es una demo autónoma (base embebida,
 * ingreso por rol) salvo que estén configuradas, con valor, las tres
 * variables de una instalación real. DEMO_MODE=1 fuerza la demo.
 * Sin dependencias de Node: lo usan también el proxy y el servidor.
 */
const filled = (v: string | undefined) => !!v && v.trim().length > 0;

export function isEmbeddedDemo(): boolean {
  const forced = process.env.DEMO_MODE?.trim().toLowerCase();
  if (forced === "1" || forced === "true") return true;
  return !(
    filled(process.env.DATABASE_URL) &&
    filled(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    filled(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}
