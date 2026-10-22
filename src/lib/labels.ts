/** Etiquetas en español de los estados y catálogos almacenados en la base. */
import type { StatusTone } from "@/components/ui/status";

type Catalog = Record<string, { label: string; tone: StatusTone }>;

export const COMMERCIAL_STATUS: Catalog = {
  disponible: { label: "Disponible", tone: "positive" },
  reservado: { label: "Reservado", tone: "warning" },
  vendido_pendiente_entrega: { label: "Vendido, pendiente de entrega", tone: "info" },
  entregado: { label: "Entregado", tone: "neutral" },
  retirado: { label: "Retirado", tone: "neutral" },
};

export const PHYSICAL_STATUS: Catalog = {
  en_transito: { label: "En tránsito", tone: "info" },
  recibido: { label: "Recibido", tone: "neutral" },
  en_preparacion: { label: "En preparación", tone: "warning" },
  en_reparacion: { label: "En reparación", tone: "warning" },
  listo: { label: "Listo", tone: "positive" },
};

export const CONTRACT_STATUS_VEHICLE: Catalog = {
  sin_contrato: { label: "Sin contrato", tone: "neutral" },
  reservado: { label: "Reserva activa", tone: "warning" },
  contrato_firmado: { label: "Contrato firmado", tone: "info" },
  cancelado: { label: "Cancelado", tone: "neutral" },
};

export const PREP_STATUS: Catalog = {
  pendiente: { label: "Pendiente", tone: "warning" },
  en_proceso: { label: "En proceso", tone: "info" },
  completa: { label: "Completa", tone: "positive" },
  no_aplica: { label: "No aplica", tone: "neutral" },
};

export const DOC_STATUS: Catalog = {
  incompleta: { label: "Incompleta", tone: "critical" },
  en_tramite: { label: "En trámite", tone: "warning" },
  completa: { label: "Completa", tone: "positive" },
};

export const DEAL_STATUS: Catalog = {
  borrador: { label: "Borrador", tone: "neutral" },
  pendiente_aprobacion: { label: "Pendiente de aprobación", tone: "warning" },
  aprobada: { label: "Aprobada", tone: "info" },
  formalizada: { label: "Formalizada", tone: "positive" },
  entregada: { label: "Entregada", tone: "neutral" },
  anulada: { label: "Anulada", tone: "critical" },
};

export const CONTRACT_STATUS: Catalog = {
  vigente: { label: "Vigente", tone: "info" },
  saldado: { label: "Saldado", tone: "positive" },
  anulado: { label: "Anulado", tone: "neutral" },
};

export const PAYMENT_STATUS: Catalog = {
  registrado: { label: "Registrado (sin confirmar)", tone: "warning" },
  confirmado: { label: "Confirmado", tone: "positive" },
  revertido: { label: "Revertido", tone: "critical" },
  anulado: { label: "Anulado", tone: "neutral" },
};

export const INSTALLMENT_STATE: Catalog = {
  pendiente: { label: "Pendiente", tone: "neutral" },
  parcial: { label: "Pago parcial", tone: "warning" },
  pagada: { label: "Pagada", tone: "positive" },
  reemplazada: { label: "Reemplazada", tone: "neutral" },
};

export const APPROVAL_STATUS: Catalog = {
  pendiente: { label: "Pendiente", tone: "warning" },
  aprobada: { label: "Aprobada", tone: "positive" },
  rechazada: { label: "Rechazada", tone: "critical" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export const TRADEIN_STATUS: Catalog = {
  borrador: { label: "Borrador", tone: "neutral" },
  en_revision: { label: "En revisión", tone: "warning" },
  aprobada: { label: "Aprobada", tone: "info" },
  rechazada: { label: "Rechazada", tone: "critical" },
  aceptada_cliente: { label: "Aceptada por el cliente", tone: "info" },
  adquirida: { label: "Adquirida", tone: "positive" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export const INVOICE_STATUS: Catalog = {
  pendiente_aprobacion: { label: "Pendiente de aprobación", tone: "warning" },
  aprobada: { label: "Aprobada", tone: "info" },
  rechazada: { label: "Rechazada", tone: "critical" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export const EXPENSE_STATUS: Catalog = {
  pendiente_aprobacion: { label: "Pendiente de aprobación", tone: "warning" },
  aprobado: { label: "Aprobado, sin pagar", tone: "info" },
  rechazado: { label: "Rechazado", tone: "critical" },
  pagado: { label: "Pagado", tone: "positive" },
  anulado: { label: "Anulado", tone: "neutral" },
};

export const RESERVATION_STATUS: Catalog = {
  activa: { label: "Activa", tone: "warning" },
  convertida: { label: "Convertida en venta", tone: "positive" },
  vencida: { label: "Vencida", tone: "neutral" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export const PROMISE_STATUS: Catalog = {
  pendiente: { label: "Pendiente", tone: "info" },
  cumplida: { label: "Cumplida", tone: "positive" },
  incumplida: { label: "Incumplida", tone: "critical" },
};

export const MOVEMENT_STATUS: Catalog = {
  registrado: { label: "Registrado", tone: "neutral" },
  conciliado: { label: "Conciliado", tone: "positive" },
};

export const FUEL: Record<string, string> = {
  nafta: "Nafta", diesel: "Diésel", hibrido: "Híbrido", hibrido_enchufable: "Híbrido enchufable",
  electrico: "Eléctrico", gnc: "GNC", otro: "Otro",
};
export const TRANSMISSION: Record<string, string> = {
  manual: "Manual", automatica: "Automática", cvt: "CVT", dct: "Doble embrague", otra: "Otra",
};
export const ORIGIN: Record<string, string> = {
  importacion: "Importación", compra_local: "Compra local", trade_in: "Trade-in", consignacion: "Consignación",
};
export const COST_KIND: Record<string, string> = {
  adquisicion: "Adquisición", transporte: "Transporte", importacion: "Importación / despacho", reparacion: "Reparación",
  preparacion: "Preparación", documentacion: "Documentación", comision: "Comisión", otro: "Otro",
};
export const PAYMENT_METHOD: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", deposito: "Depósito", cheque: "Cheque", tarjeta: "Tarjeta",
  trade_in: "Vehículo usado (trade-in)", nota_credito: "Nota de crédito",
};
export const INSTALLMENT_KIND: Record<string, string> = {
  entrega_usado: "Entrega en usado", entrega_inicial: "Entrega inicial", cuota: "Cuota", refuerzo: "Refuerzo", recargo: "Recargo",
};
export const LEDGER_KIND: Record<string, string> = {
  cuota_generada: "Obligación generada", recargo: "Recargo autorizado", pago: "Pago aplicado", nota_credito: "Nota de crédito",
  reversion_pago: "Reversión de pago", baja_refinanciacion: "Baja por refinanciación / anulación",
};
export const CHANNEL: Record<string, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", visita: "Visita", email: "Correo", sms: "SMS", nota: "Nota", otro: "Otro",
};
export const COLLECTION_RESULT: Record<string, string> = {
  contactado: "Contactado", sin_respuesta: "Sin respuesta", numero_erroneo: "Número erróneo", promesa_pago: "Promesa de pago",
  pago_informado: "Pago informado", negativa: "Negativa a pagar", otro: "Otro",
};
export const APPROVAL_KIND: Record<string, string> = {
  descuento: "Descuento", precio_bajo_minimo: "Precio bajo mínimo", recargo: "Recargo", nota_credito: "Nota de crédito",
  ajuste: "Ajuste", refinanciacion: "Refinanciación", tasacion: "Tasación", factura_proveedor: "Factura de proveedor", gasto: "Gasto",
};
export const EXPENSE_CATEGORY: Record<string, string> = {
  alquiler: "Alquiler", servicios: "Servicios", sueldos: "Sueldos", comisiones: "Comisiones", marketing: "Marketing",
  impuestos: "Impuestos", mantenimiento: "Mantenimiento", combustible: "Combustible", oficina: "Oficina", otro: "Otro",
};
export const INVOICE_CATEGORY: Record<string, string> = {
  vehiculo: "Compra de vehículo", transporte: "Transporte", reparacion: "Reparación", documentacion: "Documentación", general: "General",
};
export const SUPPLIER_KIND: Record<string, string> = {
  vehiculos: "Vehículos", transporte: "Transporte", reparacion: "Reparación", documentacion: "Documentación", general: "General",
};
export const DOC_TYPE: Record<string, string> = { ci: "C.I.", ruc: "RUC", pasaporte: "Pasaporte", otro: "Otro" };
export const INSPECTION_AREA: Record<string, string> = {
  mecanica: "Mecánica", carroceria: "Carrocería", neumaticos: "Neumáticos", interior: "Interior",
  electronica: "Electrónica", documentacion: "Documentación", otro: "Otro",
};
export const INSPECTION_RATING: Record<string, string> = { bueno: "Bueno", regular: "Regular", malo: "Malo", no_evaluado: "No evaluado" };
export const TRADEIN_DOC_STATUS: Record<string, string> = {
  sin_revisar: "Sin revisar", completa: "Completa", observada: "Observada", con_gravamen: "Con gravamen / prenda",
};
export const CASH_KIND: Record<string, string> = {
  cobro_cliente: "Cobro de cliente", pago_proveedor: "Pago a proveedor", gasto: "Gasto", transferencia: "Transferencia",
  ajuste: "Ajuste", apertura: "Saldo inicial", reversion: "Reversión", otro: "Otro",
};

export function labelOf(catalog: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return catalog[key] ?? key;
}
