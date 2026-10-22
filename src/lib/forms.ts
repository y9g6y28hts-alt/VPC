import { z } from "zod";
import { isIsoDate } from "@/domain/dates";

/**
 * Interpreta números escritos en formato paraguayo:
 *   "365.000.000" → 365000000   "45.000,50" → 45000.5   "1500" → 1500   "12,5" → 12.5
 * Devuelve NaN si el texto no es un número válido.
 */
export function parseLocaleNumber(input: string): number {
  const s = input.replace(/\s|Gs\.?|US\$|USD|₲|%/gi, "").trim();
  if (!s) return NaN;
  let normalized: string;
  if (s.includes(",")) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, "");
  } else {
    normalized = s;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Number(normalized);
}

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const zNumber = (msg = "Ingrese un número válido") =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : parseLocaleNumber(v)) : v), z.number({ error: msg }).refine(Number.isFinite, msg));

export const zMoney = (msg = "Ingrese un importe válido") => zNumber(msg).refine((n) => n >= 0, "El importe no puede ser negativo");
export const zPositiveMoney = (msg = "Ingrese un importe mayor que cero") => zNumber(msg).refine((n) => n > 0, msg);

export const zOptionalMoney = () =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : parseLocaleNumber(v)) : v),
    z.number().refine((n) => Number.isFinite(n) && n >= 0, "Importe inválido").optional());

export const zInt = (msg = "Ingrese un número entero") =>
  z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? undefined : parseLocaleNumber(v)) : v), z.number({ error: msg }).int(msg));

export const zDate = (msg = "Ingrese una fecha válida") => z.string({ error: msg }).refine(isIsoDate, msg);
export const zOptionalDate = () => z.preprocess(emptyToUndef, z.string().refine(isIsoDate, "Fecha inválida").optional());

export const zText = (min = 1, msg = "Este campo es obligatorio") => z.string({ error: msg }).trim().min(min, msg);
export const zOptionalText = () => z.preprocess(emptyToUndef, z.string().trim().optional());
export const zUuid = (msg = "Seleccione una opción") => z.string({ error: msg }).uuid(msg);
export const zOptionalUuid = () => z.preprocess(emptyToUndef, z.string().uuid().optional());
export const zCheckbox = () => z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const zCurrency = () => z.enum(["PYG", "USD"], { error: "Seleccione la moneda" });
