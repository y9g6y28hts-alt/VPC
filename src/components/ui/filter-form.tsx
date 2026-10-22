"use client";

import { useRouter, usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { Search } from "lucide-react";

/**
 * Formulario de filtros por URL (GET). Los selects aplican al cambiar; el texto
 * al presionar Enter. Los filtros quedan en la URL: se pueden compartir.
 */
export function FilterForm({ children, keep = [] }: { children: ReactNode; keep?: Array<[string, string | undefined]> }) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => {
    const fd = new FormData(ref.current!);
    const p = new URLSearchParams();
    for (const [k, v] of keep) if (v) p.set(k, v);
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v.trim() !== "") p.set(k, v.trim());
    router.push(p.toString() ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  return (
    <form
      ref={ref}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onChange={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "SELECT" || (t as HTMLInputElement).type === "checkbox") submit();
      }}
      className="mb-4 flex flex-wrap items-end gap-2"
    >
      {children}
    </form>
  );
}

export function SearchInput({ name = "q", defaultValue, placeholder }: { name?: string; defaultValue?: string; placeholder: string }) {
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-faint focus:border-ink-2 focus:outline-none"
      />
    </label>
  );
}

export function FilterSelect({
  name,
  label,
  defaultValue,
  options,
  allLabel = "Todos",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="h-9 min-w-36 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2 focus:border-ink-2 focus:outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
