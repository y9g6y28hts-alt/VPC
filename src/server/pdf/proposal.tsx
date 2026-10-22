import { existsSync } from "node:fs";
import { join } from "node:path";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DealSchedule } from "@/domain/financing/deal-schedule";
import { AMORTIZATION_LABELS } from "@/domain/financing/amortization";
import { RATE_CONVENTION_LABELS } from "@/domain/financing/rates";
import { formatDate, formatKm, formatMoney, formatNumber, vehicleName } from "@/lib/format";
import { DOC_TYPE, FUEL, TRANSMISSION } from "@/lib/labels";

export interface ProposalSnapshot {
  issued_on: string;
  customer: { full_name: string; doc_type: string; doc_number: string; phone: string | null; email: string | null };
  vehicle: { stock_code: string; brand: string; model: string; version: string | null; year_model: number; mileage_km: number; color: string | null; condition: string; fuel: string; transmission: string };
  seller: { full_name: string; phone: string | null } | null;
  trade_in_label: string | null;
  schedule: DealSchedule;
  conditions: string | null;
  org: { name: string; is_demo: boolean };
}

// Helvetica (WinAnsi) no incluye el signo menos tipográfico.
const m = (v: number, c: string) => formatMoney(v, c).replace("−", "-");

const RED = "#C8102E";
const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Helvetica", fontSize: 9, color: "#1b1c1f" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: RED, paddingBottom: 12 },
  brand: { fontFamily: "Helvetica-Bold", fontSize: 16, letterSpacing: 1.5 },
  brandSub: { fontSize: 7, letterSpacing: 3, color: "#555", marginTop: 2 },
  docTitle: { fontFamily: "Helvetica-Bold", fontSize: 12, textAlign: "right" },
  muted: { color: "#666" },
  section: { marginTop: 14 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.8, color: "#333", marginBottom: 6 },
  grid: { flexDirection: "row", gap: 12 },
  box: { flex: 1, borderWidth: 1, borderColor: "#ddd", borderRadius: 3, padding: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  strong: { fontFamily: "Helvetica-Bold" },
  big: { fontFamily: "Helvetica-Bold", fontSize: 13 },
  th: { flexDirection: "row", backgroundColor: "#f1f1f1", paddingVertical: 4, paddingHorizontal: 4, fontFamily: "Helvetica-Bold", fontSize: 8 },
  tr: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#e6e6e6", fontSize: 8 },
  c1: { width: "34%" }, c2: { width: "16%" }, c3: { width: "17%", textAlign: "right" }, c4: { width: "16%", textAlign: "right" }, c5: { width: "17%", textAlign: "right" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7, color: "#777", borderTopWidth: 0.5, borderTopColor: "#ccc", paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
  demo: { position: "absolute", top: 330, left: 60, fontSize: 64, color: "#000", opacity: 0.06, transform: "rotate(-30deg)", fontFamily: "Helvetica-Bold" },
  notice: { marginTop: 12, padding: 8, backgroundColor: "#f6f6f6", borderLeftWidth: 2, borderLeftColor: RED, fontSize: 7.8, color: "#444", lineHeight: 1.4 },
});

const LOGO = ["logo.png", "logo.jpg"].map((f) => join(process.cwd(), "public", "brand", f)).find((p) => existsSync(p));

export function ProposalDocument({ number, validUntil, data }: { number: string; validUntil: string; data: ProposalSnapshot }) {
  const sc = data.schedule;
  const c = sc.currency;
  const v = data.vehicle;
  return (
    <Document title={`Propuesta ${number}`} author={data.org.name} subject="Propuesta comercial" creator="Da Silva OS">
      <Page size="A4" style={s.page} wrap>
        {data.org.is_demo ? <Text style={s.demo} fixed>DEMOSTRACIÓN</Text> : null}
        <View style={s.header} fixed>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf no admite alt */}
            {LOGO ? <Image src={LOGO} style={{ height: 34, objectFit: "contain" }} /> : (
              <View><Text style={s.brand}>DA SILVA</Text><Text style={s.brandSub}>AUTOMOTORES</Text></View>
            )}
          </View>
          <View>
            <Text style={s.docTitle}>Propuesta comercial</Text>
            <Text style={[s.muted, { textAlign: "right", marginTop: 2 }]}>N.º {number}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Emitida el {formatDate(data.issued_on)} · Válida hasta el {formatDate(validUntil)}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid]}>
          <View style={s.box}>
            <Text style={s.h2}>Cliente</Text>
            <Text style={s.strong}>{data.customer.full_name}</Text>
            <Text style={s.muted}>{DOC_TYPE[data.customer.doc_type] ?? data.customer.doc_type} {data.customer.doc_number}</Text>
            {data.customer.phone ? <Text style={s.muted}>{data.customer.phone}</Text> : null}
            {data.customer.email ? <Text style={s.muted}>{data.customer.email}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.h2}>Vehículo</Text>
            <Text style={s.strong}>{vehicleName(v.brand, v.model)} {v.version ?? ""}</Text>
            <Text style={s.muted}>Año-modelo {v.year_model} · {v.condition === "nuevo" ? "0 km" : formatKm(v.mileage_km)} · {v.color ?? ""}</Text>
            <Text style={s.muted}>{FUEL[v.fuel] ?? v.fuel} · {TRANSMISSION[v.transmission] ?? v.transmission} · Código {v.stock_code}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid]}>
          <View style={s.box}>
            <Text style={s.h2}>Precio</Text>
            <View style={s.row}><Text>Precio de lista</Text><Text>{m(sc.listPrice, c)}</Text></View>
            {sc.discount > 0 ? <View style={s.row}><Text>Descuento</Text><Text>- {m(sc.discount, c)}</Text></View> : null}
            <View style={s.row}><Text style={s.strong}>Precio de venta</Text><Text style={s.strong}>{m(sc.salePrice, c)}</Text></View>
            {sc.tradeInValue > 0 ? <View style={s.row}><Text>Vehículo usado{data.trade_in_label ? ` (${data.trade_in_label})` : ""}</Text><Text>- {m(sc.tradeInValue, c)}</Text></View> : null}
            <View style={s.row}><Text>{sc.financedAmount > 0 ? "Entrega inicial" : "Pago de contado"}</Text><Text>- {m(sc.downPayment, c)}</Text></View>
            <View style={s.row}><Text style={s.strong}>Saldo a financiar</Text><Text style={s.strong}>{m(sc.financedAmount, c)}</Text></View>
          </View>
          <View style={s.box}>
            <Text style={s.h2}>Financiación</Text>
            {sc.financedAmount > 0 && sc.plan.method !== "sin_financiacion" ? (
              <>
                <View style={s.row}><Text>Sistema</Text><Text>{AMORTIZATION_LABELS[sc.plan.method]}</Text></View>
                <View style={s.row}><Text>Plazo</Text><Text>{sc.plan.termMonths} meses</Text></View>
                <View style={s.row}><Text>Tasa</Text><Text>{formatNumber(sc.plan.rateInput, 2)} % {RATE_CONVENTION_LABELS[sc.plan.rateConvention]}</Text></View>
                <View style={s.row}><Text>Equivalencias</Text><Text>TEM {formatNumber(sc.plan.tem, 3)} % · TEA {formatNumber(sc.plan.tea, 2)} %</Text></View>
                <View style={s.row}><Text>{sc.plan.method === "aleman" ? "Primera cuota" : "Cuota mensual"}</Text><Text style={s.big}>{m(sc.regularPayment ?? 0, c)}</Text></View>
                <View style={s.row}><Text>Intereses totales</Text><Text>{m(sc.totalInterest, c)}</Text></View>
                <View style={s.row}><Text style={s.strong}>Total a pagar</Text><Text style={s.strong}>{m(sc.totalPayable, c)}</Text></View>
              </>
            ) : <Text style={s.muted}>Operación de contado, sin financiación.</Text>}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Tabla de pagos</Text>
          <View style={s.th} fixed><Text style={s.c1}>Concepto</Text><Text style={s.c2}>Vencimiento</Text><Text style={s.c3}>Capital</Text><Text style={s.c4}>Interés</Text><Text style={s.c5}>Total</Text></View>
          {sc.rows.map((r, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={s.c1}>{r.description}</Text>
              <Text style={s.c2}>{formatDate(r.dueDate)}</Text>
              <Text style={s.c3}>{m(r.principal, c)}</Text>
              <Text style={s.c4}>{m(r.interest, c)}</Text>
              <Text style={s.c5}>{m(r.total, c)}</Text>
            </View>
          ))}
        </View>

        {data.conditions ? (
          <View style={s.section}><Text style={s.h2}>Condiciones particulares</Text><Text>{data.conditions}</Text></View>
        ) : null}

        <View style={s.notice} wrap={false}>
          <Text>
            Esta propuesta es una cotización válida hasta la fecha indicada y no constituye una aprobación crediticia ni una reserva de la unidad.
            La disponibilidad, el precio y las condiciones de financiación se confirman al formalizar la operación. Los importes de cuotas se calculan
            con el sistema y la tasa indicados; los intereses se redondean a la unidad mínima de la moneda y la última cuota absorbe la diferencia de redondeo.
            {c === "USD" ? " Los pagos en guaraníes se convierten al tipo de cambio vigente a la fecha de cada pago." : ""}
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text>{data.org.name}{data.seller ? ` · Asesor: ${data.seller.full_name}${data.seller.phone ? ` · ${data.seller.phone}` : ""}` : ""}</Text>
          <Text render={({ pageNumber, totalPages }) => `${number} · Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
