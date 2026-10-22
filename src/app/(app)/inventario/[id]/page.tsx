import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Handshake, Pencil } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { EmptyState, Notice } from "@/components/ui/states";
import { CatalogPill, KindTag, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, TFootRow, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { VehicleVisual } from "@/components/inventory/vehicle-visual";
import { ReserveDialog } from "@/components/inventory/reserve-dialog";
import {
  AddCostDialog, CancelReservationButton, ConfirmCostButton, CoverButton, PhotoUploadDialog, PricingForm, StatusChangeForm, WithdrawButton,
} from "@/components/inventory/vehicle-actions";
import { addDays } from "@/domain/dates";
import { formatDate, formatDateTime, formatKm, formatNumber, vehicleName } from "@/lib/format";
import {
  COMMERCIAL_STATUS, CONTRACT_STATUS_VEHICLE, COST_KIND, DEAL_STATUS, DOC_STATUS, FUEL, ORIGIN, PHYSICAL_STATUS, PREP_STATUS,
  RESERVATION_STATUS, TRANSMISSION,
} from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { getSettings, getToday, listCashAccounts, listSuppliers } from "@/server/queries/common";
import { customerOptions } from "@/server/queries/customers";
import {
  getVehicle, vehicleCosts, vehicleDeals, vehicleDocuments, vehiclePhotos, vehicleRequiredDocs, vehicleReservations, vehicleStatusHistory,
} from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Ficha de unidad" };

const DIMENSION_LABEL: Record<string, string> = {
  physical: "Situación física", commercial: "Disponibilidad", contract: "Situación contractual", prep: "Preparación", doc: "Documentación",
};
const CATALOG_BY_DIM: Record<string, Record<string, { label: string }>> = {
  physical: PHYSICAL_STATUS, commercial: COMMERCIAL_STATUS, contract: CONTRACT_STATUS_VEHICLE, prep: PREP_STATUS, doc: DOC_STATUS,
};

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("inventory.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab = param(sp, "tab") ?? "resumen";
  const v = await getVehicle(ctx, id);
  if (!v) notFound();

  const canCosts = ctx.perms.has("inventory.costs.view");
  const canEdit = ctx.perms.has("inventory.edit");
  const canReserve = ctx.perms.has("reservations.manage") && v.commercial_status === "disponible";
  const canSell = ctx.perms.has("deals.create") && ["disponible", "reservado"].includes(v.commercial_status);
  const today = await getToday(ctx);
  const base = v.base_currency;
  const label = `${v.stock_code} · ${v.brand} ${v.model} ${v.version ?? ""} ${v.year_model}`;
  const href = (t: string) => `/inventario/${id}?tab=${t}`;

  const [photos, reservations, deals] = await Promise.all([vehiclePhotos(ctx, id), vehicleReservations(ctx, id), vehicleDeals(ctx, id)]);
  const reserveDeps = canReserve ? await Promise.all([getSettings(ctx), customerOptions(ctx), listCashAccounts(ctx)]) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inventario", href: "/inventario" }, { label: v.stock_code }]}
        title={vehicleName(v.brand, v.model)}
        description={`${v.version ?? ""} · ${v.year_model} · ${v.condition === "nuevo" ? "0 km" : formatKm(v.mileage_km)} · ${v.color ?? "color sin registrar"}`}
        meta={
          <>
            <CatalogPill catalog={COMMERCIAL_STATUS} value={v.commercial_status} />
            <CatalogPill catalog={PHYSICAL_STATUS} value={v.physical_status} />
            <CatalogPill catalog={CONTRACT_STATUS_VEHICLE} value={v.contract_status} />
            {v.reserved_for ? <span className="text-[12.5px] text-warning">Reservada para {v.reserved_for} hasta {formatDateTime(v.reserved_until)}</span> : null}
          </>
        }
        actions={
          <>
            {canEdit && v.commercial_status === "disponible" ? <WithdrawButton vehicleId={id} withdraw /> : null}
            {canEdit && v.commercial_status === "retirado" ? <WithdrawButton vehicleId={id} withdraw={false} /> : null}
            {canEdit ? <ButtonLink href={`/inventario/${id}/editar`}><Pencil aria-hidden /> Editar ficha</ButtonLink> : null}
            {canReserve && reserveDeps ? (
              <ReserveDialog vehicleId={id} vehicleLabel={label} customers={reserveDeps[1]} accounts={reserveDeps[2]}
                defaultExpiry={addDays(today, reserveDeps[0].reservation_default_days)} canRegisterDeposit={ctx.perms.has("payments.register")} />
            ) : null}
            {canSell ? <ButtonLink href={`/ventas/nueva?unidad=${id}`} variant="primary"><Handshake aria-hidden /> Nueva venta</ButtonLink> : null}
          </>
        }
      />

      <Tabs
        active={tab}
        items={[
          { key: "resumen", label: "Resumen", href: href("resumen") },
          ...(canCosts ? [{ key: "costes", label: "Costes y margen", href: href("costes") }] : []),
          { key: "estados", label: "Estados", href: href("estados") },
          { key: "comercial", label: "Reservas y ventas", href: href("comercial"), count: reservations.length + deals.length },
          { key: "documentos", label: "Documentos", href: href("documentos") },
        ]}
      />

      {tab === "resumen" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
          <div className="space-y-5">
            <Panel title="Fotografías" actions={canEdit ? <PhotoUploadDialog vehicleId={id} /> : null} bodyClassName="p-3">
              {photos.length ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((p) => (
                    <li key={p.id} className="relative aspect-[4/3] overflow-hidden rounded-md border border-line-soft">
                      <VehicleVisual photoId={p.id} brand={v.brand} model={v.model} />
                      {p.is_cover ? <span className="absolute left-1.5 top-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 text-[10.5px] text-ink">Portada</span> : null}
                      {!p.is_cover && canEdit ? <div className="absolute right-1.5 top-1.5"><CoverButton photoId={p.id} vehicleId={id} /></div> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="aspect-[16/7] overflow-hidden rounded-md border border-line-soft">
                  <VehicleVisual photoId={null} brand={v.brand} model={v.model} />
                </div>
              )}
            </Panel>
            <Panel title="Ficha técnica">
              <DescriptionList
                cols={3}
                items={[
                  { label: "Código interno", value: <span className="num">{v.stock_code}</span> },
                  { label: "Marca / categoría", value: `${v.brand}${v.category ? ` · ${v.category}` : ""}` },
                  { label: "Año fabricación / modelo", value: `${v.year_manufacture} / ${v.year_model}` },
                  { label: "VIN / chasis", value: <span className="font-mono text-[12.5px]">{v.vin ?? "—"}</span> },
                  { label: "N.º de motor", value: v.engine_number },
                  { label: "Chapa", value: v.plate },
                  { label: "Kilometraje", value: formatKm(v.mileage_km) },
                  { label: "Combustible", value: FUEL[v.fuel] ?? v.fuel },
                  { label: "Transmisión", value: TRANSMISSION[v.transmission] ?? v.transmission },
                  { label: "Color", value: v.color },
                  { label: "Condición", value: v.condition === "nuevo" ? "Nuevo" : "Usado" },
                  { label: "Origen", value: ORIGIN[v.origin] ?? v.origin },
                  { label: "Sucursal", value: v.branch },
                  { label: "Ubicación", value: v.location },
                  { label: "Responsable", value: v.responsible },
                ]}
              />
              {v.description ? <p className="mt-4 whitespace-pre-line border-t border-line-soft pt-4 text-[13px] text-ink-2">{v.description}</p> : null}
            </Panel>
          </div>
          <div className="space-y-5">
            <Panel title="Precio">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] text-faint">Precio de lista</p>
                  <Money value={v.list_price} currency={v.price_currency} className="display text-[26px] font-semibold text-ink" />
                </div>
                <div className="text-right">
                  <p className="text-[12px] text-faint">Mínimo autorizado</p>
                  <Money value={v.min_price} currency={v.price_currency} className="text-[15px] text-ink-2" />
                </div>
              </div>
              {ctx.perms.has("inventory.pricing.edit") ? (
                <div className="mt-4 border-t border-line-soft pt-4">
                  <PricingForm vehicleId={id} currency={v.price_currency} list={v.list_price} min={v.min_price} />
                </div>
              ) : null}
            </Panel>
            {canCosts ? (
              <Panel title="Economía de la unidad" description={`Importes en ${base}. Los estimados aún no tienen factura.`}>
                <dl className="space-y-2.5 text-[13.5px]">
                  <Row label="Coste de adquisición" value={<Money value={v.acquisition_cost_base} currency={base} />} />
                  <Row label="Otros costes registrados" value={<Money value={Number(v.registered_cost_base ?? 0) - Number(v.acquisition_cost_base ?? 0)} currency={base} />} />
                  <Row label={<span className="flex items-center gap-1.5">Costes estimados <KindTag kind="estimado" /></span>} value={<Money value={v.estimated_cost_base} currency={base} />} />
                  <Row strong label="Coste total" value={<Money value={v.total_cost_base} currency={base} />} />
                  <Row label={`Precio de lista en ${base}`} value={v.price_fx_rate ? <Money value={Number(v.list_price ?? 0) * Number(v.price_fx_rate)} currency={base} /> : <span className="text-warning">Falta tipo de cambio</span>} />
                  <Row strong label={<span className="flex items-center gap-1.5">Margen estimado <KindTag kind="estimado" /></span>} value={<Money value={v.estimated_margin_base} currency={base} tone="auto" />} />
                </dl>
                {v.price_currency !== base && v.price_fx_rate ? (
                  <p className="mt-3 text-[12px] text-faint">Conversión con el último tipo de cambio registrado ({formatNumber(Number(v.price_fx_rate), 2)}).</p>
                ) : null}
              </Panel>
            ) : null}
            <Panel title="Antigüedad">
              <DescriptionList items={[
                { label: "Fecha de adquisición", value: formatDate(v.acquisition_date) },
                { label: "Días en inventario", value: <span className="num">{v.days_in_stock}</span> },
                { label: "Proveedor", value: v.supplier },
              ]} />
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "costes" && canCosts ? <CostsTab ctxVehicle={v} id={id} today={today} canAdd={ctx.perms.has("inventory.costs.create")} canConfirm={ctx.perms.has("inventory.costs.edit_history")} ctx={ctx} /> : null}

      {tab === "estados" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
          <Panel title="Estados actuales" description="Cada dimensión es independiente. Disponibilidad y situación contractual sólo cambian con reservas, ventas y entregas.">
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(["physical", "commercial", "contract", "prep", "doc"] as const).map((d) => {
                const value = { physical: v.physical_status, commercial: v.commercial_status, contract: v.contract_status, prep: v.prep_status, doc: v.doc_status }[d];
                const cat = { physical: PHYSICAL_STATUS, commercial: COMMERCIAL_STATUS, contract: CONTRACT_STATUS_VEHICLE, prep: PREP_STATUS, doc: DOC_STATUS }[d];
                return (
                  <div key={d} className="rounded-md border border-line-soft p-2.5">
                    <p className="mb-1.5 text-[11.5px] text-faint">{DIMENSION_LABEL[d]}</p>
                    <CatalogPill catalog={cat} value={value} />
                  </div>
                );
              })}
            </div>
            {canEdit ? (
              <div className="space-y-4 border-t border-line-soft pt-4">
                <StatusChangeForm vehicleId={id} dimension="physical_status" current={v.physical_status} />
                <StatusChangeForm vehicleId={id} dimension="prep_status" current={v.prep_status} />
                <StatusChangeForm vehicleId={id} dimension="doc_status" current={v.doc_status} />
              </div>
            ) : null}
          </Panel>
          <HistoryPanel ctx={ctx} id={id} />
        </div>
      ) : null}

      {tab === "comercial" ? (
        <div className="space-y-5">
          <Panel title="Reservas" bodyClassName="p-0">
            {reservations.length === 0 ? <EmptyState title="Sin reservas" /> : (
              <Table>
                <THead><Th>N.º</Th><Th>Cliente</Th><Th>Estado</Th><Th numeric>Seña</Th><Th>Vence</Th><Th>Cierre</Th><Th /></THead>
                <tbody>
                  {reservations.map((r) => (
                    <Tr key={r.id}>
                      <Td className="num">{r.number}</Td>
                      <Td><Link href={`/clientes/${r.customer_id}`} className="hover:text-ink">{r.customer}</Link></Td>
                      <Td><CatalogPill catalog={RESERVATION_STATUS} value={r.status} /></Td>
                      <Td numeric><Money value={r.deposit_amount} currency={r.currency} /></Td>
                      <Td>{formatDateTime(r.expires_at)}</Td>
                      <Td muted>{r.close_reason ?? "—"}</Td>
                      <Td className="text-right">{r.status === "activa" && ctx.perms.has("reservations.manage") ? <CancelReservationButton reservationId={r.id} vehicleId={id} /> : null}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
          <Panel title="Operaciones de venta" bodyClassName="p-0">
            {deals.length === 0 ? <EmptyState title="Sin operaciones" description="Las propuestas y ventas de esta unidad aparecerán aquí." /> : (
              <Table>
                <THead><Th>N.º</Th><Th>Cliente</Th><Th>Vendedor</Th><Th>Estado</Th><Th numeric>Precio de venta</Th><Th>Fecha</Th></THead>
                <tbody>
                  {deals.map((d) => (
                    <Tr key={d.id}>
                      <Td><Link href={`/ventas/${d.id}`} className="num text-ink hover:underline">{d.number}</Link></Td>
                      <Td>{d.customer}</Td>
                      <Td muted>{d.seller}</Td>
                      <Td><CatalogPill catalog={DEAL_STATUS} value={d.status} /></Td>
                      <Td numeric><Money value={d.sale_price} currency={d.currency} /></Td>
                      <Td>{formatDateTime(d.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "documentos" ? <DocsTab ctx={ctx} id={id} condition={v.condition} canUpload={canEdit || ctx.perms.has("inventory.create")} /> : null}
    </>
  );
}

function Row({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "border-t border-line-soft pt-2.5 font-semibold text-ink" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

async function CostsTab({ ctx, ctxVehicle: v, id, today, canAdd, canConfirm }: {
  ctx: AppContext; ctxVehicle: NonNullable<Awaited<ReturnType<typeof getVehicle>>>; id: string; today: string; canAdd: boolean; canConfirm: boolean;
}) {
  const [costs, suppliers] = await Promise.all([vehicleCosts(ctx, id), canAdd ? listSuppliers(ctx) : Promise.resolve([])]);
  const base = v.base_currency;
  const estimates = costs.filter((c) => c.is_estimate);
  return (
    <div className="space-y-4">
      {estimates.length ? <Notice tone="warning">Hay {estimates.length} coste(s) estimado(s) sin factura: el margen realizado de una venta no se considera definitivo hasta confirmarlos.</Notice> : null}
      <Panel title="Costes atribuibles" description={`Convertidos a ${base} con el tipo de cambio registrado en cada coste.`} actions={canAdd ? <AddCostDialog vehicleId={id} suppliers={suppliers} today={today} defaultCurrency={v.price_currency} /> : null} bodyClassName="p-0">
        {costs.length === 0 ? <EmptyState title="Sin costes registrados" description="Registre el coste de adquisición y los gastos de transporte, reparación o documentación." /> : (
          <TableWrap className="rounded-none border-0">
            <Table>
              <THead><Th>Fecha</Th><Th>Concepto</Th><Th>Descripción</Th><Th numeric>Importe</Th><Th numeric>T. cambio</Th><Th numeric>{`En ${base}`}</Th><Th>Tipo</Th><Th className="hidden lg:table-cell">Proveedor / factura</Th><Th /></THead>
              <tbody>
                {costs.map((c) => (
                  <Tr key={c.id}>
                    <Td>{formatDate(c.incurred_on)}</Td>
                    <Td>{COST_KIND[c.kind] ?? c.kind}</Td>
                    <Td className="max-w-72 truncate">{c.description}</Td>
                    <Td numeric><Money value={c.amount} currency={c.currency} /></Td>
                    <Td numeric muted>{c.currency === base ? "—" : formatNumber(Number(c.fx_rate_to_base), 2)}</Td>
                    <Td numeric><Money value={c.amount_base} currency={base} /></Td>
                    <Td>{c.is_estimate ? <StatusPill tone="warning">Estimado</StatusPill> : <StatusPill tone="neutral">Registrado</StatusPill>}</Td>
                    <Td className="hidden lg:table-cell" muted>{[c.supplier, c.invoice].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td className="text-right">{c.is_estimate && canConfirm ? <ConfirmCostButton costId={c.id} vehicleId={id} /> : null}</Td>
                  </Tr>
                ))}
              </tbody>
              <TFootRow>
                <Td colSpan={5}>Coste total</Td>
                <Td numeric><Money value={v.total_cost_base} currency={base} /></Td>
                <Td colSpan={3} />
              </TFootRow>
            </Table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

async function HistoryPanel({ ctx, id }: { ctx: AppContext; id: string }) {
  const history = await vehicleStatusHistory(ctx, id);
  return (
    <Panel title="Historial de estados" bodyClassName="p-0">
      {history.length === 0 ? <EmptyState title="Sin movimientos" /> : (
        <ol className="divide-y divide-line-soft">
          {history.map((h) => (
            <li key={h.id} className="flex gap-3 px-4 py-3 text-[13px]">
              <span className="num w-36 shrink-0 whitespace-nowrap text-faint">{formatDateTime(h.occurred_at)}</span>
              <div className="min-w-0">
                <p className="text-ink-2">
                  <span className="text-faint">{DIMENSION_LABEL[h.dimension]}:</span>{" "}
                  {h.from_status ? `${CATALOG_BY_DIM[h.dimension]?.[h.from_status]?.label ?? h.from_status} → ` : ""}
                  <span className="text-ink">{CATALOG_BY_DIM[h.dimension]?.[h.to_status]?.label ?? h.to_status}</span>
                </p>
                <p className="text-[12px] text-faint">{h.actor ?? "Sistema"}{h.note ? ` · ${h.note}` : ""}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

async function DocsTab({ ctx, id, condition, canUpload }: { ctx: AppContext; id: string; condition: string; canUpload: boolean }) {
  const [docs, required] = await Promise.all([vehicleDocuments(ctx, id), vehicleRequiredDocs(ctx, id, condition)]);
  return (
    <DocumentsPanel
      documents={docs}
      entityType="vehicle"
      entityId={id}
      canUpload={canUpload}
      allowRestricted={ctx.perms.has("documents.view_restricted")}
      types={required.map((r) => ({ id: r.id, name: r.name }))}
      required={required}
    />
  );
}
