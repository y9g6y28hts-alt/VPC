// Errores de dominio. Las funciones SQL emiten 'MH_<CLASE>: mensaje'.
export type DomainErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "STATE" | "UNAUTHENTICATED" | "INTERNAL";

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string, public readonly detail?: string) {
    super(message);
    this.name = "DomainError";
  }
}

interface PgLikeError { code?: string; message?: string; detail?: string; constraint?: string }

const CONSTRAINT_MESSAGES: Record<string, string> = {
  reservations_one_active_idx: "La unidad ya tiene una reserva activa.",
  unit_identifiers_unique_idx: "Ya existe una unidad con ese identificador.",
  customers_document_unique_idx: "Ya existe un cliente con ese documento.",
  customer_payments_reference_idx: "Ya existe un pago con esa referencia en la cuenta.",
};

export function toDomainError(err: unknown): DomainError {
  if (err instanceof DomainError) return err;
  const e = (err ?? {}) as PgLikeError;
  const msg = e.message ?? "Error inesperado";
  const m = /^MH_([A-Z_]+):\s*(.*)$/s.exec(msg);
  if (m) {
    const code = (["FORBIDDEN", "NOT_FOUND", "CONFLICT", "VALIDATION", "STATE"].includes(m[1]) ? m[1] : "INTERNAL") as DomainErrorCode;
    return new DomainError(code, m[2]);
  }
  switch (e.code) {
    case "42501":
      return new DomainError("FORBIDDEN", "No tiene permiso para realizar esta operación.");
    case "23505":
      return new DomainError("CONFLICT", (e.constraint && CONSTRAINT_MESSAGES[e.constraint]) ?? "El registro ya existe.", e.detail);
    case "23514":
    case "23502":
    case "22P02":
    case "22007":
    case "22003":
      return new DomainError("VALIDATION", "Datos inválidos: revise los campos del formulario.", msg);
    case "23503":
      return new DomainError("VALIDATION", "Referencia inválida a otro registro.", msg);
    case "40001":
    case "40P01":
      return new DomainError("CONFLICT", "Otra operación modificó los mismos datos. Intente nuevamente.");
    default:
      return new DomainError("INTERNAL", "Error interno. La operación no se completó.", msg);
  }
}
