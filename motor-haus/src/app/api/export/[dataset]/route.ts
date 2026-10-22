import { currentClaims } from "@/server/session";
import { withUser } from "@/server/db";
import { profitabilityRows } from "@/server/reports";
import { DomainError } from "@/server/errors";

const iso = /^\d{4}-\d{2}-\d{2}$/;

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Evita inyección de fórmulas en planillas.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

// Exportación sensible: requiere report.export y queda registrada en auditoría antes de entregar el archivo.
export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  const url = new URL(req.url);
  const claims = await currentClaims();
  if (!claims) return new Response("No autenticado", { status: 401 });
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "", ccy = url.searchParams.get("ccy") ?? "USD";
  if (dataset !== "profitability" || !iso.test(from) || !iso.test(to) || !/^[A-Z]{3}$/.test(ccy)) return new Response("Parámetros inválidos", { status: 400 });
  try {
    const body = await withUser(claims, async (db) => {
      const org = await db.one<{ id: string }>("select organization_id id from public.memberships where user_id = auth.uid() and active order by created_at limit 1");
      const rows = await profitabilityRows(db, { orgId: org.id, currency: ccy, from, to });
      await db.rpc("log_export", { p_org: org.id, p_dataset: dataset, p_filters: { from, to, ccy }, p_rows: rows.length });
      return csv(rows);
    });
    return new Response("﻿" + body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rentabilidad_${from}_${to}_${ccy}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    const status = e instanceof DomainError && e.code === "FORBIDDEN" ? 403 : 500;
    return new Response(e instanceof Error ? e.message : "Error", { status });
  }
}
