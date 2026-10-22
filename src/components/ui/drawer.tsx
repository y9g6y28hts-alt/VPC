import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Ficha lateral controlada por la URL (p. ej. ?unidad=<id>): se puede
 * compartir, recargar y cerrar con el botón Atrás del navegador.
 */
export function Drawer({
  title,
  subtitle,
  closeHref,
  children,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  closeHref: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <Link href={closeHref} scroll={false} aria-label="Cerrar ficha" className="absolute inset-0 bg-black/55" />
      <aside className="scrollbar-thin relative flex h-full w-full max-w-[640px] flex-col overflow-y-auto border-l border-line bg-surface shadow-[var(--shadow-pop)]">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line-soft bg-surface/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
            {subtitle ? <div className="mt-1 text-[13px] text-muted">{subtitle}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <Link href={closeHref} scroll={false} aria-label="Cerrar" className="rounded-md p-1.5 text-faint hover:bg-elevated hover:text-ink">
              <X className="size-5" />
            </Link>
          </div>
        </div>
        <div className="flex-1 px-5 py-5">{children}</div>
      </aside>
    </div>
  );
}
