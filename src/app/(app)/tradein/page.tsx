import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { tradeInEstimatedMargin } from "@/domain/sales/margin";
import { formatDate, formatKm } from "@/lib/format";
import { TRADEIN_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { listAppraisals } from "@/server/queries/tradein";

export const metadata: Metadata = { title: "Trade-in" };

export default async function TradeInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("tradein.view");
  const sp = await searchParams;
  const rows = await listAppraisals(ctx, param(sp, "estado"));
  return (
    <>
      <PageHeader title="Trade-in y tasaciones" description="Vehículos usados recibidos como parte de pago. Sólo ingresan al inventario al formalizar la adquisición."
        actions={ctx.perms.has("tradein.create") ? <ButtonLink href="/tradein/nueva" variant="primary"><Plus aria-hidden /> Nueva tasación</ButtonLink> : null} />
      <FilterForm>
        <FilterSelect name="estado" label="Estado" defaultValue={param(sp, "estado")} allLabel="En curso" options={Object.entries(TRADEIN_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
      </FilterForm>
      {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin tasaciones" /></div> : (
        <TableWrap>
          <Table>
            <THead><Th>N.º</Th><Th>Vehículo</Th><Th>Cliente</Th><Th>Estado</Th><Th numeric>Ofrecido</Th><Th numeric>Aceptado</Th><Th numeric className="hidden lg:table-cell">Margen estimado</Th><Th className="hidden xl:table-cell">Tasador</Th><Th>Fecha</Th></THead>
            <tbody>
              {rows.map((t) => {
                const base = Number(t.accepted_value ?? t.offered_value ?? 0);
                const margin = t.expected_resale_price && base ? tradeInEstimatedMargin({ expectedResalePrice: Number(t.expected_resale_price), acceptedValue: base, attributableCosts: Number(t.estimated_repair_costs), currency: t.currency }) : null;
                return (
                  <Tr key={t.id}>
                    <Td><Link href={`/tradein/${t.id}`} className="num font-medium text-ink hover:underline">{t.number}</Link></Td>
                    <Td><span className="text-ink">{t.brand_name} {t.model} {t.year_model}</span><span className="block text-[11.5px] text-faint">{formatKm(t.mileage_km)}</span></Td>
                    <Td><Link href={`/clientes/${t.customer_id}`} className="hover:text-ink">{t.customer}</Link></Td>
                    <Td><CatalogPill catalog={TRADEIN_STATUS} value={t.status} /></Td>
                    <Td numeric><Money value={t.offered_value} currency={t.currency} /></Td>
                    <Td numeric>{t.accepted_value ? <Money value={t.accepted_value} currency={t.currency} /> : <span className="text-faint">—</span>}</Td>
                    <Td numeric className="hidden lg:table-cell">{margin !== null ? <Money value={margin} currency={t.currency} tone="auto" /> : "—"}</Td>
                    <Td className="hidden xl:table-cell" muted>{t.appraiser ?? "—"}</Td>
                    <Td className="num">{formatDate(t.created_at)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
