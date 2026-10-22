import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FilterForm, FilterSelect, SearchInput } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import { DEAL_STATUS } from "@/lib/labels";
import { hrefWith, param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { listMembers } from "@/server/queries/common";
import { DEAL_TABS, dealCounts, listDeals } from "@/server/queries/sales";

export const metadata: Metadata = { title: "Ventas" };

const TAB_LABELS: Record<keyof typeof DEAL_TABS, string> = {
  activas: "En curso",
  borrador: "Borradores",
  pendiente_aprobacion: "Por aprobar",
  aprobada: "Por formalizar",
  formalizada: "Por entregar",
  entregada: "Entregadas",
  anulada: "Anuladas",
};

export default async function DealsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("deals.view", "deals.view_all");
  const sp = await searchParams;
  const raw = param(sp, "estado");
  const tab = (raw && raw in DEAL_TABS ? raw : "activas") as keyof typeof DEAL_TABS;
  const [rows, counts, sellers] = await Promise.all([
    listDeals(ctx, { tab, q: param(sp, "q"), seller: param(sp, "vendedor") }),
    dealCounts(ctx),
    ctx.perms.has("deals.view_all") ? listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]) : Promise.resolve([]),
  ]);
  const count = (t: keyof typeof DEAL_TABS) => DEAL_TABS[t].reduce((a, s) => a + (counts[s] ?? 0), 0);

  return (
    <>
      <PageHeader title="Ventas" description="Operaciones desde el borrador hasta la entrega. Facturación, cobro y margen se distinguen en cada operación."
        actions={ctx.perms.has("deals.create") ? <ButtonLink href="/ventas/nueva" variant="primary"><Plus aria-hidden /> Nueva operación</ButtonLink> : null} />
      <Tabs active={tab} items={(Object.keys(DEAL_TABS) as Array<keyof typeof DEAL_TABS>).map((t) => ({
        key: t, label: TAB_LABELS[t], href: hrefWith("/ventas", sp, { estado: t === "activas" ? null : t }), count: count(t),
      }))} />
      <FilterForm keep={[["estado", param(sp, "estado")]]}>
        <SearchInput defaultValue={param(sp, "q")} placeholder="N.º, cliente, modelo o código" />
        {sellers.length ? <FilterSelect name="vendedor" label="Vendedor" defaultValue={param(sp, "vendedor")} options={sellers.map((s) => ({ value: s.id, label: s.full_name }))} /> : null}
      </FilterForm>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="No hay operaciones en esta vista" /></div>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <Th>N.º</Th><Th>Cliente</Th><Th>Unidad</Th><Th className="hidden lg:table-cell">Vendedor</Th><Th>Modalidad</Th><Th>Estado</Th>
              <Th numeric>Precio de venta</Th><Th numeric className="hidden md:table-cell">Descuento</Th><Th>Fecha</Th>
            </THead>
            <tbody>
              {rows.map((d) => (
                <Tr key={d.id}>
                  <Td><Link href={`/ventas/${d.id}`} className="num whitespace-nowrap font-medium text-ink hover:underline">{d.number}</Link></Td>
                  <Td><Link href={`/clientes/${d.customer_id}`} className="hover:text-ink">{d.customer}</Link></Td>
                  <Td><span className="block">{d.vehicle}</span><span className="num text-[11.5px] text-faint">{d.stock_code}</span></Td>
                  <Td className="hidden lg:table-cell" muted>{d.seller}</Td>
                  <Td>{d.payment_type === "contado" ? "Contado" : "Financiado"}</Td>
                  <Td><CatalogPill catalog={DEAL_STATUS} value={d.status} /></Td>
                  <Td numeric><Money value={d.sale_price} currency={d.currency} /></Td>
                  <Td numeric className="hidden md:table-cell">{Number(d.discount_amount) > 0 ? <Money value={d.discount_amount} currency={d.currency} /> : <span className="text-faint">—</span>}</Td>
                  <Td className="whitespace-nowrap">{formatDate(d.formalized_at ?? d.created_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
