import { describe, expect, it } from "vitest";
import { amortize, balloonIndicesForMonths, FinancingError } from "@/domain/financing/amortization";
import { equivalentRates, monthlyRateFrom } from "@/domain/financing/rates";
import { buildDealSchedule, toRpcPayload } from "@/domain/financing/deal-schedule";
import { earlyPayoffQuote } from "@/domain/financing/payoff";
import { sumMoney } from "@/domain/money";

/** Cuota francesa calculada de forma independiente (fórmula cerrada, sin redondeo). */
function frenchPayment(P: number, i: number, n: number): number {
  return i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
}

describe("conversión de tasas", () => {
  it("TNA 18% equivale a TEM 1,5%", () => {
    expect(monthlyRateFrom(18, "nominal_annual")).toBeCloseTo(0.015, 12);
  });
  it("TEA 12% equivale a TEM (1,12)^(1/12) − 1", () => {
    expect(monthlyRateFrom(12, "effective_annual")).toBeCloseTo(Math.pow(1.12, 1 / 12) - 1, 12);
  });
  it("TEM se usa tal cual", () => {
    expect(monthlyRateFrom(2, "monthly")).toBe(0.02);
  });
  it("informa tasas equivalentes coherentes", () => {
    const eq = equivalentRates(0.015);
    expect(eq.tem).toBeCloseTo(1.5, 10);
    expect(eq.tna).toBeCloseTo(18, 10);
    expect(eq.tea).toBeCloseTo((Math.pow(1.015, 12) - 1) * 100, 10);
    // ida y vuelta TEA → TEM → TEA
    expect(equivalentRates(monthlyRateFrom(19.5618, "effective_annual")).tea).toBeCloseTo(19.5618, 8);
  });
  it("rechaza tasas negativas", () => {
    expect(() => monthlyRateFrom(-1, "monthly")).toThrow();
  });
});

describe("sistema francés", () => {
  const input = {
    principal: 100_000_000,
    currency: "PYG" as const,
    monthlyRate: 0.015,
    termMonths: 12,
    method: "frances" as const,
    firstDueDate: "2026-11-22",
  };

  it("cuota constante igual a la fórmula cerrada redondeada al guaraní", () => {
    const r = amortize(input);
    const expected = Math.round(frenchPayment(100_000_000, 0.015, 12));
    expect(r.regularPayment).toBe(expected);
    expect(r.rows).toHaveLength(12);
    for (const row of r.rows.slice(0, 11)) expect(row.total).toBe(expected);
    // la última absorbe el redondeo (diferencia mínima)
    expect(Math.abs(r.rows[11]!.total - expected)).toBeLessThanOrEqual(12);
  });

  it("el capital suma exactamente lo financiado y el saldo final es cero", () => {
    const r = amortize(input);
    expect(sumMoney(r.rows.map((x) => x.principal), "PYG")).toBe(100_000_000);
    expect(r.rows.at(-1)!.balanceAfter).toBe(0);
    expect(r.totalPayable).toBe(r.totalPrincipal + r.totalInterest);
  });

  it("interés de la primera cuota = saldo × TEM", () => {
    expect(amortize(input).rows[0]!.interest).toBe(1_500_000);
  });

  it("guaraníes sin decimales en todas las filas", () => {
    for (const row of amortize(input).rows) {
      expect(Number.isInteger(row.principal)).toBe(true);
      expect(Number.isInteger(row.interest)).toBe(true);
    }
  });

  it("vencimientos mensuales conservando el día", () => {
    const r = amortize({ ...input, firstDueDate: "2026-01-31", termMonths: 3 });
    expect(r.rows.map((x) => x.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("dólares con dos decimales y TEA", () => {
    const r = amortize({
      principal: 25_000,
      currency: "USD",
      monthlyRate: monthlyRateFrom(12, "effective_annual"),
      termMonths: 24,
      method: "frances",
      firstDueDate: "2026-12-05",
    });
    expect(sumMoney(r.rows.map((x) => x.principal), "USD")).toBe(25_000);
    for (const row of r.rows) expect(Math.round(row.total * 100)).toBeCloseTo(row.total * 100, 6);
    expect(r.regularPayment).toBeCloseTo(frenchPayment(25_000, monthlyRateFrom(12, "effective_annual"), 24), 2);
  });
});

describe("sistema alemán", () => {
  it("capital constante, interés decreciente, suma exacta", () => {
    const r = amortize({
      principal: 100_000_000,
      currency: "PYG",
      monthlyRate: 0.015,
      termMonths: 12,
      method: "aleman",
      firstDueDate: "2026-11-22",
    });
    const principals = r.rows.map((x) => x.principal);
    expect(Math.max(...principals) - Math.min(...principals)).toBeLessThanOrEqual(1);
    expect(sumMoney(principals, "PYG")).toBe(100_000_000);
    for (let k = 1; k < r.rows.length; k++) expect(r.rows[k]!.interest).toBeLessThan(r.rows[k - 1]!.interest);
    expect(r.rows[0]!.interest).toBe(1_500_000);
    expect(r.rows.at(-1)!.balanceAfter).toBe(0);
  });
});

describe("tasa cero", () => {
  it("francés: cuotas iguales sin interés", () => {
    const r = amortize({ principal: 1_200_000, currency: "PYG", monthlyRate: 0, termMonths: 12, method: "frances", firstDueDate: "2026-11-01" });
    expect(r.totalInterest).toBe(0);
    expect(new Set(r.rows.map((x) => x.total))).toEqual(new Set([100_000]));
  });
  it("reparte el resto de división en la última cuota", () => {
    const r = amortize({ principal: 1_000_000, currency: "PYG", monthlyRate: 0, termMonths: 3, method: "frances", firstDueDate: "2026-11-01" });
    expect(r.rows.map((x) => x.principal)).toEqual([333_333, 333_333, 333_334]);
  });
  it("alemán con tasa cero equivale a cuotas de capital", () => {
    const r = amortize({ principal: 900_000, currency: "PYG", monthlyRate: 0, termMonths: 3, method: "aleman", firstDueDate: "2026-11-01" });
    expect(r.rows.map((x) => x.total)).toEqual([300_000, 300_000, 300_000]);
  });
});

describe("refuerzos", () => {
  const base = {
    principal: 60_000_000,
    currency: "PYG" as const,
    monthlyRate: 0.015,
    termMonths: 12,
    firstDueDate: "2026-01-10",
    balloons: [
      { index: 6, amount: 10_000_000 },
      { index: 12, amount: 10_000_000 },
    ],
  };

  it("francés: cuota regular calculada con el valor presente de los refuerzos", () => {
    const r = amortize({ ...base, method: "frances" });
    const pv = 10_000_000 / Math.pow(1.015, 6) + 10_000_000 / Math.pow(1.015, 12);
    expect(r.regularPayment).toBe(Math.round(frenchPayment(60_000_000 - pv, 0.015, 12)));
    expect(r.rows.filter((x) => x.kind === "refuerzo")).toHaveLength(2);
    expect(sumMoney(r.rows.map((x) => x.principal), "PYG")).toBe(60_000_000);
    expect(r.rows.at(-1)!.balanceAfter).toBe(0);
  });

  it("alemán: los refuerzos amortizan capital adicional", () => {
    const r = amortize({ ...base, method: "aleman" });
    expect(sumMoney(r.rows.map((x) => x.principal), "PYG")).toBe(60_000_000);
    expect(r.rows.find((x) => x.kind === "refuerzo")!.interest).toBe(0);
  });

  it("refuerzos estacionales de julio y diciembre", () => {
    expect(balloonIndicesForMonths("2026-01-10", 12, [7, 12])).toEqual([7, 12]);
    expect(balloonIndicesForMonths("2026-11-05", 6, [12])).toEqual([2]);
  });

  it("rechaza refuerzos que cubren todo el capital", () => {
    expect(() => amortize({ ...base, method: "frances", balloons: [{ index: 3, amount: 60_000_000 }] })).toThrow(FinancingError);
  });

  it("rechaza refuerzos fuera del plazo", () => {
    expect(() => amortize({ ...base, method: "frances", balloons: [{ index: 13, amount: 1_000 }] })).toThrow(/entre la cuota 1/);
  });
});

describe("validaciones", () => {
  const ok = { principal: 1_000_000, currency: "PYG" as const, monthlyRate: 0.01, termMonths: 6, method: "frances" as const, firstDueDate: "2026-11-01" };
  it.each([
    [{ principal: 0 }, /mayor que cero/],
    [{ principal: 1000.5 }, /decimales/],
    [{ termMonths: 0 }, /plazo/],
    [{ termMonths: 121 }, /plazo/],
    [{ monthlyRate: -0.01 }, /tasa/],
    [{ firstDueDate: "2026-02-30" }, /Fecha/],
  ])("rechaza %o", (patch, msg) => {
    expect(() => amortize({ ...ok, ...patch })).toThrow(msg);
  });
});

describe("cronograma de operación", () => {
  it("combina trade-in, entrega inicial y financiación", () => {
    const s = buildDealSchedule({
      currency: "PYG",
      listPrice: 300_000_000,
      discount: 10_000_000,
      tradeInValue: 50_000_000,
      downPayment: 40_000_000,
      operationDate: "2026-10-22",
      financing: { method: "frances", ratePercent: 18, rateConvention: "nominal_annual", termMonths: 24, firstDueDate: "2026-11-22" },
    });
    expect(s.salePrice).toBe(290_000_000);
    expect(s.financedAmount).toBe(200_000_000);
    expect(s.rows[0]).toMatchObject({ kind: "entrega_usado", principal: 50_000_000, interest: 0 });
    expect(s.rows[1]).toMatchObject({ kind: "entrega_inicial", principal: 40_000_000, interest: 0 });
    expect(s.rows.filter((r) => r.kind === "cuota")).toHaveLength(24);
    expect(sumMoney(s.rows.map((r) => r.principal), "PYG")).toBe(290_000_000);
    expect(s.totalPayable).toBe(290_000_000 + s.totalInterest);
    const payload = toRpcPayload(s);
    expect(payload.plan.total_interest).toBe(s.totalInterest);
    expect(payload.schedule).toHaveLength(26);
  });

  it("contado: una sola fila sin plan de financiación", () => {
    const s = buildDealSchedule({ currency: "USD", listPrice: 85_000, discount: 0, tradeInValue: 0, downPayment: 85_000, operationDate: "2026-10-22" });
    expect(s.financedAmount).toBe(0);
    expect(s.plan.method).toBe("sin_financiacion");
    expect(s.rows).toEqual([expect.objectContaining({ kind: "entrega_inicial", description: "Pago de contado", total: 85_000 })]);
  });

  it("exige condiciones si queda saldo a financiar", () => {
    expect(() =>
      buildDealSchedule({ currency: "PYG", listPrice: 100, discount: 0, tradeInValue: 0, downPayment: 50, operationDate: "2026-10-22" }),
    ).toThrow(/condiciones de financiación/);
  });

  it("rechaza entregas que superan el precio", () => {
    expect(() =>
      buildDealSchedule({ currency: "PYG", listPrice: 100, discount: 0, tradeInValue: 60, downPayment: 60, operationDate: "2026-10-22" }),
    ).toThrow(/superan/);
  });

  it("rechaza un primer vencimiento anterior a la operación", () => {
    expect(() =>
      buildDealSchedule({
        currency: "PYG", listPrice: 1_000_000, discount: 0, tradeInValue: 0, downPayment: 0, operationDate: "2026-10-22",
        financing: { method: "frances", ratePercent: 0, rateConvention: "monthly", termMonths: 2, firstDueDate: "2026-10-01" },
      }),
    ).toThrow(/primer vencimiento/);
  });
});

describe("cancelación anticipada", () => {
  it("cobra lo vencido y el capital futuro, sin intereses futuros", () => {
    const q = earlyPayoffQuote(
      [
        { dueDate: "2026-09-01", principal: 900, interest: 100, fee: 0, outstanding: 0 },
        { dueDate: "2026-10-01", principal: 910, interest: 90, fee: 0, outstanding: 1000 },
        { dueDate: "2026-11-01", principal: 920, interest: 80, fee: 0, outstanding: 1000 },
        { dueDate: "2026-12-01", principal: 930, interest: 70, fee: 0, outstanding: 600 },
      ],
      "2026-10-22",
      "PYG",
    );
    expect(q.overdueAmount).toBe(1000);
    // nov: 920 capital, 80 interés condonado; dic: pagó 400 → cubrió 70 de interés, quedan 600 de capital
    expect(q.futurePrincipal).toBe(920 + 600);
    expect(q.waivedInterest).toBe(80);
    expect(q.payoffAmount).toBe(1000 + 1520);
  });
});
