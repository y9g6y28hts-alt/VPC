import Link from "next/link";
import type { Metadata } from "next";
import { LayoutGrid, Plus, Rows3 } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { FilterForm, FilterSelect, SearchInput } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { SortTh, Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";
import { VehicleVisual } from "@/components/inventory/vehicle-visual";
import { VehicleDrawer } from "@/components/inventory/vehicle-drawer";
import { formatKm, formatNumber, vehicleName } from "@/lib/format";
import { COMMERCIAL_STATUS, PHYSICAL_STATUS } from "@/lib/labels";
import { hrefWith, param, sortParams, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getSettings, listBrands } from "@/server/queries/common";
import { INVENTORY_SORTS, inventorySummary, listVehicles } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Inventario" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("inventory.view");
  const sp = await searchParams;
  const settings = await getSettings(ctx);
  const canCosts = ctx.perms.has("inventory.costs.view");
  const view = param(sp, "vista") ?? (canCosts ? "control" : "showroom");
  const sort = sortParams(sp, INVENTORY_SORTS, "dias");
  const filters = {
    q: param(sp, "q"),
    brand: param(sp, "marca"),
    status: param(sp, "estado"),
    condition: param(sp, "condicion"),
    aged: param(sp, "envejecidas") === "1",
    sort,
  };
  const [rows, summary, brands] = await Promise.all([
    listVehicles(ctx, filters, settings.aging_alert_days),
    inventorySummary(ctx, settings.aging_alert_days),
    listBrands(ctx),
  ]);
  const base = ctx.org.baseCurrency;
  const selected = param(sp, "unidad");
  const sortHref = (field: string, dir: "asc" | "desc") => hrefWith("/inventario", sp, { orden: field, dir });

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Unidades en stock, en tránsito y vendidas pendientes de entrega. Las entregadas se consultan con el filtro de estado."
        actions={
          <>
            <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Vista">
              <Link href={hrefWith("/inventario", sp, { vista: "showroom" })} aria-pressed={view === "showroom"}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[13px]", view === "showroom" ? "bg-elevated text-ink" : "text-muted hover:text-ink")}>
                <LayoutGrid className="size-4" aria-hidden /> Showroom
              </Link>
              <Link href={hrefWith("/inventario", sp, { vista: "control" })} aria-pressed={view === "control"}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[13px]", view === "control" ? "bg-elevated text-ink" : "text-muted hover:text-ink")}>
                <Rows3 className="size-4" aria-hidden /> Control
              </Link>
            </div>
            {ctx.perms.has("inventory.create") ? (
              <ButtonLink href="/inventario/nueva" variant="primary">
                <Plus aria-hidden /> Nueva unidad
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <StatGrid className="mb-6 xl:grid-cols-4">
        <Stat id="inv-units" label="Unidades en stock" value={formatNumber(summary.available + summary.reserved)}
          sub={`${summary.available} disponibles · ${summary.reserved} reservadas`}
          definition={{ formula: "Unidades con disponibilidad comercial «Disponible» o «Reservado».", source: "Inventario (vehicles.commercial_status)." }} />
        <Stat id="inv-pending" label="Vendidas sin entregar" value={formatNumber(summary.pendingDelivery)} href="/inventario?estado=vendido_pendiente_entrega"
          tone={summary.pendingDelivery > 0 ? "warning" : "neutral"}
          definition={{ formula: "Unidades con venta formalizada cuya entrega física aún no se registró.", source: "Inventario y ventas." }} />
        {canCosts ? (
          <Stat id="inv-capital" label="Capital en stock" value={<Money value={summary.capitalBase} currency={base} compact />}
            sub="Costes registrados + estimados"
            definition={{ formula: "Suma de costes (adquisición, transporte, reparaciones, etc.) de las unidades disponibles o reservadas, convertidos a moneda base con el tipo de cambio de cada coste.", source: "Costes por unidad (vehicle_costs)." }} />
        ) : null}
        <Stat id="inv-aged" label={`Más de ${settings.aging_alert_days} días`} value={formatNumber(summary.aged)} href="/inventario?envejecidas=1"
          tone={summary.aged > 0 ? "critical" : "neutral"}
          sub="Inventario envejecido"
          definition={{ formula: `Unidades en stock cuya antigüedad (hoy − fecha de adquisición) supera ${settings.aging_alert_days} días. El umbral se configura en Configuración.`, source: "Inventario." }} />
      </StatGrid>

      <FilterForm keep={[["vista", param(sp, "vista")], ["orden", param(sp, "orden")], ["dir", param(sp, "dir")]]}>
        <SearchInput defaultValue={filters.q} placeholder="Código, modelo, VIN, chapa, color…" />
        <FilterSelect name="marca" label="Marca" defaultValue={filters.brand} options={brands.map((b) => ({ value: b.id, label: b.name }))} allLabel="Todas" />
        <FilterSelect name="estado" label="Disponibilidad" defaultValue={filters.status} allLabel="No entregadas"
          options={[{ value: "stock", label: "En stock (disp. + reservadas)" }, ...Object.entries(COMMERCIAL_STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} />
        <FilterSelect name="condicion" label="Condición" defaultValue={filters.condition} allLabel="Todas"
          options={[{ value: "nuevo", label: "Nuevo" }, { value: "usado", label: "Usado" }]} />
        <label className="flex h-9 items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="envejecidas" value="1" defaultChecked={filters.aged} className="size-4 accent-[var(--color-brand)]" />
          Sólo envejecidas
        </label>
        {filters.q || filters.brand || filters.status || filters.condition || filters.aged ? (
          <Link href={hrefWith("/inventario", {}, { vista: param(sp, "vista") })} className={buttonClass("ghost", "sm", "h-9")}>
            Limpiar
          </Link>
        ) : null}
      </FilterForm>

      <p className="mb-3 text-[12.5px] text-faint">{rows.length === 1 ? "1 unidad" : `${formatNumber(rows.length)} unidades`}</p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line-soft bg-surface">
          <EmptyState
            title="No hay unidades con estos filtros"
            description={filters.q || filters.brand || filters.status ? "Pruebe quitando filtros." : "Todavía no se registraron unidades."}
            action={ctx.perms.has("inventory.create") ? <ButtonLink href="/inventario/nueva" variant="primary"><Plus aria-hidden /> Nueva unidad</ButtonLink> : null}
          />
        </div>
      ) : view === "showroom" ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((v) => (
            <li key={v.id}>
              <Link href={hrefWith("/inventario", sp, { unidad: v.id })} scroll={false}
                className="group block overflow-hidden rounded-lg border border-line-soft bg-surface transition-colors hover:border-line">
                <div className="aspect-[16/10] overflow-hidden border-b border-line-soft">
                  <VehicleVisual photoId={v.cover_photo_id} brand={v.brand} model={v.model} className="transition-transform duration-300 group-hover:scale-[1.02]" />
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-muted">{v.brand}</span>
                    <CatalogPill catalog={COMMERCIAL_STATUS} value={v.commercial_status} />
                  </div>
                  <p className="display mt-1.5 truncate text-[17px] font-semibold text-ink">{v.model}</p>
                  <p className="truncate text-[13px] text-muted">{v.version ?? "—"}</p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <p className="num text-[12.5px] text-faint">
                      {v.year_model} · {v.condition === "nuevo" ? "0 km" : formatKm(v.mileage_km)}
                    </p>
                    <Money value={v.list_price} currency={v.price_currency} className="display text-[16px] font-semibold text-ink" />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <SortTh label="Código" field="codigo" current={sort.field} dir={sort.dir} hrefFor={sortHref} />
              <SortTh label="Unidad" field="modelo" current={sort.field} dir={sort.dir} hrefFor={sortHref} />
              <Th>Disponibilidad</Th>
              <Th className="hidden 2xl:table-cell">Situación física</Th>
              <SortTh label="Días" field="dias" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric />
              <SortTh label="Precio de lista" field="precio" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric />
              {canCosts ? <SortTh label={`Coste (${base})`} field="coste" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric /> : null}
              {canCosts ? <SortTh label={`Margen est. (${base})`} field="margen" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric /> : null}
              <Th className="hidden 2xl:table-cell">Ubicación</Th>
            </THead>
            <tbody>
              {rows.map((v) => {
                const aged = v.days_in_stock > settings.aging_alert_days && ["disponible", "reservado"].includes(v.commercial_status);
                return (
                  <Tr key={v.id}>
                    <Td>
                      <Link href={hrefWith("/inventario", sp, { unidad: v.id })} scroll={false} className="num whitespace-nowrap font-medium text-ink hover:underline">
                        {v.stock_code}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/inventario/${v.id}`} className="block min-w-44 hover:text-ink">
                        <span className="text-ink">{vehicleName(v.brand, v.model)}</span>
                        <span className="block text-[12px] text-faint">
                          {v.version ?? ""} · {v.year_model} · {v.condition === "nuevo" ? "0 km" : formatKm(v.mileage_km)}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <CatalogPill catalog={COMMERCIAL_STATUS} value={v.commercial_status} />
                      {v.reserved_for ? <span className="mt-1 block max-w-44 truncate text-[11.5px] text-faint">p/ {v.reserved_for}</span> : null}
                    </Td>
                    <Td className="hidden 2xl:table-cell"><CatalogPill catalog={PHYSICAL_STATUS} value={v.physical_status} /></Td>
                    <Td numeric>
                      <span className={aged ? "font-semibold text-critical" : undefined}>{v.days_in_stock}</span>
                    </Td>
                    <Td numeric>
                      {v.list_price ? <Money value={v.list_price} currency={v.price_currency} /> : <StatusPill tone="warning">Sin precio</StatusPill>}
                      {v.physical_status !== "listo" ? <span className="mt-1 block 2xl:hidden"><CatalogPill catalog={PHYSICAL_STATUS} value={v.physical_status} /></span> : null}
                    </Td>
                    {canCosts ? <Td numeric><Money value={v.total_cost_base} currency={base} /></Td> : null}
                    {canCosts ? (
                      <Td numeric>
                        {v.estimated_margin_base === null
                          ? <span className="text-faint" title="Falta precio o tipo de cambio">—</span>
                          : <Money value={v.estimated_margin_base} currency={base} tone="auto" />}
                      </Td>
                    ) : null}
                    <Td className="hidden 2xl:table-cell" muted>{v.location ?? "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {selected ? <VehicleDrawer ctx={ctx} id={selected} closeHref={hrefWith("/inventario", sp, { unidad: null })} /> : null}
    </>
  );
}
