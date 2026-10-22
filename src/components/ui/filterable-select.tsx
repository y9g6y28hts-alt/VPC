"use client";

import { useId, useMemo, useState } from "react";
import { Select } from "./field";

/** Select nativo con filtro de texto para listas largas (clientes, unidades). */
export function FilterableSelect({
  name,
  options,
  defaultValue,
  placeholder = "Seleccione…",
  required,
  invalid,
  id,
  onChange,
}: {
  name: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  id?: string;
  onChange?: (value: string) => void;
}) {
  const auto = useId();
  const [q, setQ] = useState("");
  const [value, setValue] = useState(defaultValue ?? "");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) => o.value === value || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(t));
  }, [q, options, value]);
  return (
    <div className="flex flex-col gap-1.5">
      {options.length > 8 ? (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar…"
          aria-label="Filtrar opciones"
          aria-controls={id ?? auto}
          className="h-8 rounded-md border border-line-soft bg-carbon px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-ink-2 focus:outline-none"
        />
      ) : null}
      <Select
        id={id ?? auto}
        name={name}
        value={value}
        required={required}
        aria-invalid={invalid}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {filtered.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
            {o.hint ? ` — ${o.hint}` : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}
