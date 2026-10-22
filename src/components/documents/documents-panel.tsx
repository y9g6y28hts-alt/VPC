import { FileText, Lock } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, formatNumber } from "@/lib/format";
import { UploadDocumentDialog } from "./upload-form";

export interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
  size_bytes: string;
  is_restricted: boolean;
  uploaded_at: Date;
  uploaded_by: string | null;
  type_name?: string | null;
}

export function DocumentsPanel({
  documents,
  entityType,
  entityId,
  canUpload,
  allowRestricted,
  types,
  required,
}: {
  documents: DocumentRow[];
  entityType: string;
  entityId: string;
  canUpload: boolean;
  allowRestricted?: boolean;
  types?: Array<{ id: string; name: string }>;
  required?: Array<{ id: string; name: string; is_required: boolean; present: boolean }>;
}) {
  return (
    <Panel
      title="Documentos"
      description="Almacenamiento privado. Los enlaces de descarga se generan al momento y verifican su permiso."
      actions={canUpload ? <UploadDocumentDialog entityType={entityType} entityId={entityId} types={types} allowRestricted={allowRestricted} /> : null}
      bodyClassName="p-0"
    >
      {required?.length ? (
        <ul className="flex flex-wrap gap-2 border-b border-line-soft px-4 py-3">
          {required.map((r) => (
            <li key={r.id} className={`rounded-sm border px-2 py-1 text-[12px] ${r.present ? "border-positive/30 text-positive" : r.is_required ? "border-critical/40 text-critical" : "border-line text-faint"}`}>
              {r.present ? "✓" : r.is_required ? "Falta:" : "Opcional:"} {r.name}
            </li>
          ))}
        </ul>
      ) : null}
      {documents.length === 0 ? (
        <EmptyState title="Sin documentos" description="Adjunte facturas, títulos, contratos firmados u otros respaldos." icon={<FileText aria-hidden />} />
      ) : (
        <ul className="divide-y divide-line-soft">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0 flex-1">
                <a href={`/api/documentos/${d.id}`} target="_blank" rel="noopener" className="block truncate text-sm text-ink hover:underline">
                  {d.title}
                </a>
                <p className="text-[12px] text-faint">
                  {d.type_name ? `${d.type_name} · ` : ""}
                  {formatNumber(Number(d.size_bytes) / 1024, 0)} KB · {d.uploaded_by ?? "—"} · {formatDateTime(d.uploaded_at)}
                </p>
              </div>
              {d.is_restricted ? <span title="Restringido" className="inline-flex items-center gap-1 text-[11.5px] text-warning"><Lock className="size-3.5" aria-hidden /> Restringido</span> : null}
              <a href={`/api/documentos/${d.id}?descargar=1`} className="text-[12.5px] text-muted hover:text-ink">Descargar</a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
