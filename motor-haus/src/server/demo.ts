import "server-only";
import { isEmbedded } from "./driver";

// Acceso de demostración: usuarios ficticios del seed. Solo se ofrece cuando la
// base es la de demostración embebida, fuera de producción, o con MH_DEMO_LOGIN=true.
export const DEMO_PASSWORD = process.env.MH_DEMO_PASSWORD ?? "MotorHaus-Demo-2026";

export const DEMO_USERS = [
  { key: "ceo", email: "direccion@motorhaus.demo", label: "Director general", hint: "Visión completa y aprobaciones" },
  { key: "cfo", email: "finanzas@motorhaus.demo", label: "Directora financiera", hint: "Cobranzas, tesorería, formalización" },
  { key: "sales_manager", email: "comercial@motorhaus.demo", label: "Gerente comercial", hint: "Precios y autorizaciones" },
  { key: "advisor", email: "asesor1@motorhaus.demo", label: "Asesora de ventas", hint: "Mesa de negociación" },
  { key: "collections", email: "cobranzas@motorhaus.demo", label: "Cobranzas", hint: "Cartera y pagos" },
  { key: "inventory", email: "inventario@motorhaus.demo", label: "Inventario", hint: "Unidades, costes y preparación" },
  { key: "auditor", email: "auditor@motorhaus.demo", label: "Auditor", hint: "Solo lectura" },
] as const;

export function demoLoginEnabled(): boolean {
  return isEmbedded() || process.env.NODE_ENV !== "production" || process.env.MH_DEMO_LOGIN === "true";
}
