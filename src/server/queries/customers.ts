import "server-only";
import type { AppContext } from "@/server/auth/context";
import { DOC_TYPE } from "@/lib/labels";

/** Opciones de clientes visibles para el usuario (RLS aplica). */
export async function customerOptions(ctx: AppContext) {
  const rows = await ctx.db((tx) => tx<{ id: string; full_name: string; doc_type: string; doc_number: string }[]>`
    select id, full_name, doc_type, doc_number from public.customers where org_id = ${ctx.org.id} order by full_name limit 2000`);
  return rows.map((c) => ({ value: c.id, label: c.full_name, hint: `${DOC_TYPE[c.doc_type] ?? c.doc_type} ${c.doc_number}` }));
}
