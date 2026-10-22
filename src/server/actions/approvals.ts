"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, type ActionState } from "@/lib/action-state";
import { guarded } from "@/server/action";

export async function decideApproval(_: ActionState, formData: FormData): Promise<ActionState> {
  return guarded(["deals.approve", "contracts.approve", "tradein.approve", "payables.approve", "expenses.approve"], async (ctx) => {
    const id = String(formData.get("approval_id") ?? "");
    const approve = formData.get("decision") === "aprobar";
    const note = String(formData.get("reason") ?? formData.get("note") ?? "").trim() || null;
    if (!approve && (!note || note.length < 5)) return fail("Indique el motivo del rechazo");
    await ctx.db((tx) => tx`select public.rpc_approval_decide(${id}, ${approve}, ${note})`);
    for (const p of ["/aprobaciones", "/ventas", "/financiaciones", "/tradein", "/compras", "/gastos", "/direccion"]) revalidatePath(p);
    return ok(approve ? "Solicitud aprobada" : "Solicitud rechazada");
  });
}
