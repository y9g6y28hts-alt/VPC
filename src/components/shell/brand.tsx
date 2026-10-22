import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";
import { cn } from "@/components/ui/cn";

/**
 * Marca de Da Silva Automotores. Usa el archivo ORIGINAL del logo si está en
 * public/brand/ (logo.svg o logo.png). Si no está, muestra sólo el nombre en
 * texto, sin inventar ningún emblema (ver public/brand/README.md).
 */
const LOGO = (["logo.svg", "logo.png", "logo.webp"] as const).find((f) =>
  existsSync(join(process.cwd(), "public", "brand", f)),
);

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (LOGO) {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <Image
          src={`/brand/${LOGO}`}
          alt="Da Silva Automotores"
          width={compact ? 32 : 140}
          height={compact ? 32 : 40}
          className="h-auto max-h-10 w-auto object-contain"
          priority
        />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-col leading-none", className)} aria-label="Da Silva Automotores">
      <span className="display text-[17px] font-bold tracking-[0.06em] text-ink">DA SILVA</span>
      {!compact ? <span className="mt-1 text-[9.5px] font-semibold tracking-[0.34em] text-muted">AUTOMOTORES</span> : null}
    </span>
  );
}

export const HAS_ORIGINAL_LOGO = Boolean(LOGO);
