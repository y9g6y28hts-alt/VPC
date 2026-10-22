import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { actionContext, AppContext } from "./context";
import { Db, withUser } from "./gateway";
import { DomainError, toDomainError } from "./errors";

export interface ActionState {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  redirectTo?: string;
  /** Marca de tiempo para que el cliente distinga respuestas sucesivas. */
  at?: number;
}

export const initialState: ActionState = { ok: false };

/**
 * Ejecuta una server action: valida la entrada con zod, abre la transacción
 * del usuario (RLS) y traduce errores de dominio a mensajes legibles.
 */
export async function runAction<S extends z.ZodType>(
  schema: S,
  formData: FormData,
  fn: (input: z.infer<S>, db: Db, ctx: AppContext) => Promise<Omit<ActionState, "ok"> | void>,
): Promise<ActionState> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$ACTION")) continue;
    raw[k] = typeof v === "string" ? v : v;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "_")] ??= issue.message;
    return { ok: false, error: "Revise los campos marcados.", fieldErrors, at: Date.now() };
  }
  let state: ActionState;
  try {
    const ctx = await actionContext();
    const result = await withUser(ctx.claims, (db) => fn(parsed.data, db, ctx), { opId: randomUUID() });
    state = { ok: true, message: "Operación registrada.", ...(result ?? {}), at: Date.now() };
  } catch (e) {
    const err = e instanceof DomainError ? e : toDomainError(e);
    if (err.code === "INTERNAL") console.error("[motor-haus] acción fallida:", err.detail ?? err.message);
    return { ok: false, error: err.message, at: Date.now() };
  }
  // La navegación ocurre después del commit y fuera del try (redirect lanza una señal de control).
  if (state.redirectTo) redirect(state.redirectTo);
  return state;
}

// Validadores reutilizables para formularios
export const zText = (min = 1, msg = "Campo obligatorio") => z.string().trim().min(min, msg);
export const zOptText = z.string().trim().optional().transform((v) => (v ? v : null));
export const zUuid = z.string().uuid("Selección inválida");
export const zOptUuid = z.string().optional().transform((v) => (v ? v : null)).pipe(z.string().uuid().nullable());
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const zOptDate = z.string().optional().transform((v) => (v ? v : null)).pipe(zDate.nullable());
/** Importe decimal con punto, sin separadores de miles (se aceptan y eliminan espacios). */
export const zAmount = z.string().trim().transform((v) => v.replace(/\s/g, "").replace(/,/g, "."))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido (use punto decimal, sin separadores de miles)"));
export const zOptAmount = z.string().optional().transform((v) => (v && v.trim() ? v.trim().replace(/,/g, ".") : "0"))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Importe inválido"));
export const zInt = (min: number, max: number) => z.coerce.number().int("Debe ser entero").min(min).max(max);
