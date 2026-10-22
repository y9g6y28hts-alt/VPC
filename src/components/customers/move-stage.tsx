"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/field";
import { moveOpportunity } from "@/server/actions/customers";

export function MoveStageForm({ opportunityId, currentStageId, stages }: { opportunityId: string; currentStageId: string; stages: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }> }) {
  const [stage, setStage] = useState(currentStageId);
  const lost = stages.find((s) => s.id === stage)?.is_lost;
  return (
    <ActionForm action={moveOpportunity} className="mt-3 space-y-2">
      {() => (
        <>
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          <div className="flex gap-1.5">
            <label className="sr-only" htmlFor={`stage-${opportunityId}`}>Mover a etapa</label>
            <select id={`stage-${opportunityId}`} name="stage_id" value={stage} onChange={(e) => setStage(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-carbon px-2 text-[12.5px] text-ink-2">
              {stages.filter((s) => !s.is_won).map((s) => <option key={s.id} value={s.id}>{s.is_lost ? "Marcar como perdida" : s.name}</option>)}
            </select>
            <SubmitButton size="sm" variant="secondary" disabled={stage === currentStageId}>Mover</SubmitButton>
          </div>
          {lost ? <Input name="reason" placeholder="Motivo de la pérdida (obligatorio)" className="h-8 text-[12.5px]" /> : null}
        </>
      )}
    </ActionForm>
  );
}
