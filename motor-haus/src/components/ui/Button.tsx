import Link from "next/link";

export type Variant = "primary" | "secondary" | "ghost" | "danger";

export const buttonClass = (variant: Variant = "secondary", size: "sm" | "md" = "md") => {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
  const sz = size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]";
  const v = {
    primary: "bg-accent text-brand hover:bg-[#dcdcf5]",
    secondary: "border border-line bg-raised text-text hover:border-faint",
    ghost: "text-text-2 hover:bg-raised hover:text-text",
    danger: "border border-risk/50 bg-risk-bg text-risk hover:border-risk",
  }[variant];
  return `${base} ${sz} ${v}`;
};

export function LinkButton({ href, children, variant = "secondary", size = "md" }: {
  href: string; children: React.ReactNode; variant?: Variant; size?: "sm" | "md";
}) {
  return <Link href={href} className={buttonClass(variant, size)}>{children}</Link>;
}
