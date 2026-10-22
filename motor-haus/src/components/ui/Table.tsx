import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SearchParams = Record<string, string | string[] | undefined>;

export function sp(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function hrefWith(base: string, params: SearchParams, patch: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) q.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") q.delete(k); else q.set(k, v); }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Encabezado ordenable: la ordenación se resuelve en el servidor con una lista blanca. */
export function SortTh({ label, field, base, params, right, defaultDir = "desc" }: {
  label: string; field: string; base: string; params: SearchParams; right?: boolean; defaultDir?: "asc" | "desc";
}) {
  const current = sp(params, "sort");
  const dir = sp(params, "dir") ?? defaultDir;
  const active = current === field;
  const next = active ? (dir === "asc" ? "desc" : "asc") : defaultDir;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={right ? "r" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={hrefWith(base, params, { sort: field, dir: next })} className={`inline-flex items-center gap-1 hover:text-text ${active ? "text-text" : ""}`}>
        {label}<Icon aria-hidden className="size-3" />
      </Link>
    </th>
  );
}

export function orderBy(params: SearchParams, allowed: Record<string, string>, fallback: string): string {
  const key = sp(params, "sort");
  const col = key && allowed[key];
  if (!col) return fallback;
  return `${col} ${sp(params, "dir") === "asc" ? "asc" : "desc"} nulls last`;
}

export function TableWrap({ children, maxH }: { children: React.ReactNode; maxH?: string }) {
  return <div className={`overflow-auto ${maxH ?? ""}`}>{children}</div>;
}
