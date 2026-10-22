"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buildPlan, FinancingError, MonthsPerPeriod, PlanInputs } from "@/domain/finance/engine";
import { addMonths } from "@/domain/finance/dates";
import { Dec, isCurrency, moneyString } from "@/domain/finance/money";
import { money } from "@/lib/format";
import { ActionForm, Field, Input, Select, Submit } from "@/components/ui/Form";
import { saveScenarioAction } from "./actions";

/**
 * Constructor de escenarios: calcula en vivo con el mismo motor que usa el
 * servidor. Al guardar, el servidor recalcula con el capital validado y
 * PostgreSQL verifica el calendario antes de persistirlo.
 */
export function ScenarioBuilder({ dealId, principal, currency, today, nextLabel }: {
  dealId: string; principal: string; currency: string; today: string; nextLabel: string;
}) {
  const [system, setSystem] = useState<"french" | "german" | "zero_interest">("french");
  const [rateType, setRateType] = useState<"effective_annual" | "nominal_annual" | "effective_monthly">("effective_annual");
  const [ratePct, setRatePct] = useState("11");
  const [term, setTerm] = useState("24");
  const [mpp, setMpp] = useState<MonthsPerPeriod>(1);
  const [firstDue, setFirstDue] = useState(addMonths(today, 1));
  const [balloons, setBalloons] = useState<Array<{ period: string; amount: string }>>([]);

  const preview = useMemo(() => {
    if (!isCurrency(currency)) return { error: "Moneda no soportada" };
    try {
      const inputs: PlanInputs = {
        system, currency, principal: moneyString(principal, currency),
        rateType: system === "zero_interest" ? "none" : rateType,
        rate: system === "zero_interest" ? "0" : new Dec(ratePct || "0").div(100).toString(),
        termPeriods: Number(term), monthsPerPeriod: mpp, startDate: today, firstDueDate: firstDue,
        balloons: balloons.filter((b) => b.period && b.amount).map((b) => ({ period: Number(b.period), amount: new Dec(b.amount).toFixed(2) })),
        upfront: [],
      };
      return { plan: buildPlan(inputs) };
    } catch (e) {
      return { error: e instanceof FinancingError || e instanceof Error ? e.message : "Parámetros inválidos" };
    }
  }, [system, rateType, ratePct, term, mpp, firstDue, balloons, principal, currency, today]);

  if (Number(principal) <= 0) {
    return <p className="px-4 py-3 text-xs text-muted">Operación de contado: el capital a financiar es cero, no corresponde un plan.</p>;
  }

  return (
    <ActionForm action={saveScenarioAction} className="px-4 py-3">
      <input type="hidden" name="deal" value={dealId} />
      <input type="hidden" name="start_date" value={today} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Field label="Escenario" name="label"><Input name="label" defaultValue={nextLabel} /></Field>
        <Field label="Sistema" name="system">
          <Select name="system" value={system} onChange={(e) => setSystem(e.target.value as typeof system)}
            options={[["french", "Francés"], ["german", "Alemán"], ["zero_interest", "Sin interés"]]} />
        </Field>
        <Field label="Tipo de tasa" name="rate_type">
          <Select name="rate_type" value={rateType} onChange={(e) => setRateType(e.target.value as typeof rateType)}
            options={[["effective_annual", "TEA"], ["nominal_annual", "TNA (cap. mensual)"], ["effective_monthly", "Efectiva mensual"]]} />
        </Field>
        <Field label="Tasa %" name="rate_pct"><Input name="rate_pct" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} /></Field>
        <Field label="Cuotas" name="term"><Input name="term" type="number" min={1} max={360} value={term} onChange={(e) => setTerm(e.target.value)} /></Field>
        <Field label="Frecuencia" name="months_per_period">
          <Select name="months_per_period" value={String(mpp)} onChange={(e) => setMpp(Number(e.target.value) as MonthsPerPeriod)}
            options={[["1", "Mensual"], ["2", "Bimestral"], ["3", "Trimestral"], ["6", "Semestral"], ["12", "Anual"]]} />
        </Field>
        <Field label="Primer vencimiento" name="first_due"><Input type="date" name="first_due" value={firstDue} min={today} onChange={(e) => setFirstDue(e.target.value)} /></Field>
        <div className="flex items-end">
          <button type="button" onClick={() => setBalloons((b) => [...b, { period: "", amount: "" }])} className="flex h-8 items-center gap-1 text-xs text-muted hover:text-text">
            <Plus className="size-3.5" />Refuerzo
          </button>
        </div>
      </div>
      {balloons.map((b, idx) => (
        <div key={idx} className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2 md:w-1/2">
          <Field label={`Refuerzo ${idx + 1} · período`}><Input name="balloon_period" type="number" min={1} value={b.period}
            onChange={(e) => setBalloons((all) => all.map((x, j) => (j === idx ? { ...x, period: e.target.value } : x)))} /></Field>
          <Field label="Importe"><Input name="balloon_amount" inputMode="decimal" value={b.amount}
            onChange={(e) => setBalloons((all) => all.map((x, j) => (j === idx ? { ...x, amount: e.target.value } : x)))} /></Field>
          <button type="button" aria-label="Quitar refuerzo" onClick={() => setBalloons((all) => all.filter((_, j) => j !== idx))} className="mb-2 text-faint hover:text-risk"><Trash2 className="size-4" /></button>
        </div>
      ))}

      <div className="mt-3 rounded-sm border border-line-soft bg-ink/40 px-3 py-2.5">
        {"error" in preview ? (
          <p className="text-xs text-risk">{preview.error}</p>
        ) : preview.plan && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <Kv k="Capital financiado" v={money(preview.plan.summary.principal, currency)} />
            <Kv k={system === "german" ? "Primera cuota" : "Cuota"} v={money(preview.plan.summary.installmentAmount, currency)} />
            <Kv k="Interés total" v={money(preview.plan.summary.totalInterest, currency)} />
            <Kv k="Total a pagar (financiado)" v={money(preview.plan.summary.totalPayments, currency)} />
            <Kv k="Tasa del período" v={`${new Dec(preview.plan.summary.periodicRate).mul(100).toFixed(4)} %`} />
            <Kv k="TEA equivalente" v={`${new Dec(preview.plan.summary.effectiveAnnualRate).mul(100).toFixed(2)} %`} />
            <Kv k="Última cuota" v={money(preview.plan.summary.lastInstallment, currency)} />
            <Kv k="Refuerzos" v={money(preview.plan.summary.totalBalloons, currency)} />
            {preview.plan.summary.irregularFirstPeriod && <p className="col-span-full text-warn">Primer período irregular: interés proporcional a los días hasta el primer vencimiento.</p>}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Submit disabled={"error" in preview}>Guardar escenario</Submit>
        <span className="text-xs text-faint">Vista previa calculada en el navegador; el servidor recalcula y valida al guardar.</span>
      </div>
    </ActionForm>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return <div><div className="text-faint">{k}</div><div className="num text-[13px] text-text">{v}</div></div>;
}
