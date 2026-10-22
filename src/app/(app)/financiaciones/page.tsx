import Link from "next/link";
import type { Metadata } from "next";
import { Calculator } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FilterForm, FilterSelect, SearchInput } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { agingSeverity, DEFAULT_AGING_BUCKETS } from "@/domain/collections/aging";
import { formatDate } from "@/lib/format";
import { CONTRACT_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { listContracts } from "@/server/queries/contracts";

export const metadata: Metadata = { title: "Financiaciones" };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("contracts.view");
  const sp = await searchParams;
  const rows = await listContracts(ctx, { q: param(sp, "q"), status: param(sp, "estado"), bucket: param(sp, "tramo") });
  return (
    <>
      <PageHeader title="Financiaciones" description="Contratos, planes de pago y saldos calculados desde cuotas y pagos confirmados."
        actions={ctx.perms.has("deals.create") ? <ButtonLink href="/financiaciones/simulador"><Calculator aria-hidden /> Simulador</ButtonLink> : null} />
      <Tabs active="contratos" items={[{ key: "contratos", label: "Contratos", href: "/financiaciones", count: rows.length }, { key: "simulador", label: "Simulador", href: "/financiaciones/simulador" }]} />
      <FilterForm>
        <SearchInput defaultValue={param(sp, "q")} placeholder="N.º de contrato o cliente" />
        <FilterSelect name="estado" label="Estado" defaultValue={param(sp, "estado")} allLabel="Vigentes y saldados" options={Object.entries(CONTRACT_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
        <FilterSelect name="tramo" label="Mora" defaultValue={param(sp, "tramo")} options={DEFAULT_AGING_BUCKETS.map((b) => ({ value: b.label, label: b.label }))} />
      </FilterForm>
      {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin contratos" description="Los contratos se generan al formalizar una venta." /></div> : (
        <TableWrap>
          <Table>
            <THead>
              <Th>Contrato</Th><Th>Cliente</Th><Th className="hidden lg:table-cell">Unidad</Th><Th>Estado</Th>
              <Th numeric>Saldo</Th><Th numeric>Vencido</Th><Th>Mora</Th><Th className="hidden md:table-cell">Próximo vencimiento</Th><Th className="hidden xl:table-cell">Último pago</Th>
            </THead>
            <tbody>
              {rows.map((c) => {
                const sev = agingSeverity(c.max_days_overdue);
                return (
                  <Tr key={c.contract_id}>
                    <Td><Link href={`/financiaciones/${c.contract_id}`} className="num whitespace-nowrap font-medium text-ink hover:underline">{c.number}</Link><span className="block text-[11.5px] text-faint">{formatDate(c.signed_on)}</span></Td>
                    <Td><Link href={`/clientes/${c.customer_id}`} className="hover:text-ink">{c.customer}</Link></Td>
                    <Td className="hidden lg:table-cell" muted>{c.vehicle}</Td>
                    <Td><CatalogPill catalog={CONTRACT_STATUS} value={c.status} /></Td>
                    <Td numeric><Money value={c.outstanding} currency={c.currency} /></Td>
                    <Td numeric><Money value={c.overdue_amount} currency={c.currency} tone={Number(c.overdue_amount) > 0 ? "critical" : "muted"} /></Td>
                    <Td>{c.max_days_overdue > 0 ? <StatusPill tone={sev === "low" ? "warning" : "critical"}>{c.bucket} · {c.max_days_overdue} d</StatusPill> : c.status === "saldado" ? <span className="text-faint">—</span> : <StatusPill tone="positive">Al día</StatusPill>}</Td>
                    <Td className="hidden md:table-cell">{c.next_due_date ? <span className="num">{formatDate(c.next_due_date)} · <Money value={c.next_due_amount} currency={c.currency} /></span> : "—"}</Td>
                    <Td className="hidden xl:table-cell" muted>{formatDate(c.last_payment_on)}</Td>
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
