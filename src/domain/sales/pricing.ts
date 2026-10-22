/**
 * Regla de aprobación comercial (espejo de rpc_deal_submit; la base de datos
 * es la autoridad). Se usa en la interfaz para advertir antes de enviar.
 *
 *   - Precio de venta por debajo del precio mínimo autorizado → aprobación.
 *   - Descuento (%) por encima del límite configurado → aprobación.
 */
import { type CurrencyCode, roundMoney } from "../money";

export interface PricingCheckInput {
  currency: CurrencyCode;
  listPrice: number;
  discount: number;
  /** Precio mínimo ya convertido a la moneda de la operación; null si no existe */
  minPrice: number | null;
  maxDiscountPct: number;
}

export interface PricingCheck {
  salePrice: number;
  discountPct: number;
  requiresApproval: boolean;
  approvalKind: "descuento" | "precio_bajo_minimo" | null;
  reason: string | null;
}

export function checkDealPricing(i: PricingCheckInput): PricingCheck {
  const salePrice = roundMoney(i.listPrice - i.discount, i.currency);
  const discountPct = i.listPrice > 0 ? Math.round((i.discount * 10000) / i.listPrice) / 100 : 0;
  if (i.minPrice !== null && salePrice < i.minPrice) {
    return {
      salePrice,
      discountPct,
      requiresApproval: true,
      approvalKind: "precio_bajo_minimo",
      reason: "El precio de venta queda por debajo del mínimo autorizado",
    };
  }
  // Comparación exacta (sin el redondeo de presentación de discountPct).
  if (i.discount * 100 > i.listPrice * i.maxDiscountPct) {
    return {
      salePrice,
      discountPct,
      requiresApproval: true,
      approvalKind: "descuento",
      reason: `El descuento (${discountPct}%) supera el límite de ${i.maxDiscountPct}%`,
    };
  }
  return { salePrice, discountPct, requiresApproval: false, approvalKind: null, reason: null };
}
