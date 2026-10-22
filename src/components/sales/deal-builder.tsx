"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileDown, Loader2, Plus, Save, Send, Share2, Trash2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Field, FormError, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { Panel } from "@/components/ui/panel";
import { Notice } from "@/components/ui/states";
import { KindTag, StatusPill } from "@/components/ui/status";
import { cn } from "@/components/ui/cn";
import { AMORTIZATION_LABELS, FinancingError, balloonIndicesForMonths, type AmortizationMethod } from "@/domain/financing/amortization";
import { buildDealSchedule, type DealSchedule } from "@/domain/financing/deal-schedule";
import { RATE_CONVENTION_LABELS, type RateConvention } from "@/domain/financing/rates";
import { checkDealPricing } from "@/domain/sales/pricing";
import type { CurrencyCode } from "@/domain/money";
import { addMonths } from "@/domain/dates";
import { formatDate, formatInputAmount, formatMoney, formatNumber, whatsappHref } from "@/lib/format";
import { parseLocaleNumber } from "@/lib/forms";
import { INSTALLMENT_KIND } from "@/lib/labels";
import { createProposal, saveDeal } from "@/server/actions/sales";

export interface BuilderVehicle {
  id: string;
  label: string;
  price_currency: CurrencyCode;
  list_price: string | null;
  min_price: string | null;
}
export interface BuilderAppraisal {
  id: string;
  customer_id: string;
  label: string;
  number: string;
  currency: CurrencyCode;
  offered_value: string;
  accepted_value: string | null;
  status: string;
}
export interface BuilderInitial {
  id?: string;
  customer_id?: string;
  vehicle_id?: string;
  discount?: number;
  trade_in_appraisal_id?: string | null;
  trade_in_value?: number;
  down_payment?: number;
  payment_type?: "contado" | "financiado";
  terms?: { method: AmortizationMethod; ratePercent: number; rateConvention: RateConvention; termMonths: number; firstDueDate: string; balloons?: ReadonlyArray<{ index: number; amount: number }> } | null;
  notes?: string | null;
}

const num = (s: string) => {
  const n = parseLocaleNumber(s);
  return Number.isFinite(n) ? n : NaN;
};

function MoneyField({ id, label, value, onChange, currency, hint, error }: { id: string; label: string; value: string; onChange: (v: string) => void; currency: string; hint?: React.ReactNode; error?: string | null }) {
  return (
    <Field label={`${label} (${currency})`} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        inputMode="decimal"
        className="num"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const n = num(value);
          if (Number.isFinite(n)) onChange(formatInputAmount(n, currency));
        }}
        aria-invalid={!!error}
      />
    </Field>
  );
}

export function DealBuilder({
  mode,
  customers,
  vehicles,
  appraisals,
  maxDiscountPct,
  defaultConvention,
  today,
  initial = {},
  customerPhones = {},
}: {
  mode: "deal" | "simulator";
  customers: Array<{ value: string; label: string; hint?: string }>;
  vehicles: BuilderVehicle[];
  appraisals: BuilderAppraisal[];
  maxDiscountPct: number;
  defaultConvention: RateConvention;
  today: string;
  initial?: BuilderInitial;
  customerPhones?: Record<string, string | null>;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(initial.customer_id ?? "");
  const [vehicleId, setVehicleId] = useState(initial.vehicle_id ?? "");
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const currency: CurrencyCode = vehicle?.price_currency ?? "PYG";
  const [manualPrice, setManualPrice] = useState("");
  const listPrice = vehicle?.list_price ? Number(vehicle.list_price) : mode === "simulator" ? num(manualPrice) : NaN;

  const fmt = (n: number | undefined) => (n === undefined ? "" : formatInputAmount(n, currency));
  const [discount, setDiscount] = useState(fmt(initial.discount ?? 0));
  const [tradeInId, setTradeInId] = useState(initial.trade_in_appraisal_id ?? "");
  const [tradeIn, setTradeIn] = useState(fmt(initial.trade_in_value ?? 0));
  const [down, setDown] = useState(fmt(initial.down_payment ?? 0));
  const [paymentType, setPaymentType] = useState<"contado" | "financiado">(initial.payment_type ?? "financiado");
  const [method, setMethod] = useState<AmortizationMethod>(initial.terms?.method ?? "frances");
  const [rate, setRate] = useState(initial.terms ? formatNumber(initial.terms.ratePercent, 2) : "");
  const [convention, setConvention] = useState<RateConvention>(initial.terms?.rateConvention ?? defaultConvention);
  const [term, setTerm] = useState(String(initial.terms?.termMonths ?? 24));
  const [firstDue, setFirstDue] = useState(initial.terms?.firstDueDate ?? addMonths(today, 1));
  const [balloons, setBalloons] = useState<Array<{ index: string; amount: string }>>(
    initial.terms?.balloons?.map((b) => ({ index: String(b.index), amount: formatInputAmount(b.amount, currency) })) ?? [],
  );
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [showSchedule, setShowSchedule] = useState(false);

  const customerAppraisals = appraisals.filter((a) => a.customer_id === customerId && a.currency === currency);
  const appraisal = customerAppraisals.find((a) => a.id === tradeInId) ?? null;

  // Al cambiar de unidad, se reinician importes ligados a la moneda.
  const prevVehicle = useRef(vehicleId);
  useEffect(() => {
    if (prevVehicle.current !== vehicleId) {
      prevVehicle.current = vehicleId;
      setTradeInId("");
      setTradeIn("0");
    }
  }, [vehicleId]);

  const terms = useMemo(() => {
    const r = num(rate);
    const t = Number(term);
    return {
      method,
      ratePercent: Number.isFinite(r) ? r : NaN,
      rateConvention: convention,
      termMonths: t,
      firstDueDate: firstDue,
      balloons: balloons
        .filter((b) => b.index !== "" && b.amount !== "")
        .map((b) => ({ index: Number(b.index), amount: num(b.amount) })),
    };
  }, [method, rate, convention, term, firstDue, balloons]);

  const result = useMemo((): { schedule: DealSchedule | null; error: string | null } => {
    if (paymentType === "financiado" && rate.trim() === "") return { schedule: null, error: "Ingrese la tasa de interés (0 si la financiación es sin interés)" };
    if (!Number.isFinite(listPrice)) return { schedule: null, error: vehicle ? "La unidad no tiene precio de lista" : "Seleccione una unidad" };
    const d = num(discount || "0");
    const ti = num(tradeIn || "0");
    const dp = num(down || "0");
    if ([d, ti, dp].some((n) => !Number.isFinite(n))) return { schedule: null, error: "Revise los importes: formato inválido" };
    try {
      return {
        schedule: buildDealSchedule({
          currency,
          listPrice,
          discount: d,
          tradeInValue: ti,
          downPayment: dp,
          operationDate: today,
          financing: paymentType === "financiado" ? terms : null,
        }),
        error: null,
      };
    } catch (e) {
      return { schedule: null, error: e instanceof FinancingError ? e.message : "No se pudo calcular el plan" };
    }
  }, [listPrice, discount, tradeIn, down, currency, today, paymentType, terms, vehicle, rate]);

  const s = result.schedule;
  const pricing = Number.isFinite(listPrice)
    ? checkDealPricing({ currency, listPrice, discount: num(discount || "0") || 0, minPrice: vehicle?.min_price ? Number(vehicle.min_price) : null, maxDiscountPct })
    : null;
  const tradeInOverLimit = appraisal && num(tradeIn || "0") > Number(appraisal.accepted_value ?? appraisal.offered_value);
  const contadoMismatch = paymentType === "contado" && s && s.financedAmount > 0;

  const payload = (extra: Record<string, unknown>) =>
    JSON.stringify({
      id: initial.id,
      customer_id: customerId || undefined,
      vehicle_id: vehicleId || undefined,
      discount: num(discount || "0"),
      trade_in_appraisal_id: tradeInId || null,
      trade_in_value: num(tradeIn || "0"),
      trade_in_label: appraisal ? `${appraisal.label} (${appraisal.number})` : null,
      down_payment: num(down || "0"),
      payment_type: paymentType,
      terms: paymentType === "financiado" ? terms : null,
      notes: notes || undefined,
      ...extra,
    });

  const [saveState, saveAction, saving] = useActionState(saveDeal, { ok: false });
  const [propState, propAction, proposing] = useActionState(createProposal, { ok: false });
  const lastSave = useRef<number | undefined>(undefined);
  const lastProp = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (saveState.at && saveState.at !== lastSave.current) {
      lastSave.current = saveState.at;
      if (saveState.ok && saveState.id) {
        router.push(`/ventas/${saveState.id}`);
      }
    }
  }, [saveState, router]);
  useEffect(() => {
    if (propState.at && propState.at !== lastProp.current) {
      lastProp.current = propState.at;
      if (propState.ok && propState.id) {
        window.open(`/api/propuestas/${propState.id}`, "_blank", "noopener");
      }
    }
  }, [propState]);

  const submit = (action: (fd: FormData) => void, extra: Record<string, unknown>) => {
    const fd = new FormData();
    fd.set("payload", payload(extra));
    startTransition(() => action(fd));
  };

  const shareWhatsapp = async () => {
    if (!propState.id) return;
    const url = `/api/propuestas/${propState.id}`;
    const text = s
      ? `Propuesta ${vehicle?.label ?? ""}: precio ${formatMoney(s.salePrice, currency)}${s.regularPayment ? `, ${s.plan.termMonths} cuotas de ${formatMoney(s.regularPayment, currency)}` : ""}. Le envío el detalle en PDF.`
      : "Le envío la propuesta en PDF.";
    try {
      const blob = await fetch(url).then((r) => r.blob());
      const file = new File([blob], "propuesta-da-silva.pdf", { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
    } catch {
      // Sin Web Share con archivos (escritorio): se abre WhatsApp con el texto y se descarga el PDF.
    }
    const a = document.createElement("a");
    a.href = `${url}?descargar=1`;
    a.click();
    const wa = whatsappHref(customerPhones[customerId] ?? null, text);
    window.open(wa ?? `https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const error = saveState.ok ? null : saveState.message;
  const propError = propState.ok ? null : propState.message;
  const busy = saving || proposing;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Panel title="Cliente y unidad">
          <FormGrid>
            <Field label="Cliente" htmlFor="b-customer" required={mode === "deal"}>
              <FilterableSelect id="b-customer" name="customer" options={customers} defaultValue={customerId} onChange={setCustomerId}
                placeholder={mode === "simulator" ? "Opcional en la simulación" : "Seleccione el cliente"} />
            </Field>
            <Field label="Unidad" htmlFor="b-vehicle" required={mode === "deal"}>
              <FilterableSelect id="b-vehicle" name="vehicle" defaultValue={vehicleId} onChange={setVehicleId}
                options={vehicles.map((v) => ({ value: v.id, label: v.label, hint: v.list_price ? formatMoney(v.list_price, v.price_currency) : "sin precio" }))}
                placeholder={mode === "simulator" ? "Opcional: o ingrese un precio" : "Seleccione la unidad"} />
            </Field>
          </FormGrid>
          {mode === "simulator" && !vehicle ? (
            <div className="mt-4 max-w-xs">
              <MoneyField id="manual" label="Precio a simular" value={manualPrice} onChange={setManualPrice} currency="PYG" />
            </div>
          ) : null}
        </Panel>

        <Panel title="Precio y forma de pago">
          <FormGrid cols={3}>
            <Field label={`Precio de lista (${currency})`} htmlFor="b-list">
              <Input id="b-list" value={Number.isFinite(listPrice) ? formatInputAmount(listPrice, currency) : ""} readOnly className="num text-ink-2" />
            </Field>
            <MoneyField id="discount" label="Descuento" value={discount} onChange={setDiscount} currency={currency}
              hint={pricing ? `${formatNumber(pricing.discountPct, 2)} % del precio de lista` : undefined} />
            <Field label="Modalidad" htmlFor="b-type">
              <Select id="b-type" value={paymentType} onChange={(e) => setPaymentType(e.target.value as "contado" | "financiado")}>
                <option value="financiado">Financiado</option>
                <option value="contado">Contado</option>
              </Select>
            </Field>
            <Field label="Vehículo usado (trade-in)" htmlFor="b-tradein-sel" hint={customerId ? (customerAppraisals.length ? undefined : "El cliente no tiene tasaciones aprobadas") : "Seleccione primero el cliente"}>
              <Select id="b-tradein-sel" value={tradeInId} onChange={(e) => {
                setTradeInId(e.target.value);
                const a = customerAppraisals.find((x) => x.id === e.target.value);
                setTradeIn(a ? formatInputAmount(Number(a.accepted_value ?? a.offered_value), currency) : "0");
              }} disabled={!customerAppraisals.length}>
                <option value="">Sin trade-in</option>
                {customerAppraisals.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.label}</option>)}
              </Select>
            </Field>
            <MoneyField id="tradein" label="Valor del usado" value={tradeIn} onChange={setTradeIn} currency={currency}
              error={tradeInOverLimit ? "Supera el valor aprobado de la tasación" : null}
              hint={appraisal ? `Aprobado: ${formatMoney(appraisal.accepted_value ?? appraisal.offered_value, currency)}${appraisal.accepted_value ? " (aceptado)" : ""}` : undefined} />
            <MoneyField id="down" label={paymentType === "contado" ? "Pago de contado" : "Entrega inicial"} value={down} onChange={setDown} currency={currency}
              hint={paymentType === "contado" && s ? `Debe cubrir ${formatMoney(s.salePrice - s.tradeInValue, currency)}` : undefined} />
          </FormGrid>
          {pricing?.requiresApproval ? (
            <div className="mt-4"><Notice tone="warning"><AlertTriangle className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />{pricing.reason}. La operación requerirá aprobación de gerencia.</Notice></div>
          ) : null}
          {contadoMismatch ? <div className="mt-4"><Notice tone="warning">En contado, el pago más el usado deben cubrir el precio de venta.</Notice></div> : null}
        </Panel>

        {paymentType === "financiado" ? (
          <Panel title="Financiación" description="La cotización no es una aprobación crediticia.">
            <FormGrid cols={3}>
              <Field label="Sistema" htmlFor="b-method">
                <Select id="b-method" value={method} onChange={(e) => setMethod(e.target.value as AmortizationMethod)}>
                  {Object.entries(AMORTIZATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Tasa (%)" htmlFor="b-rate" hint="Use 0 para financiación sin interés">
                <Input id="b-rate" inputMode="decimal" className="num" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="18" />
              </Field>
              <Field label="Expresión de la tasa" htmlFor="b-conv">
                <Select id="b-conv" value={convention} onChange={(e) => setConvention(e.target.value as RateConvention)}>
                  {Object.entries(RATE_CONVENTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Plazo (meses)" htmlFor="b-term">
                <Select id="b-term" value={term} onChange={(e) => setTerm(e.target.value)}>
                  {[6, 12, 18, 24, 30, 36, 42, 48, 60, 72].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </Field>
              <Field label="Primer vencimiento" htmlFor="b-first">
                <Input id="b-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
              </Field>
            </FormGrid>
            <div className="mt-5 border-t border-line-soft pt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-ink-2">Refuerzos <span className="font-normal text-faint">(pagos extraordinarios de capital)</span></p>
                <div className="flex gap-1.5">
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={() => {
                    const amount = balloons[0]?.amount ?? "";
                    const idx = balloonIndicesForMonths(firstDue, Number(term), [7, 12]);
                    setBalloons(idx.map((i) => ({ index: String(i), amount })));
                  }}>Julio y diciembre</button>
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setBalloons([...balloons, { index: "", amount: "" }])}>
                    <Plus aria-hidden /> Agregar
                  </button>
                </div>
              </div>
              {balloons.length === 0 ? <p className="text-[12.5px] text-faint">Sin refuerzos.</p> : (
                <ul className="space-y-2">
                  {balloons.map((b, i) => (
                    <li key={i} className="flex items-end gap-2">
                      <Field label="Con la cuota n.º" htmlFor={`b-bi-${i}`} className="w-32">
                        <Input id={`b-bi-${i}`} inputMode="numeric" value={b.index} onChange={(e) => setBalloons(balloons.map((x, j) => (j === i ? { ...x, index: e.target.value } : x)))} />
                      </Field>
                      <div className="flex-1">
                        <MoneyField id={`b-${i}`} label="Importe" value={b.amount} currency={currency}
                          onChange={(v) => setBalloons(balloons.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                      </div>
                      <button type="button" aria-label="Quitar refuerzo" className={buttonClass("ghost", "md")} onClick={() => setBalloons(balloons.filter((_, j) => j !== i))}>
                        <Trash2 aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        ) : null}

        {mode === "deal" ? (
          <Panel title="Observaciones">
            <Textarea aria-label="Observaciones" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Condiciones particulares, accesorios, plazos de entrega…" />
          </Panel>
        ) : null}

        {s ? (
          <Panel title="Tabla de pagos" actions={<button type="button" className={buttonClass("ghost", "sm")} onClick={() => setShowSchedule(!showSchedule)}>{showSchedule ? "Ocultar" : `Ver ${s.rows.length} pagos`}</button>} bodyClassName={showSchedule ? "p-0" : "py-2"}>
            {showSchedule ? (
              <div className="scrollbar-thin max-h-[480px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-surface text-[11.5px] uppercase tracking-wide text-faint">
                    <tr className="border-b border-line"><th className="px-3 py-2 text-left">Concepto</th><th className="px-3 py-2 text-left">Vence</th><th className="px-3 py-2 text-right">Capital</th><th className="px-3 py-2 text-right">Interés</th><th className="px-3 py-2 text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={i} className={cn("border-b border-line-soft", r.kind === "refuerzo" && "bg-info-soft/40")}>
                        <td className="px-3 py-1.5 text-ink-2">{r.description}</td>
                        <td className="num px-3 py-1.5 text-muted">{formatDate(r.dueDate)}</td>
                        <td className="num px-3 py-1.5 text-right">{formatMoney(r.principal, currency)}</td>
                        <td className="num px-3 py-1.5 text-right text-muted">{formatMoney(r.interest, currency)}</td>
                        <td className="num px-3 py-1.5 text-right text-ink">{formatMoney(r.total, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-[12.5px] text-faint">{s.rows.map((r) => INSTALLMENT_KIND[r.kind]).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</p>}
          </Panel>
        ) : null}
      </div>

      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line-soft px-4 py-3">
            <p className="flex items-center justify-between text-[13px] font-semibold text-ink">Resumen <KindTag kind="proyectado" /></p>
            {vehicle ? <p className="mt-0.5 truncate text-[12.5px] text-faint">{vehicle.label}</p> : null}
          </div>
          {s ? (
            <dl className="space-y-2 px-4 py-4 text-[13.5px]">
              <SumRow label="Precio de lista" value={formatMoney(s.listPrice, currency)} />
              {s.discount > 0 ? <SumRow label="Descuento" value={`− ${formatMoney(s.discount, currency)}`} /> : null}
              <SumRow label="Precio de venta" value={formatMoney(s.salePrice, currency)} strong />
              {s.tradeInValue > 0 ? <SumRow label="Usado (trade-in)" value={`− ${formatMoney(s.tradeInValue, currency)}`} /> : null}
              <SumRow label={paymentType === "contado" ? "Pago de contado" : "Entrega inicial"} value={`− ${formatMoney(s.downPayment, currency)}`} />
              <SumRow label="Saldo a financiar" value={formatMoney(s.financedAmount, currency)} strong />
              {s.regularPayment ? (
                <div className="mt-3 rounded-md border border-line-soft bg-carbon/50 p-3">
                  <p className="text-[12px] text-faint">{s.plan.method === "aleman" ? "Primera cuota (decreciente)" : "Cuota mensual"}</p>
                  <p className="display num mt-1 text-[24px] font-semibold text-ink">{formatMoney(s.regularPayment, currency)}</p>
                  <p className="num mt-1 text-[12px] text-faint">{s.plan.termMonths} cuotas · TEM {formatNumber(s.plan.tem, 3)} % · TNA {formatNumber(s.plan.tna, 2)} % · TEA {formatNumber(s.plan.tea, 2)} %</p>
                </div>
              ) : null}
              {s.totalInterest > 0 ? <SumRow label="Intereses totales" value={formatMoney(s.totalInterest, currency)} /> : null}
              <SumRow label="Total a pagar" value={formatMoney(s.totalPayable, currency)} strong />
            </dl>
          ) : (
            <p className="px-4 py-6 text-[13px] text-warning">{result.error}</p>
          )}
          {pricing?.requiresApproval ? <div className="px-4 pb-3"><StatusPill tone="warning">Requiere aprobación</StatusPill></div> : null}
          <div className="space-y-2 border-t border-line-soft p-4">
            {error ? <FormError message={error} /> : null}
            {propError ? <FormError message={propError} /> : null}
            {mode === "deal" ? (
              <>
                <button type="button" disabled={busy || !s} className={buttonClass("primary", "md", "w-full")} onClick={() => submit(saveAction, { submit: true })}>
                  {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Guardar y enviar
                </button>
                <button type="button" disabled={busy || !s} className={buttonClass("secondary", "md", "w-full")} onClick={() => submit(saveAction, { submit: false })}>
                  <Save aria-hidden /> Guardar borrador
                </button>
              </>
            ) : null}
            <button type="button" disabled={busy || !s || !customerId || !vehicleId} className={buttonClass("outline", "md", "w-full")}
              onClick={() => submit(propAction, { deal_id: initial.id ?? null })}
              title={!customerId || !vehicleId ? "Seleccione cliente y unidad" : undefined}>
              {proposing ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />} Propuesta PDF
            </button>
            {propState.ok && propState.id ? (
              <button type="button" className={buttonClass("ghost", "md", "w-full")} onClick={shareWhatsapp}>
                <Share2 aria-hidden /> Compartir por WhatsApp
              </button>
            ) : null}
            <p className="pt-1 text-[11.5px] leading-relaxed text-faint">
              {mode === "simulator"
                ? "La simulación no crea contratos ni reserva la unidad."
                : "Al enviar, el sistema valida precio mínimo y descuento. La unidad sólo se compromete al formalizar."}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", strong ? "font-semibold text-ink" : "text-ink-2")}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
