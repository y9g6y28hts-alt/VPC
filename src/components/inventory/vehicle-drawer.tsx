import { ExternalLink, Handshake } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Money } from "@/components/ui/money";
import { DescriptionList } from "@/components/ui/panel";
import { CatalogPill, KindTag } from "@/components/ui/status";
import { formatDate, formatDateTime, formatKm, vehicleName } from "@/lib/format";
import { COMMERCIAL_STATUS, CONTRACT_STATUS_VEHICLE, DOC_STATUS, FUEL, ORIGIN, PHYSICAL_STATUS, PREP_STATUS, TRANSMISSION } from "@/lib/labels";
import type { AppContext } from "@/server/auth/context";
import { getSettings, listCashAccounts } from "@/server/queries/common";
import { customerOptions } from "@/server/queries/customers";
import { getVehicle } from "@/server/queries/inventory";
import { addDays, todayIn } from "@/domain/dates";
import { VehicleVisual } from "./vehicle-visual";
import { ReserveDialog } from "./reserve-dialog";

export async function VehicleDrawer({ ctx, id, closeHref }: { ctx: AppContext; id: string; closeHref: string }) {
  const v = await getVehicle(ctx, id);
  if (!v) {
    return (
      <Drawer title="Unidad no encontrada" closeHref={closeHref}>
        <p className="text-sm text-muted">La unidad no existe o no tiene permiso para verla.</p>
      </Drawer>
    );
  }
  const canCosts = ctx.perms.has("inventory.costs.view");
  const canReserve = ctx.perms.has("reservations.manage") && v.commercial_status === "disponible";
  const canSell = ctx.perms.has("deals.create") && ["disponible", "reservado"].includes(v.commercial_status);
  const [settings, customers, accounts] = canReserve
    ? await Promise.all([getSettings(ctx), customerOptions(ctx), listCashAccounts(ctx)])
    : [null, [], []];
  const label = `${v.stock_code} · ${v.brand} ${v.model} ${v.version ?? ""} ${v.year_model}`;

  return (
    <Drawer
      title={vehicleName(v.brand, v.model)}
      subtitle={<span className="num">{v.stock_code} · {v.version ?? "—"} · {v.year_model}</span>}
      closeHref={closeHref}
    >
      <div className="aspect-[16/9] overflow-hidden rounded-lg border border-line-soft">
        <VehicleVisual photoId={null} brand={v.brand} model={v.model} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <CatalogPill catalog={COMMERCIAL_STATUS} value={v.commercial_status} />
        <CatalogPill catalog={PHYSICAL_STATUS} value={v.physical_status} />
        <CatalogPill catalog={CONTRACT_STATUS_VEHICLE} value={v.contract_status} />
      </div>
      {v.reserved_for ? (
        <p className="mt-3 text-[13px] text-warning">
          Reservada para {v.reserved_for} hasta {formatDateTime(v.reserved_until)}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line-soft bg-carbon/40 p-3">
          <p className="text-[12px] text-faint">Precio de lista</p>
          <Money value={v.list_price} currency={v.price_currency} className="display mt-1 block text-[20px] font-semibold text-ink" />
          {v.min_price ? <p className="num mt-1 text-[12px] text-faint">Mínimo: <Money value={v.min_price} currency={v.price_currency} /></p> : null}
        </div>
        {canCosts ? (
          <div className="rounded-lg border border-line-soft bg-carbon/40 p-3">
            <p className="flex items-center gap-1.5 text-[12px] text-faint">Margen estimado <KindTag kind="estimado" /></p>
            <Money value={v.estimated_margin_base} currency={v.base_currency} tone="auto" className="display mt-1 block text-[20px] font-semibold" />
            <p className="num mt-1 text-[12px] text-faint">Coste total: <Money value={v.total_cost_base} currency={v.base_currency} /></p>
          </div>
        ) : (
          <div className="rounded-lg border border-line-soft bg-carbon/40 p-3">
            <p className="text-[12px] text-faint">Días en stock</p>
            <p className="display num mt-1 text-[20px] font-semibold text-ink">{v.days_in_stock}</p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <DescriptionList
          items={[
            { label: "Kilometraje", value: formatKm(v.mileage_km) },
            { label: "Combustible / transmisión", value: `${FUEL[v.fuel] ?? v.fuel} · ${TRANSMISSION[v.transmission] ?? v.transmission}` },
            { label: "Color", value: v.color },
            { label: "VIN / chasis", value: <span className="font-mono text-[12.5px]">{v.vin ?? "—"}</span> },
            { label: "Origen", value: ORIGIN[v.origin] ?? v.origin },
            { label: "Ubicación", value: v.location },
            { label: "Adquisición", value: formatDate(v.acquisition_date) },
            { label: "Días en stock", value: v.days_in_stock },
            { label: "Preparación", value: <CatalogPill catalog={PREP_STATUS} value={v.prep_status} /> },
            { label: "Documentación", value: <CatalogPill catalog={DOC_STATUS} value={v.doc_status} /> },
          ]}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-line-soft pt-5">
        <ButtonLink href={`/inventario/${v.id}`} variant="secondary">
          <ExternalLink aria-hidden /> Ficha completa
        </ButtonLink>
        {canReserve ? (
          <ReserveDialog
            vehicleId={v.id}
            vehicleLabel={label}
            customers={customers}
            accounts={accounts}
            defaultExpiry={addDays(todayIn(ctx.org.timezone), settings?.reservation_default_days ?? 7)}
            canRegisterDeposit={ctx.perms.has("payments.register")}
          />
        ) : null}
        {canSell ? (
          <ButtonLink href={`/ventas/nueva?unidad=${v.id}`} variant="primary">
            <Handshake aria-hidden /> Nueva venta
          </ButtonLink>
        ) : null}
      </div>
    </Drawer>
  );
}
