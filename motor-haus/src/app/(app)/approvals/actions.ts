"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionState, runAction, zText, zUuid } from "@/server/action";

export async function decideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ approval: zUuid, decision: z.enum(["approved", "rejected"]), note: zText(3, "Registre el fundamento") }), fd, async (i, db) => {
    await db.rpc("decide_approval", { p_approval: i.approval, p_decision: i.decision, p_note: i.note });
    revalidatePath("/approvals");
    return { message: i.decision === "approved" ? "Autorización registrada." : "Rechazo registrado." };
  });
}

export async function decidePayableAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(z.object({ payable: zUuid, decision: z.enum(["approved", "rejected"]), note: z.string().optional() }), fd, async (i, db) => {
    await db.rpc("decide_payable", { p_payable: i.payable, p_decision: i.decision, p_note: i.note || null });
    revalidatePath("/approvals");
    revalidatePath("/payables");
    return { message: "Decisión registrada." };
  });
}
