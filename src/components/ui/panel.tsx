import type { ReactNode } from "react";
import { cn } from "./cn";

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-lg border border-line-soft bg-surface", className)}>
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[14px] font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[12.5px] text-faint">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function DescriptionList({ items, cols = 2 }: { items: Array<{ label: string; value: ReactNode; hint?: string }>; cols?: 1 | 2 | 3 }) {
  const map = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" };
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", map[cols])}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[12px] text-faint">{it.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink" title={it.hint}>
            {it.value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
