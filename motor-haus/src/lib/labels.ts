// Etiquetas en español para valores de dominio. Un estado nunca se comunica
// solo con color: siempre lleva texto (y en chips, un icono).

export type Tone = "neutral" | "good" | "warn" | "risk" | "info" | "accent";

export const CATEGORY: Record<string, string> = {
  supercar: "Superauto", premium_suv: "SUV premium", sedan_gt: "Gran turismo", classic: "Clásico",
  motorcycle: "Motocicleta", boat: "Embarcación", other: "Otro",
};

export const DISPLAY_STATUS: Record<string, [string, Tone]> = {
  evaluation: ["En evaluación", "info"],
  rejected: ["Compra rechazada", "neutral"],
  purchase_approved: ["Compra aprobada", "info"],
  in_transit: ["En tránsito", "info"],
  in_customs: ["En aduana", "warn"],
  in_preparation: ["En preparación", "warn"],
  ready_not_listed: ["Lista, sin habilitar", "warn"],
  in_service: ["En servicio", "warn"],
  available: ["Disponible", "good"],
  reserved: ["Reservado", "accent"],
  sold_pending_delivery: ["Vendido · pend. entrega", "accent"],
  delivered: ["Entregado", "neutral"],
  retired: ["Retirado", "neutral"],
};

export const ACQUISITION: Record<string, string> = { evaluation: "En evaluación", approved: "Compra aprobada", acquired: "Adquirida", rejected: "Rechazada" };
export const LOGISTICS: Record<string, string> = { pending: "Pendiente de despacho", in_transit: "En tránsito", in_customs: "En aduana", received: "Recibida" };
export const PREPARATION: Record<string, string> = { not_started: "Sin iniciar", in_preparation: "En preparación", ready: "Lista", in_service: "En servicio" };
export const COMMERCIAL: Record<string, string> = {
  not_listed: "No habilitada", available: "Disponible", reserved: "Reservada", sold_pending_delivery: "Vendida, pend. entrega",
  delivered: "Entregada", retired: "Retirada",
};
export const DIMENSION: Record<string, string> = { acquisition: "Adquisición", logistics: "Logística", preparation: "Preparación", commercial: "Comercial" };

export const DEAL_STATUS: Record<string, [string, Tone]> = {
  draft: ["Borrador", "neutral"], pending_approval: ["Pendiente de aprobación", "warn"], approved: ["Aprobada", "good"],
  rejected: ["Rechazada", "risk"], formalized: ["Formalizada", "accent"], cancelled: ["Cancelada", "neutral"],
};

export const PAYMENT_STATUS: Record<string, [string, Tone]> = {
  pending_reconciliation: ["Pendiente de conciliación", "warn"], confirmed: ["Confirmado", "good"],
  rejected: ["Rechazado", "neutral"], reversed: ["Revertido", "risk"],
};

export const INSTALLMENT_STATUS: Record<string, [string, Tone]> = {
  paid: ["Pagada", "good"], partial: ["Pago parcial", "warn"], overdue: ["Vencida", "risk"], due_soon: ["Próxima", "info"], upcoming: ["Futura", "neutral"],
};

export const ACCOUNT_STATUS: Record<string, [string, Tone]> = {
  current: ["Al día", "good"], overdue: ["En mora", "risk"], settled: ["Cancelada", "neutral"], cancelled: ["Anulada", "neutral"],
};

export const APPRAISAL_STATUS: Record<string, [string, Tone]> = {
  draft: ["Borrador", "neutral"], inspected: ["Inspeccionada", "info"], valued: ["Valorada", "info"],
  pending_approval: ["Pendiente de aprobación", "warn"], approved: ["Aprobada", "good"], rejected: ["Rechazada", "risk"],
  accepted: ["Aceptada en contrato", "accent"], acquired: ["Incorporada al inventario", "neutral"], withdrawn: ["Retirada", "neutral"],
};

export const PAYABLE_STATE: Record<string, [string, Tone]> = {
  open: ["Pendiente", "info"], overdue: ["Vencida", "risk"], paid: ["Pagada", "good"], cancelled: ["Anulada", "neutral"],
};
export const APPROVAL_STATUS: Record<string, [string, Tone]> = {
  pending: ["Pendiente", "warn"], approved: ["Aprobada", "good"], rejected: ["Rechazada", "risk"], void: ["Anulada", "neutral"],
};

export const SHIPMENT_STATUS: Record<string, [string, Tone]> = {
  planned: ["Planificado", "neutral"], in_transit: ["En tránsito", "info"], arrived_port: ["En puerto", "info"],
  in_customs: ["En aduana", "warn"], cleared: ["Liberado", "good"], delivered: ["Recibido", "good"], cancelled: ["Cancelado", "neutral"],
};

export const PAYMENT_METHOD: Record<string, string> = { transfer: "Transferencia", cash: "Efectivo", card: "Tarjeta", check: "Cheque", other: "Otro" };
export const CHANNEL: Record<string, string> = {
  phone: "Teléfono", whatsapp: "WhatsApp", email: "Correo", in_person: "Presencial", letter: "Carta", video: "Videollamada", event: "Evento", other: "Otro",
};
export const OUTCOME: Record<string, string> = {
  no_answer: "Sin respuesta", contacted: "Contactado", promise: "Compromiso de pago", refused: "Se niega", wrong_contact: "Contacto erróneo",
  dispute: "Disputa", other: "Otro",
};
export const PROMISE_STATUS: Record<string, [string, Tone]> = { pending: ["Pendiente", "warn"], kept: ["Cumplido", "good"], broken: ["Incumplido", "risk"] };

export const COST_NATURE: Record<string, [string, Tone]> = { actual: ["Real", "good"], estimated: ["Estimado", "warn"] };
export const RATE_TYPE: Record<string, string> = {
  effective_annual: "TEA (efectiva anual)", nominal_annual: "TNA (nominal anual, cap. mensual)", effective_monthly: "Efectiva mensual", none: "Sin interés",
};
export const SYSTEM: Record<string, string> = { french: "Francés (cuota nivelada)", german: "Alemán (amortización constante)", zero_interest: "Sin interés", custom: "Personalizado" };
export const RULE: Record<string, string> = {
  discount: "Descuento", min_price: "Precio mínimo", min_margin: "Margen mínimo", trade_in_value: "Valor de trade-in",
  financing_term: "Plazo", financing_rate: "Tasa", tradein_max_price: "Precio máximo de tasación", tradein_margin: "Margen de reventa",
  payable: "Factura", adjustment: "Ajuste", exception: "Excepción",
};
export const DOC_KIND: Record<string, string> = {
  proposal: "Propuesta comercial", reservation: "Constancia de reserva", purchase_order: "Orden de compra", appraisal_report: "Informe de tasación",
  account_statement: "Estado de cuenta", payment_schedule: "Calendario de pagos", delivery_record: "Acta de entrega", sales_contract: "Contrato de compraventa (borrador)",
};
export const CUSTOMER_KIND: Record<string, string> = { individual: "Persona física", company: "Empresa", trust: "Fideicomiso", other: "Otro" };
export const ROLE: Record<string, string> = {
  ceo: "Director general", cfo: "Director financiero", sales_manager: "Gerente comercial", sales_advisor: "Asesor de ventas",
  collections: "Responsable de cobranzas", inventory_manager: "Responsable de inventario", imports_manager: "Responsable de importaciones",
  auditor: "Auditor", tech_admin: "Administrador técnico",
};
export const PAYABLE_CATEGORY: Record<string, string> = {
  vehicle_purchase: "Compra de vehículo", logistics: "Logística", customs: "Aduana", taxes: "Tributos", services: "Servicios",
  maintenance: "Mantenimiento", operating: "Gasto operativo", other: "Otro",
};
export const CASH_CATEGORY: Record<string, string> = {
  customer_payment: "Cobro de cliente", customer_payment_reversal: "Reversión de cobro", supplier_payment: "Pago a proveedor",
  supplier_payment_reversal: "Reversión de pago", operating_expense: "Gasto operativo", payroll: "Nómina", tax: "Impuestos",
  transfer: "Transferencia", owner_contribution: "Aporte de socios", owner_withdrawal: "Retiro de socios", financing: "Financiamiento",
  adjustment: "Ajuste", other_income: "Otros ingresos",
};

export function label(map: Record<string, string>, key: string | null | undefined): string {
  return key ? map[key] ?? key : "—";
}
