import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { EmptyState, Notice } from "@/components/ui/states";
import { CatalogPill, KindTag, StatusPill } from "@/components/ui/status";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { AcquireDialog, CustomerDecisionDialog, InspectionDialog, SubmitAppraisalButton } from "@/components/tradein/appraisal-actions";
import { tradeInEstimatedMargin } from "@/domain/sales/margin";
import { formatDate, formatDateTime, formatInputAmount, formatKm, formatMoney } from "@/lib/format";
import { FUEL, INSPECTION_AREA, INSPECTION_RATING, TRADEIN_DOC_STATUS, TRADEIN_STATUS, TRANSMISSION } from "@/lib/labels";
import { requirePerm } from "@/server/auth/context";
import { getToday, listBrands, listCategories } from "@/server/queries/common";
import { appraisalInspections, getAppraisal } from "@/server/queries/tradein";

export const metadata: Metadata = { title: "Tasación" };

export default async function AppraisalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("tradein.view");
  const { id } = await params;
  const t = await getAppraisal(ctx, id);
  if (!t) notFound();
  const [inspections, today] = await Promise.all([appraisalInspections(ctx, id), getToday(ctx)]);
  const editable = ["borrador", "rechazada"].includes(t.status) && ctx.perms.has("tradein.create");
  const cur = t.currency;
  const value = Number(t.accepted_value ?? t.offered_value ?? 0);
  const margin = t.expected_resale_price && value ? tradeInEstimatedMargin({ expectedResalePrice: Number(t.expected_resale_price), acceptedValue: value, attributableCosts: Number(t.estimated_repair_costs), currency: cur }) : null;
  const [approval] = await ctx.db((tx) => tx<{ status: string; decided_by: string | null; decided_at: Date | null; decision_note: string | null }[]>`
    select a.status, u.full_name as decided_by, a.decided_at, a.decision_note from public.approvals a left join public.user_profiles u on u.id = a.decided_by
    where a.entity_id = ${id} order by a.requested_at desc limit 1`);
  const acquireDeps = t.status === "aceptada_cliente" && ctx.perms.has("tradein.acquire") ? await Promise.all([listBrands(ctx), listCategories(ctx)]) : null;
  const docs = await ctx.db((tx) => tx<{ id: string; title: string; mime_type: string; size_bytes: string; is_restricted: boolean; uploaded_at: Date; uploaded_by: string | null }[]>`
    select d.id, d.title, d.mime_type, d.size_bytes, d.is_restricted, d.uploaded_at, u.full_name as uploaded_by
    from public.documents d left join public.user_profiles u on u.id = d.uploaded_by where d.entity_type = 'trade_in' and d.entity_id = ${id} order by d.uploaded_at desc`);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Trade-in", href: "/tradein" }, { label: t.number }]}
        title={`${t.brand_name} ${t.model} ${t.year_model}`}
        description={<>Tasación <span className="num">{t.number}</span> · Cliente <Link href={`/clientes/${t.customer_id}`} className="text-ink-2 hover:text-ink">{t.customer}</Link> · Tasador {t.appraiser ?? "—"}</>}
        meta={<>
          <CatalogPill catalog={TRADEIN_STATUS} value={t.status} />
          {t.deal_id ? <Link href={`/ventas/${t.deal_id}`}><StatusPill tone="info">Usado en la venta {t.deal_number}</StatusPill></Link> : null}
          {t.vehicle_id ? <Link href={`/inventario/${t.vehicle_id}`}><StatusPill tone="positive">En inventario</StatusPill></Link> : null}
        </>}
        actions={<>
          {editable ? <ButtonLink href={`/tradein/${id}/editar`}><Pencil aria-hidden /> Editar</ButtonLink> : null}
          {editable ? <SubmitAppraisalButton id={id} /> : null}
          {t.status === "aprobada" && ctx.perms.has("tradein.create") ? <CustomerDecisionDialog id={id} offered={formatInputAmount(t.offered_value, cur)} currency={cur} /> : null}
          {acquireDeps ? <AcquireDialog id={id} brands={acquireDeps[0]} categories={acquireDeps[1]} today={today} year={t.year_model} currency={cur} canPrice={ctx.perms.has("inventory.pricing.edit")} suggestedPrice={formatInputAmount(t.expected_resale_price, cur)} /> : null}
        </>}
      />
      {t.status === "rechazada" && approval ? <div className="mb-5"><Notice tone="critical">Rechazada por {approval.decided_by} el {formatDateTime(approval.decided_at)}: {approval.decision_note}. Puede corregirla y reenviarla.</Notice></div> : null}
      {t.doc_status === "con_gravamen" ? <div className="mb-5"><Notice tone="warning">El vehículo tiene gravamen o prenda declarada: verifique su levantamiento antes de aceptarlo.</Notice></div> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Panel title="Vehículo">
            <DescriptionList cols={3} items={[
              { label: "Marca / modelo", value: `${t.brand_name} ${t.model}` },
              { label: "Versión", value: t.version },
              { label: "Año-modelo", value: t.year_model },
              { label: "Kilometraje", value: formatKm(t.mileage_km) },
              { label: "Color", value: t.color },
              { label: "Combustible / transmisión", value: `${FUEL[t.fuel ?? ""] ?? "—"} · ${TRANSMISSION[t.transmission ?? ""] ?? "—"}` },
              { label: "VIN / chasis", value: <span className="font-mono text-[12.5px]">{t.vin ?? "—"}</span> },
              { label: "Chapa", value: t.plate },
              { label: "Documentación", value: TRADEIN_DOC_STATUS[t.doc_status] },
            ]} />
            {t.doc_notes ? <p className="mt-3 text-[13px] text-muted">{t.doc_notes}</p> : null}
          </Panel>
          <Panel title="Peritaje por áreas" actions={editable ? <InspectionDialog appraisalId={id} /> : null} bodyClassName="p-0">
            {inspections.length === 0 ? <EmptyState title="Sin inspecciones" description="Registre mecánica, carrocería, neumáticos e interior antes de enviar a revisión." /> : (
              <ul className="divide-y divide-line-soft">
                {inspections.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[13px]">
                    <div>
                      <p className="text-ink">{INSPECTION_AREA[i.area]} · <span className={i.rating === "malo" ? "text-critical" : i.rating === "regular" ? "text-warning" : "text-positive"}>{INSPECTION_RATING[i.rating]}</span></p>
                      {i.notes ? <p className="text-muted">{i.notes}</p> : null}
                      <p className="text-[12px] text-faint">{i.inspected_by} · {formatDateTime(i.inspected_at)}</p>
                    </div>
                    <Money value={i.repair_estimate} currency={cur} className="text-ink-2" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {t.appraiser_notes ? <Panel title="Informe del tasador"><p className="whitespace-pre-line text-[13.5px] text-ink-2">{t.appraiser_notes}</p></Panel> : null}
        </div>
        <div className="space-y-5">
          <Panel title="Valoración" description={`En ${cur}.`}>
            <dl className="space-y-2 text-[13.5px]">
              <Row label={<span className="flex items-center gap-1.5">Valor de mercado <KindTag kind="estimado" /></span>} value={formatMoney(t.market_value_estimate, cur)} />
              <p className="text-[12px] text-faint">{t.market_value_source ? `Fuente: ${t.market_value_source} · ${formatDate(t.market_value_date)}` : "Sin fuente registrada"}</p>
              <Row label="Valor ofrecido" value={formatMoney(t.offered_value, cur)} />
              <Row label="Valor aceptado" value={t.accepted_value ? formatMoney(t.accepted_value, cur) : "—"} strong />
              <Row label="Precio de reventa esperado" value={formatMoney(t.expected_resale_price, cur)} />
              <Row label="Reparaciones estimadas" value={formatMoney(t.estimated_repair_costs, cur)} />
              <Row label={<span className="flex items-center gap-1.5">Margen bruto estimado <KindTag kind="estimado" /></span>} value={margin !== null ? <span className={margin < 0 ? "text-critical" : undefined}>{formatMoney(margin, cur)}</span> : "—"} strong />
            </dl>
            <p className="mt-3 text-[12px] text-faint">Margen = reventa esperada − {t.accepted_value ? "valor aceptado" : "valor ofrecido"} − reparaciones estimadas.</p>
          </Panel>
          <DocumentsPanel documents={docs} entityType="trade_in" entityId={id} canUpload={ctx.perms.has("tradein.create")} allowRestricted={ctx.perms.has("documents.view_restricted")} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? "font-semibold text-ink" : "text-ink-2"}`}><dt>{label}</dt><dd className="num">{value}</dd></div>;
}
