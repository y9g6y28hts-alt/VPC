import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { buttonClass } from "./Button";

export interface FilterDef {
  name: string; label: string; options?: Array<[string, string]>; value?: string; type?: "select" | "search" | "date"; placeholder?: string; all?: string;
}

const cls = "h-8 rounded-sm border border-line bg-ink px-2 text-[13px] text-text focus:border-accent/70 focus:outline-none";

/** Filtros en una sola fila, resueltos en el servidor por parámetros de URL. */
export function FilterBar({ filters, base, hidden = {} }: { filters: FilterDef[]; base: string; hidden?: Record<string, string> }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2" role="search">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {filters.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">{f.label}</span>
          {f.type === "search" ? (
            <input name={f.name} defaultValue={f.value} placeholder={f.placeholder} className={`${cls} w-56`} />
          ) : f.type === "date" ? (
            <input name={f.name} type="date" defaultValue={f.value} className={cls} />
          ) : (
            <select name={f.name} defaultValue={f.value ?? ""} className={cls}>
              {f.all !== undefined && <option value="">{f.all}</option>}
              {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </label>
      ))}
      <button type="submit" className={buttonClass("secondary")}><SlidersHorizontal className="size-3.5" />Aplicar</button>
      <Link href={base} className={buttonClass("ghost")}>Limpiar</Link>
    </form>
  );
}
