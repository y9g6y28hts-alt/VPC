import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { Permission } from "@/domain/permissions";
import { fail, type ActionState } from "@/lib/action-state";
import { getContext, type AppContext } from "@/server/auth/context";
import { toFriendlyError } from "@/server/errors";

/**
 * Envoltorio de toda acción de servidor: exige sesión y permisos, y traduce
 * los errores de base de datos a mensajes legibles. La base de datos vuelve a
 * verificar los permisos (RLS / funciones), por lo que esta comprobación es
 * para dar una respuesta temprana y clara.
 */
export async function guarded(perms: Permission[], fn: (ctx: AppContext) => Promise<ActionState>): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx) return fail("Su sesión expiró. Ingrese nuevamente.");
  if (perms.length && !ctx.perms.any(...perms)) return fail("No tiene permiso para esta operación.");
  try {
    return await fn(ctx);
  } catch (err) {
    unstable_rethrow(err);
    const f = toFriendlyError(err);
    return fail(f.message, { needsConfirmation: f.duplicate });
  }
}

/** Valida un FormData con zod y devuelve errores por campo en español. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { ok: true; data: z.infer<S> } | { ok: false; state: ActionState } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k in raw) {
      const prev = raw[k];
      raw[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      raw[k] = typeof v === "string" ? v.trim() : v;
    }
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, state: fail("Revise los datos marcados.", { fieldErrors }) };
}
