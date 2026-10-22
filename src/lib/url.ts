export type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Construye una URL conservando los parámetros actuales y aplicando cambios (null elimina). */
export function hrefWith(base: string, current: SearchParams, patch: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") p.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export function sortParams(sp: SearchParams, allowed: readonly string[], fallback: string, fallbackDir: "asc" | "desc" = "desc") {
  const field = param(sp, "orden");
  const dir = param(sp, "dir") === "asc" ? "asc" : param(sp, "dir") === "desc" ? "desc" : undefined;
  return {
    field: field && allowed.includes(field) ? field : fallback,
    dir: dir ?? fallbackDir,
  };
}
