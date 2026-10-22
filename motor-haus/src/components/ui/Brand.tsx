// Escudo y nombre de Motor Haus: águila blanca sobre el azul institucional.
export const LOGO_SRC = "/brand/motor-haus-logo.png";

export function BrandMark({ size = 28, name = true, className = "" }: { size?: number; name?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_SRC} width={size} height={size} alt={name ? "" : "Motor Haus"} className="shrink-0 rounded-full" />
      {name && <span className="text-[12px] font-semibold uppercase tracking-[0.28em] text-white">Motor Haus</span>}
    </span>
  );
}
