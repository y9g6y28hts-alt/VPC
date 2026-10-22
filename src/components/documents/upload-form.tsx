"use client";

import { Upload } from "lucide-react";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { uploadDocument } from "@/server/actions/documents";

export function UploadDocumentDialog({
  entityType,
  entityId,
  types = [],
  allowRestricted,
}: {
  entityType: string;
  entityId: string;
  types?: Array<{ id: string; name: string }>;
  allowRestricted?: boolean;
}) {
  return (
    <FormDialog
      action={uploadDocument}
      trigger={<><Upload aria-hidden /> Adjuntar</>}
      triggerSize="sm"
      title="Adjuntar documento"
      description="PDF, JPG, PNG o WEBP. Máximo 25 MB. Se guarda en almacenamiento privado."
      submitLabel="Adjuntar"
    >
      {(s) => (
        <>
          <input type="hidden" name="entity_type" value={entityType} />
          <input type="hidden" name="entity_id" value={entityId} />
          {types.length ? (
            <Field label="Tipo de documento" htmlFor="doc-type">
              <Select id="doc-type" name="document_type_id" defaultValue="">
                <option value="">Otro</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Título" htmlFor="doc-title" hint="Vacío = nombre del archivo">
            <Input id="doc-title" name="title" />
          </Field>
          <Field label="Archivo" htmlFor="doc-file" required error={s.fieldErrors?.file}>
            <input id="doc-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required
              className="block w-full text-[13px] text-muted file:mr-3 file:h-9 file:rounded-md file:border file:border-line file:bg-elevated file:px-3 file:text-ink" />
          </Field>
          {allowRestricted ? (
            <Checkbox name="is_restricted" label="Restringido (sólo roles autorizados: dirección, administración, finanzas, auditoría)" />
          ) : null}
        </>
      )}
    </FormDialog>
  );
}
