import Link from "next/link";
import { cn } from "./cn";

export function Tabs({ items, active }: { items: Array<{ key: string; label: string; href: string; count?: number }>; active: string }) {
  return (
    <nav aria-label="Secciones" className="scrollbar-thin -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line-soft px-1">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition-colors",
            t.key === active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink-2",
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="num rounded-sm bg-elevated px-1.5 text-[11px] text-muted">{t.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
