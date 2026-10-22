import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { cn } from "./cn";

export function Money({
  value,
  currency,
  compact,
  className,
  tone,
  sign,
}: {
  value: number | string | null | undefined;
  currency: string;
  compact?: boolean;
  className?: string;
  tone?: "auto" | "critical" | "positive" | "muted";
  sign?: boolean;
}) {
  const n = value === null || value === undefined ? null : Number(value);
  const toneClass =
    tone === "critical" ? "text-critical"
    : tone === "positive" ? "text-positive"
    : tone === "muted" ? "text-faint"
    : tone === "auto" && n !== null ? (n < 0 ? "text-critical" : n > 0 ? "text-ink" : "text-faint")
    : undefined;
  return (
    <span className={cn("num whitespace-nowrap", toneClass, className)}>
      {compact ? formatMoneyCompact(value, currency) : formatMoney(value, currency, { sign })}
    </span>
  );
}
