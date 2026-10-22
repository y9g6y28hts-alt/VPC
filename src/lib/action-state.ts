/** Resultado estándar de una acción de servidor, consumido por los formularios. */
export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Para avisar al usuario de un posible duplicado y pedir confirmación */
  needsConfirmation?: boolean;
  /** Identificador creado, si corresponde */
  id?: string;
  /** Marca de tiempo para que el cliente detecte respuestas nuevas */
  at?: number;
}

export const initialState: ActionState = { ok: false };

export function ok(message?: string, extra: Partial<ActionState> = {}): ActionState {
  return { ok: true, message, at: Date.now(), ...extra };
}

export function fail(message: string, extra: Partial<ActionState> = {}): ActionState {
  return { ok: false, message, at: Date.now(), ...extra };
}
