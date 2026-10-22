// Recrea la base de pruebas (dasilva_test) con todas las migraciones.
// Requiere PostgreSQL local; ver docs/DESARROLLO.md.
// @ts-expect-error módulo ESM sin tipos
import { resetDatabase } from "../../scripts/db-reset.mjs";

export default async function setup() {
  await resetDatabase({ name: "dasilva_test", demo: false, gotrue: undefined, quiet: true });
}
