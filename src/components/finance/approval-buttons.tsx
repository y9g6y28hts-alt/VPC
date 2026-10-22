"use client";

import { ConfirmAction } from "@/components/ui/confirm-action";
import { Field, Textarea } from "@/components/ui/field";
import { decideApproval } from "@/server/actions/approvals";

export function ApprovalButtons({ id, title }: { id: string; title: string }) {
  return (
    <div className="flex gap-2">
      <ConfirmAction action={decideApproval} hidden={{ approval_id: id, decision: "rechazar" }} trigger="Rechazar" triggerVariant="ghost" triggerSize="sm"
        title="Rechazar solicitud" description={title} reasonLabel="Motivo del rechazo" confirmLabel="Rechazar" confirmVariant="danger" />
      <ConfirmAction action={decideApproval} hidden={{ approval_id: id, decision: "aprobar" }} trigger="Aprobar" triggerVariant="primary" triggerSize="sm"
        title="Aprobar solicitud" description={title} confirmLabel="Aprobar">
        <Field label="Comentario (opcional)" htmlFor={`note-${id}`}><Textarea id={`note-${id}`} name="note" rows={2} /></Field>
      </ConfirmAction>
    </div>
  );
}
