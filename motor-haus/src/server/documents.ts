// Modelo de presentación de documentos. Una única función transforma la
// instantánea validada (guardada en la base con su checksum) en secciones; la
// vista HTML y el PDF se generan desde el mismo modelo, por lo que coinciden.
import { CURRENCIES, isCurrency } from "@/domain/finance/money";
import { CATEGORY, DOC_KIND, RATE_TYPE, SYSTEM, label } from "@/lib/labels";

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = Record<string, any>;

export type Align = "left" | "right";
export type Block =
  | { type: "kv"; heading?: string; pairs: Array<[string, string]> }
  | { type: "table"; heading?: string; columns: Array<{ label: string; align?: Align; width?: number }>; rows: string[][]; footer?: string[] }
  | { type: "text"; heading?: string; text: string; tone?: "muted" | "warning" };

export interface DocModel {
  title: string; number: string; issuedAt: string; status: string; orgName: string; orgLine: string; isDemo: boolean;
  blocks: Block[]; notice: string; checksum: string; integrityOk: boolean;
}

export function fmtMoney(v: unknown, ccy: string): string {
  if (v === null || v === undefined || v === "") return "—";
  const c = isCurrency(ccy) ? ccy : "USD";
  const dp = CURRENCIES[c].minorUnits;
  const n = new Intl.NumberFormat("es-PY", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v as number);
  return `${c} ${n}`;
}
const fmtDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "—");
const pctStr = (v: unknown, dp = 2) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("es-PY", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v))} %`);

const APPROVAL_TEXT: Record<string, string> = {
  draft: "BORRADOR — sujeta a aprobación interna", pending_approval: "PENDIENTE DE APROBACIÓN INTERNA",
  approved: "APROBADA INTERNAMENTE — no constituye contrato", rejected: "NO APROBADA", formalized: "FORMALIZADA", cancelled: "CANCELADA",
};

export function buildDocModel(doc: J): DocModel {
  const s: J = doc.snapshot;
  const org: J = s.organization ?? {};
  const t: J = s.template ?? {};
  const blocks: Block[] = [];
  const kind: string = doc.kind;

  if (kind === "proposal") {
    const ccy = s.deal.currency;
    blocks.push({ type: "kv", pairs: [
      ["Cliente", s.customer.display_name], ["Asesor", s.deal.salesperson ?? "—"],
      ["Operación", s.deal.number], ["Válida hasta", fmtDate(s.deal.valid_until)],
      ["Estado", APPROVAL_TEXT[s.approval.status] ?? s.approval.status], ["Moneda", ccy],
    ] });
    blocks.push({ type: "table", heading: "Vehículo(s)", columns: [{ label: "Unidad", width: 2.4 }, { label: "Año" }, { label: "Uso" }, { label: "Precio de lista", align: "right" }, { label: "Precio ofrecido", align: "right" }],
      rows: s.items.map((i: J) => [`${i.title}${i.exterior_color ? ` · ${i.exterior_color}` : ""}${i.identifier ? ` · ${i.identifier}` : ""}`, String(i.model_year ?? "—"), i.usage ?? "—", fmtMoney(i.list_price, ccy), fmtMoney(i.negotiated_price, ccy)]) });
    const eq = s.items.flatMap((i: J) => i.equipment ?? []);
    if (eq.length) blocks.push({ type: "text", text: `Equipamiento: ${eq.join(" · ")}`, tone: "muted" });
    if (s.trade_ins.length) {
      blocks.push({ type: "table", heading: "Vehículo recibido como parte de pago", columns: [{ label: "Unidad", width: 2.4 }, { label: "Valor aceptado", align: "right" }, { label: "Cancelación de prenda", align: "right" }, { label: "Crédito neto", align: "right" }],
        rows: s.trade_ins.map((x: J) => [x.title, fmtMoney(x.accepted_value, ccy), fmtMoney(x.lien_payoff, ccy), fmtMoney(x.net_credit, ccy)]) });
    }
    const tt = s.totals;
    const pairs: Array<[string, string]> = [["Precio de la operación", fmtMoney(tt.total_negotiated, ccy)]];
    if (Number(tt.financed_charges)) pairs.push([`Cargos financiados${s.deal.financed_charges_note ? ` (${s.deal.financed_charges_note})` : ""}`, fmtMoney(tt.financed_charges, ccy)]);
    if (Number(tt.trade_in_credit)) pairs.push(["Crédito por parte de pago", `− ${fmtMoney(tt.trade_in_credit, ccy)}`]);
    pairs.push(["Entrega en efectivo", `− ${fmtMoney(tt.cash_down_payment, ccy)}`]);
    if (Number(tt.other_credits)) pairs.push([`Otros créditos (${s.deal.other_credits_note ?? ""})`, `− ${fmtMoney(tt.other_credits, ccy)}`]);
    pairs.push(["Capital a financiar", fmtMoney(tt.financed_principal, ccy)]);
    if (s.plan) pairs.push(["Importe total proyectado (entrega + cuotas)", fmtMoney(tt.total_projected, ccy)]);
    blocks.push({ type: "kv", heading: "Estructura de pago", pairs });
    if (s.plan) {
      const p = s.plan, inp = p.inputs, sm = p.summary;
      blocks.push({ type: "kv", heading: `Plan de financiación · ${p.label}`, pairs: [
        ["Sistema", label(SYSTEM, inp.system)], ["Tasa", inp.system === "zero_interest" ? "Sin interés" : `${pctStr(Number(inp.rate) * 100)} ${label(RATE_TYPE, inp.rateType)}`],
        ["Cuotas", `${inp.termPeriods} · cada ${inp.monthsPerPeriod} mes(es)`], ["Cuota", fmtMoney(sm.installmentAmount, ccy)],
        ["Interés total", fmtMoney(sm.totalInterest, ccy)], ["Total financiado", fmtMoney(sm.totalPayments, ccy)],
        ["Refuerzos", fmtMoney(sm.totalBalloons, ccy)], ["Primer vencimiento", fmtDate(inp.firstDueDate)],
      ] });
      blocks.push({ type: "table", heading: "Calendario de cuotas", columns: [{ label: "#" }, { label: "Vencimiento" }, { label: "Interés", align: "right" }, { label: "Amortización", align: "right" }, { label: "Refuerzo", align: "right" }, { label: "Cuota", align: "right" }, { label: "Saldo", align: "right" }],
        rows: p.schedule.map((r: J) => [String(r.period), fmtDate(r.dueDate), fmtMoney(r.interest, ccy), fmtMoney(r.principal, ccy), Number(r.balloon) ? fmtMoney(r.balloon, ccy) : "—", fmtMoney(r.payment, ccy), fmtMoney(r.closingBalance, ccy)]) });
      blocks.push({ type: "text", text: `Cálculo: motor ${p.engine_version}, versión ${p.version} del plan, verificación ${String(p.checksum).slice(0, 16)}. Importes sujetos a la fecha efectiva de firma.`, tone: "muted" });
    }
  } else if (["payment_schedule", "sales_contract", "delivery_record"].includes(kind)) {
    const c = s.contract, ccy = c.currency;
    blocks.push({ type: "kv", pairs: [["Cliente", s.customer.display_name], ["Contrato", c.number], ["Fecha", fmtDate(c.contract_date)], ["Asesor", c.salesperson ?? "—"],
      ["Precio total", fmtMoney(c.total_price, ccy)], ["Entregas iniciales", fmtMoney(c.upfront_total, ccy)], ["Capital financiado", fmtMoney(c.financed_principal, ccy)], ["Moneda", ccy]] });
    blocks.push({ type: "table", heading: "Unidad(es)", columns: [{ label: "Unidad", width: 2.5 }, { label: "Año" }, { label: "Identificador" }, { label: "Precio", align: "right" }],
      rows: s.units.map((u: J) => [`${u.stock_number} · ${u.title}`, String(u.model_year ?? "—"), u.identifier ?? "—", fmtMoney(u.negotiated_price, ccy)]) });
    if (kind !== "delivery_record") {
      blocks.push({ type: "table", heading: "Obligaciones", columns: [{ label: "#" }, { label: "Concepto", width: 1.6 }, { label: "Vence" }, { label: "Capital", align: "right" }, { label: "Interés", align: "right" }, { label: "Importe", align: "right" }, ...(kind === "payment_schedule" ? [{ label: "Pendiente", align: "right" as Align }] : [])],
        rows: s.installments.map((i: J) => [String(i.seq), i.label, fmtDate(i.due_date), fmtMoney(i.principal, ccy), fmtMoney(i.interest, ccy), fmtMoney(i.amount_due, ccy), ...(kind === "payment_schedule" ? [fmtMoney(i.outstanding, ccy)] : [])]) });
    } else {
      blocks.push({ type: "kv", heading: "Constancia", pairs: [["Recibí conforme", "____________________________"], ["Aclaración y documento", "____________________________"], ["Entregó por la concesionaria", "____________________________"], ["Fecha y hora", "____________________________"]] });
    }
    if (kind === "sales_contract") blocks.push({ type: "text", tone: "warning", text: "Cláusulas contractuales: pendientes de redacción y revisión por asesoría legal. Este borrador solo resume las condiciones económicas formalizadas en el sistema." });
  } else if (kind === "account_statement") {
    const c = s.contract, ccy = c.currency;
    blocks.push({ type: "kv", pairs: [["Cliente", s.customer.display_name], ["Contrato", c.number], ["Período", `${fmtDate(s.period.from)} al ${fmtDate(s.period.to)}`], ["Moneda", ccy],
      ["Saldo pendiente", fmtMoney(s.balance?.outstanding, ccy)], ["Saldo vencido", fmtMoney(s.balance?.overdue_amount, ccy)], ["Próximo vencimiento", fmtDate(s.balance?.next_due_date)], ["Cobrado confirmado", fmtMoney(s.balance?.collected_confirmed, ccy)]] });
    blocks.push({ type: "table", heading: "Movimientos", columns: [{ label: "Fecha" }, { label: "Concepto", width: 2.6 }, { label: "Débito", align: "right" }, { label: "Crédito", align: "right" }, { label: "Saldo", align: "right" }],
      rows: s.lines.map((l: J) => [fmtDate(l.entry_date), l.description, l.debit ? fmtMoney(l.debit, ccy) : "", l.credit ? fmtMoney(l.credit, ccy) : "", fmtMoney(l.balance, ccy)]) });
  } else if (kind === "appraisal_report") {
    const a = s.appraisal, ccy = a.currency, e = s.economics;
    blocks.push({ type: "kv", pairs: [["Cliente", s.customer.display_name], ["Tasación", a.number], ["Tasador", s.appraiser ?? "—"], ["Unidad", `${a.make} ${a.model} ${a.version ?? ""} ${a.year_built ?? ""}`],
      ["Categoría", label(CATEGORY, a.category)], ["Uso", `${a.usage_value ?? "—"} ${a.usage_unit}`], ["Identificador", a.identifier_value ?? "—"], ["Documentación", a.documentation_status]] });
    blocks.push({ type: "table", heading: "Inspección", columns: [{ label: "Ítem", width: 1.6 }, { label: "Resultado" }, { label: "Observaciones", width: 2 }],
      rows: s.inspection.map((i: J) => [i.item, { ok: "Correcto", attention: "Atención", fail: "Falla", not_checked: "No verificado" }[i.result as string] ?? i.result, i.notes ?? ""]) });
    blocks.push({ type: "kv", heading: "Valoración", pairs: [["Valor de mercado estimado", fmtMoney(a.market_value_estimate, ccy)], ["Fuente / fecha", `${a.market_value_source ?? "—"} · ${fmtDate(a.market_value_date)}`],
      ["Precio de adquisición propuesto", fmtMoney(a.proposed_acquisition_price, ccy)], ["Reacondicionamiento estimado", fmtMoney(e.recon_costs, ccy)],
      ["Coste total estimado", fmtMoney(e.total_cost, ccy)], ["Precio de reventa esperado", fmtMoney(a.expected_resale_price, ccy)],
      ["Margen bruto estimado", `${fmtMoney(e.estimated_margin, ccy)} · ${pctStr(e.estimated_margin_pct)}`], ["Incertidumbre", a.uncertainty ?? "—"],
      ["Máximo autorizado", fmtMoney(a.max_authorized_price, ccy)], ["Cancelación de prenda", fmtMoney(a.lien_payoff_amount, ccy)]] });
    if (a.inspector_report) blocks.push({ type: "text", heading: "Informe del perito", text: a.inspector_report });
  } else if (kind === "reservation") {
    const r = s.reservation;
    blocks.push({ type: "kv", pairs: [["Cliente", s.customer.display_name], ["Unidad", `${s.unit.stock_number} · ${s.unit.title} ${s.unit.model_year ?? ""}`],
      ["Precio de lista", fmtMoney(s.unit.list_price, s.unit.currency)], ["Vence", new Date(r.expires_at).toLocaleString("es-PY")],
      ["Seña comprometida", Number(r.deposit_amount) ? fmtMoney(r.deposit_amount, r.deposit_currency) : "Sin seña"], ["Estado", r.status]] });
    blocks.push({ type: "text", heading: "Condiciones", text: r.conditions });
  }

  return {
    title: t.title ?? label(DOC_KIND, kind), number: doc.number, issuedAt: doc.issued_at, status: doc.status,
    orgName: org.legal_name ?? org.name ?? "", orgLine: [org.tax_id && `RUC ${org.tax_id}`, org.address, org.phone, org.email].filter(Boolean).join(" · "),
    isDemo: Boolean(org.is_demo), blocks, notice: t.legal_notice ?? "", checksum: doc.checksum, integrityOk: doc.integrity_ok,
  };
}

