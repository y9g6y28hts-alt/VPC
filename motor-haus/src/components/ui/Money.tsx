import { money, pct } from "@/lib/format";

export function Money({ value, currency, className = "", compact, sign, muted }: {
  value: string | number | null | undefined; currency: string; className?: string; compact?: boolean; sign?: boolean; muted?: boolean;
}) {
  const n = value === null || value === undefined ? null : Number(value);
  const tone = muted ? "text-muted" : n !== null && n < 0 ? "text-risk" : "";
  return <span className={`num ${tone} ${className}`}>{money(value, currency, { compact, sign })}</span>;
}

export function Pct({ value, digits = 1, className = "" }: { value: string | number | null | undefined; digits?: number; className?: string }) {
  return <span className={`num ${className}`}>{pct(value, digits)}</span>;
}
