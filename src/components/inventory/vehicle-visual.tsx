import { cn } from "@/components/ui/cn";

/**
 * Fotografía de la unidad. Sin foto cargada se muestra un marco neutro con el
 * modelo: nunca una imagen genérica que pueda confundirse con la unidad real.
 */
export function VehicleVisual({ photoId, brand, model, className }: { photoId: string | null; brand: string; model: string; className?: string }) {
  if (photoId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por /api/fotos con control de acceso
      <img src={`/api/fotos/${photoId}`} alt={`${brand} ${model}`} loading="lazy" className={cn("h-full w-full object-cover", className)} />
    );
  }
  return (
    <div className={cn("relative flex h-full w-full items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#1c1e22,#131416)]", className)}>
      <span aria-hidden className="display select-none px-4 text-center text-[clamp(18px,3vw,30px)] font-bold uppercase tracking-[0.12em] text-white/[0.06]">
        {brand}
      </span>
      <span className="absolute bottom-2 right-3 text-[10.5px] uppercase tracking-[0.16em] text-faint">Sin fotografía</span>
    </div>
  );
}
