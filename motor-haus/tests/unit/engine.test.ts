import { describe, expect, it } from "vitest";
import {
  applyPrepayment, buildPlan, effectiveAnnualToMonthly, FinancingError, financedPrincipal, frenchInstallment,
  periodicRate, PlanInputs, reconcile,
} from "@/domain/finance/engine";
import { addMonths, daysBetween } from "@/domain/finance/dates";
import { Dec, parseMoney } from "@/domain/finance/money";

const base = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  system: "french",
  currency: "USD",
  principal: "100000.00",
  rateType: "effective_annual",
  rate: "0.12",
  termPeriods: 24,
  monthsPerPeriod: 1,
  startDate: "2026-01-15",
  firstDueDate: "2026-02-15",
  balloons: [],
  upfront: [],
  ...over,
});

describe("tasas", () => {
  it("convierte TEA a tasa efectiva mensual con (1+TEA)^(1/12) − 1", () => {
    const i = effectiveAnnualToMonthly("0.12");
    expect(i.toFixed(12)).toBe(new Dec(1.12).pow(new Dec(1).div(12)).minus(1).toFixed(12));
    expect(i.toFixed(6)).toBe("0.009489");
  });

  it("no trata una TNA como TEA: TNA 12 % ⇒ 1 % mensual", () => {
    expect(periodicRate("nominal_annual", "0.12", 1).toFixed(12)).toBe("0.010000000000");
    expect(periodicRate("effective_annual", "0.12", 1).lt(periodicRate("nominal_annual", "0.12", 1))).toBe(true);
  });

  it("calcula tasas para frecuencias de varios meses", () => {
    expect(periodicRate("effective_annual", "0.12", 12).toFixed(12)).toBe("0.120000000000");
    expect(periodicRate("effective_monthly", "0.01", 3).toFixed(12)).toBe("0.030301000000");
  });

  it("rechaza tasas negativas", () => {
    expect(() => periodicRate("effective_annual", "-0.01", 1)).toThrow(FinancingError);
  });
});

describe("sistema francés", () => {
  it("coincide con la fórmula cerrada C = P·i(1+i)^n/((1+i)^n−1)", () => {
    const plan = buildPlan(base());
    const i = new Dec(plan.summary.periodicRate);
    const expected = frenchInstallment("100000", i, 24).toDecimalPlaces(2);
    expect(plan.summary.installmentAmount).toBe(expected.toFixed(2));
    expect(plan.schedule).toHaveLength(24);
    expect(reconcile(plan).ok).toBe(true);
  });

  it("con tasa cero la cuota es P/n y no hay intereses", () => {
    const plan = buildPlan(base({ system: "zero_interest", rateType: "none", rate: "0", principal: "60000.00", termPeriods: 12 }));
    expect(plan.summary.installmentAmount).toBe("5000.00");
    expect(plan.summary.totalInterest).toBe("0.00");
    expect(plan.schedule.every((r) => r.interest === "0.00")).toBe(true);
    expect(reconcile(plan).ok).toBe(true);
  });

  it("absorbe el redondeo en la última cuota y cancela el saldo", () => {
    const plan = buildPlan(base({ principal: "100000.00", termPeriods: 7, system: "zero_interest", rateType: "none", rate: "0" }));
    expect(plan.summary.installmentAmount).toBe("14285.71");
    expect(plan.schedule.at(-1)!.payment).toBe("14285.74");
    expect(plan.summary.lastInstallmentAdjustment).toBe("0.03");
    expect(plan.schedule.at(-1)!.closingBalance).toBe("0.00");
  });

  it("calcula el interés sobre el saldo inicial de cada período", () => {
    const plan = buildPlan(base());
    for (const r of plan.schedule) {
      expect(new Dec(r.openingBalance).mul(r.periodRate).toDecimalPlaces(2).toFixed(2)).toBe(r.interest);
    }
  });

  it("guaraníes: importes sin decimales", () => {
    const plan = buildPlan(base({ currency: "PYG", principal: "850000000", termPeriods: 36 }));
    expect(plan.schedule.every((r) => !r.payment.includes("."))).toBe(true);
    expect(reconcile(plan).ok).toBe(true);
    expect(() => buildPlan(base({ currency: "PYG", principal: "1000.50" }))).toThrow(/decimales/);
  });
});

describe("sistema alemán", () => {
  it("amortización constante e interés sobre el saldo de cada período", () => {
    const plan = buildPlan(base({ system: "german", principal: "120000.00", termPeriods: 12, rateType: "nominal_annual", rate: "0.12" }));
    const amortizations = plan.schedule.slice(0, -1).map((r) => r.principal);
    expect(new Set(amortizations).size).toBe(1);
    expect(amortizations[0]).toBe("10000.00");
    expect(plan.schedule[0].interest).toBe("1200.00");
    expect(plan.schedule[1].interest).toBe("1100.00");
    expect(plan.schedule[11].interest).toBe("100.00");
    // cuota decreciente
    expect(new Dec(plan.schedule[0].payment).gt(plan.schedule[11].payment)).toBe(true);
    expect(reconcile(plan).ok).toBe(true);
  });
});

describe("refuerzos y pagos irregulares", () => {
  it("los refuerzos amortizan capital y reducen la cuota nivelada", () => {
    const sin = buildPlan(base());
    const con = buildPlan(base({ balloons: [{ period: 12, amount: "20000.00" }, { period: 24, amount: "20000.00" }] }));
    expect(new Dec(con.summary.installmentAmount).lt(sin.summary.installmentAmount)).toBe(true);
    const row12 = con.schedule[11];
    expect(row12.balloon).toBe("20000.00");
    expect(new Dec(row12.payment).minus(row12.balloon).toFixed(2)).toBe(con.summary.installmentAmount);
    expect(con.summary.totalBalloons).toBe("40000.00");
    expect(reconcile(con).ok).toBe(true);
    // el interés total con refuerzos es menor que sin ellos para la misma cuota de partida
    expect(new Dec(con.summary.totalPayments).minus(con.summary.totalInterest).toFixed(2)).toBe("100000.00");
  });

  it("rechaza refuerzos que provocarían amortización negativa", () => {
    expect(() => buildPlan(base({ termPeriods: 6, rate: "0.6", balloons: [{ period: 1, amount: "99000.00" }] })))
      .toThrow(/amortización negativa|no cubre/);
  });

  it("primer período irregular: fracción días/días del período y tasa (1+i)^f − 1", () => {
    const plan = buildPlan(base({ startDate: "2026-01-15", firstDueDate: "2026-02-10" }));
    const f = new Dec(daysBetween("2026-01-15", "2026-02-10")).div(daysBetween("2026-01-15", "2026-02-15")).toDecimalPlaces(10);
    expect(plan.schedule[0].periodFraction).toBe(f.toString());
    expect(plan.summary.irregularFirstPeriod).toBe(true);
    expect(new Dec(plan.schedule[0].periodRate).lt(plan.summary.periodicRate)).toBe(true);
    expect(plan.schedule[1].dueDate).toBe("2026-03-10");
    expect(reconcile(plan).ok).toBe(true);
  });

  it("los vencimientos se recortan a fin de mes desde el primer vencimiento", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    const plan = buildPlan(base({ startDate: "2025-12-31", firstDueDate: "2026-01-31", termPeriods: 3 }));
    expect(plan.schedule.map((r) => r.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("entregas iniciales variables se suman al total proyectado sin generar interés", () => {
    const plan = buildPlan(base({ upfront: [
      { dueDate: "2026-01-15", amount: "30000.00", label: "Entrega 1" },
      { dueDate: "2026-02-01", amount: "20000.00", label: "Entrega 2" },
    ] }));
    expect(plan.summary.totalUpfront).toBe("50000.00");
    expect(new Dec(plan.summary.totalProjected).minus(plan.summary.totalPayments).toFixed(2)).toBe("50000.00");
  });

  it("calendario personalizado exige que la amortización iguale el capital", () => {
    const ok = buildPlan(base({ system: "custom", principal: "30000.00", termPeriods: 3, customPrincipal: ["5000.00", "10000.00", "15000.00"] }));
    expect(ok.schedule.map((r) => r.principal)).toEqual(["5000.00", "10000.00", "15000.00"]);
    expect(() => buildPlan(base({ system: "custom", principal: "30000.00", termPeriods: 3, customPrincipal: ["5000.00", "10000.00", "14000.00"] })))
      .toThrow(/igualar el capital/);
  });
});

describe("pagos extraordinarios", () => {
  it("reducción de cuota mantiene el plazo remanente", () => {
    const plan = buildPlan(base());
    const re = applyPrepayment(plan, 6, "20000.00", "reduce_installment");
    expect(re.inputs.termPeriods).toBe(18);
    expect(new Dec(re.summary.installmentAmount).lt(plan.summary.installmentAmount)).toBe(true);
    expect(re.inputs.principal).toBe(new Dec(plan.schedule[5].closingBalance).minus(20000).toFixed(2));
    expect(reconcile(re).ok).toBe(true);
  });

  it("reducción de plazo mantiene una cuota no mayor a la original", () => {
    const plan = buildPlan(base());
    const re = applyPrepayment(plan, 6, "20000.00", "reduce_term");
    expect(re.inputs.termPeriods).toBeLessThan(18);
    expect(new Dec(re.summary.installmentAmount).lte(plan.summary.installmentAmount)).toBe(true);
    expect(reconcile(re).ok).toBe(true);
  });
});

describe("capital financiado", () => {
  it("precio + cargos − (trade-in − prenda) − entrega − otros créditos", () => {
    const p = financedPrincipal({
      negotiatedTotal: "250000", financedCharges: "1500", tradeInAccepted: "80000", tradeInLienPayoff: "10000",
      cashDownPayment: "60000", otherCredits: "5000",
    });
    expect(p.toFixed(2)).toBe("116500.00");
  });

  it("parseMoney rechaza formatos ambiguos", () => {
    expect(() => parseMoney("1.000,50", "USD")).toThrow();
    expect(parseMoney("1000.50", "USD").toFixed(2)).toBe("1000.50");
  });
});
