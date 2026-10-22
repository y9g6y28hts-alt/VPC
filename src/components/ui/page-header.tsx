import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-line-soft pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {breadcrumbs?.length ? (
          <nav aria-label="Ruta" className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-faint">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {b.href ? (
                  <Link href={b.href} className="hover:text-ink-2">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-muted">{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 ? <ChevronRight className="size-3" aria-hidden /> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="text-[26px] font-semibold leading-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
