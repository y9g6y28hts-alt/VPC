/**
 * Traduce errores de PostgreSQL a mensajes comprensibles. Los errores de
 * negocio de las funciones transaccionales (SQLSTATE P0001) ya vienen en
 * español y se muestran tal cual.
 */
export interface FriendlyError {
  message: string;
  code?: string;
  duplicate?: boolean;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  customers_doc_uq: "Ya existe un cliente con ese documento.",
  vehicles_vin_uq: "Ya existe una unidad con ese VIN / chasis.",
  vehicles_org_id_stock_code_key: "Ya existe una unidad con ese código interno.",
  suppliers_tax_id_uq: "Ya existe un proveedor con ese RUC.",
  supplier_invoices_org_id_supplier_id_invoice_number_key: "Esa factura ya está registrada para el proveedor.",
  reservations_active_vehicle_uq: "La unidad ya tiene una reserva activa.",
  deals_vehicle_sold_uq: "La unidad ya tiene una venta formalizada.",
  approvals_pending_uq: "Ya hay una solicitud pendiente para esta operación.",
  brands_org_id_name_key: "Ya existe una marca con ese nombre.",
  exchange_rates_org_id_rate_date_from_currency_to_currency_key: "Ya hay un tipo de cambio registrado para esa fecha.",
  cash_accounts_org_id_name_key: "Ya existe una cuenta con ese nombre.",
};

export function toFriendlyError(err: unknown): FriendlyError {
  const e = err as { code?: string; message?: string; constraint_name?: string; hint?: string };
  const code = e?.code;
  if (code === "P0001") return { message: e.message ?? "Operación no válida", code, duplicate: e.hint === "duplicate" };
  if (code === "42501") {
    const detail = /\(([a-z_.]+)\)/.exec(e.message ?? "")?.[1];
    return { message: detail ? `No tiene permiso para esta operación (${detail}).` : "No tiene permiso para esta operación.", code };
  }
  if (code === "23505") {
    return { message: CONSTRAINT_MESSAGES[e.constraint_name ?? ""] ?? "El registro ya existe.", code };
  }
  if (code === "23503") return { message: "La referencia indicada no existe o no pertenece a su organización.", code };
  if (code === "23514") return { message: e.message?.startsWith("Aplicación inválida") ? e.message : "Algún dato no cumple las reglas de validación.", code };
  if (code === "55000") return { message: e.message ?? "El registro no se puede modificar.", code };
  if (code === "22P02" || code === "22007" || code === "22008") return { message: "Hay datos con formato inválido.", code };
  if (code === "28000") return { message: "La sesión no es válida. Ingrese nuevamente.", code };
  console.error("[db]", err);
  return { message: "Ocurrió un error inesperado. Si persiste, informe al administrador técnico.", code };
}
