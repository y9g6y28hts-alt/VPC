import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * Definición de un indicador (fórmula y fuente). Usa la API nativa
 * `popover` del navegador: sin JavaScript adicional y accesible por teclado.
 */
export function InfoTip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={`Definición: ${title}`}
        className="inline-flex size-5 items-center justify-center rounded-sm text-faint hover:bg-elevated hover:text-ink-2"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <div
        id={id}
        popover="auto"
        className="m-auto w-[min(92vw,380px)] rounded-lg border border-line bg-elevated p-4 text-left text-[13px] leading-relaxed text-ink-2 shadow-[var(--shadow-pop)]"
      >
        <p className="mb-1.5 text-[13px] font-semibold text-ink">{title}</p>
        {children}
      </div>
    </>
  );
}
