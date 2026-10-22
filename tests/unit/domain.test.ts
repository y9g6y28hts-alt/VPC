import { describe, expect, it } from "vitest";
import { convert, fromMinor, isValidAmount, roundHalfUp, roundMoney, sumMoney, toMinor } from "@/domain/money";
import { addDays, addMonths, daysBetween, endOfMonth, isIsoDate, todayIn } from "@/domain/dates";
import { agingBucket, daysOverdue, DEFAULT_AGING_BUCKETS } from "@/domain/collections/aging";
import { collectionPriority } from "@/domain/collections/priority";
import { checkDealPricing } from "@/domain/sales/pricing";
import { operationMargin, tradeInEstimatedMargin } from "@/domain/sales/margin";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, PermissionSet } from "@/domain/permissions";

describe("moneda", () => {
  it("redondeo comercial mitad hacia arriba", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundMoney(1.005, "USD")).toBe(1.01);
  });
  it("PYG no admite decimales; USD admite dos", () => {
    expect(isValidAmount(1000, "PYG")).toBe(true);
    expect(isValidAmount(1000.5, "PYG")).toBe(false);
    expect(isValidAmount(10.25, "USD")).toBe(true);
    expect(isValidAmount(10.255, "USD")).toBe(false);
  });
  it("suma en unidades menores sin error de coma flotante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2], "USD")).toBe(0.3);
    expect(toMinor(19.99, "USD")).toBe(1999);
    expect(fromMinor(1999, "USD")).toBe(19.99);
  });
  it("conversión entre monedas con tipo explícito, redondeada a destino", () => {
    expect(convert(1000, 7350.5, "PYG")).toBe(7_350_500);
    expect(convert(7_350_500, 1 / 7350.5, "USD")).toBe(1000);
    expect(() => convert(1, 0, "PYG")).toThrow();
  });
});

describe("fechas", () => {
  it("valida fechas calendario", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });
  it("suma meses con día de referencia", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonths("2027-12-15", 2)).toBe("2028-02-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });
  it("diferencia de días y fin de mes", () => {
    expect(daysBetween("2026-10-01", "2026-10-22")).toBe(21);
    expect(daysBetween("2026-10-22", "2026-10-01")).toBe(-21);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
  it("hoy en Asunción (UTC−3)", () => {
    expect(todayIn("America/Asuncion", new Date("2026-10-23T02:30:00Z"))).toBe("2026-10-22");
    expect(todayIn("America/Asuncion", new Date("2026-10-23T03:30:00Z"))).toBe("2026-10-23");
  });
});

describe("mora", () => {
  it.each([
    [0, "Al día"],
    [1, "1–30 días"],
    [30, "1–30 días"],
    [31, "31–60 días"],
    [60, "31–60 días"],
    [61, "61–90 días"],
    [90, "61–90 días"],
    [91, "Más de 90 días"],
    [720, "Más de 90 días"],
  ])("%i días → %s", (days, label) => {
    expect(agingBucket(days, DEFAULT_AGING_BUCKETS).label).toBe(label);
  });
  it("una cuota pagada nunca está vencida", () => {
    expect(daysOverdue("2026-01-01", "2026-10-22", 0)).toBe(0);
    expect(daysOverdue("2026-10-01", "2026-10-22", 1)).toBe(21);
    expect(daysOverdue("2026-11-01", "2026-10-22", 1)).toBe(0);
  });
  it("prioriza promesas incumplidas sobre importes grandes", () => {
    const broken = collectionPriority({ overdueAmountBase: 1_000_000, maxDaysOverdue: 5, brokenPromises: 1, nextActionDue: false });
    const big = collectionPriority({ overdueAmountBase: 900_000_000, maxDaysOverdue: 120, brokenPromises: 0, nextActionDue: false });
    expect(broken.score).toBeGreaterThan(big.score);
    expect(broken.reasons[0]).toMatch(/incumplida/);
  });
});

describe("regla de descuentos", () => {
  const base = { currency: "PYG" as const, listPrice: 200_000_000, minPrice: 185_000_000, maxDiscountPct: 3 };
  it("sin aprobación dentro del límite", () => {
    expect(checkDealPricing({ ...base, discount: 6_000_000 })).toMatchObject({ requiresApproval: false, discountPct: 3 });
  });
  it("descuento sobre el límite requiere aprobación", () => {
    expect(checkDealPricing({ ...base, discount: 6_000_001 })).toMatchObject({ requiresApproval: true, approvalKind: "descuento" });
  });
  it("precio bajo el mínimo prevalece", () => {
    expect(checkDealPricing({ ...base, discount: 20_000_000 }).approvalKind).toBe("precio_bajo_minimo");
  });
});

describe("márgenes", () => {
  it("distingue margen estimado, realizado y gastos pendientes", () => {
    const costs = [
      { amountBase: 150_000_000, isEstimate: false },
      { amountBase: 5_000_000, isEstimate: false },
      { amountBase: 2_000_000, isEstimate: true },
    ];
    const pending = operationMargin(180_000_000, costs, "PYG", true);
    expect(pending).toMatchObject({ registeredCosts: 155_000_000, pendingCosts: 2_000_000, estimatedMargin: 23_000_000, realizedMargin: null });
    const closed = operationMargin(180_000_000, costs.slice(0, 2), "PYG", true);
    expect(closed.realizedMargin).toBe(25_000_000);
    expect(operationMargin(180_000_000, costs.slice(0, 2), "PYG", false).realizedMargin).toBeNull();
  });
  it("margen de trade-in = reventa − aceptación − costes", () => {
    expect(tradeInEstimatedMargin({ expectedResalePrice: 95_000_000, acceptedValue: 80_000_000, attributableCosts: 4_500_000, currency: "PYG" })).toBe(10_500_000);
  });
});

describe("permisos", () => {
  it("todos los roles usan permisos existentes", () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });
  it("vendedor no ve costes ni aprueba descuentos ni toca pagos", () => {
    const s = new PermissionSet(ROLE_PERMISSIONS.vendedor);
    expect(s.has("inventory.costs.view")).toBe(false);
    expect(s.has("deals.approve")).toBe(false);
    expect(s.any("payments.confirm", "payments.reverse", "payments.register")).toBe(false);
    expect(s.has("inventory.costs.edit_history")).toBe(false);
  });
  it("auditor sólo tiene permisos de lectura y exportación", () => {
    for (const p of ROLE_PERMISSIONS.auditor) expect(p).toMatch(/\.view(_all|_restricted)?$|^reports\.export$/);
  });
  it("administrador técnico no accede a datos financieros", () => {
    const s = new PermissionSet(ROLE_PERMISSIONS.admin_tecnico);
    expect(s.any("dashboard.view", "payments.view", "cash.view", "inventory.costs.view")).toBe(false);
  });
});
