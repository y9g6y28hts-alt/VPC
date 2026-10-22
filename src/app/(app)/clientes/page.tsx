import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { FilterForm, FilterSelect, SearchInput } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status";
import { SortTh, Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { agingSeverity } from "@/domain/collections/aging";
import { formatDate, formatNumber } from "@/lib/format";
import { DOC_TYPE } from "@/lib/labels";
import { hrefWith, param, sortParams, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { listMembers } from "@/server/queries/common";
import { listCustomers } from "@/server/queries/customers";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("customers.view", "customers.view_all");
  const sp = await searchParams;
  const sort = sortParams(sp, ["nombre", "alta", "saldo", "vencido"], "nombre", "asc");
  const canSeeDebt = ctx.perms.any("contracts.view", "collections.view");
  const filters = { q: param(sp, "q"), seller: param(sp, "vendedor"), debt: param(sp, "con_deuda") === "1", sort };
  const [rows, sellers] = await Promise.all([
    listCustomers(ctx, filters),
    ctx.perms.has("customers.view_all") ? listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]) : Promise.resolve([]),
  ]);
  const base = ctx.org.baseCurrency;
  const sortHref = (field: string, dir: "asc" | "desc") => hrefWith("/clientes", sp, { orden: field, dir });

  return (
    <>
      <PageHeader
        title="Clientes"
        description={ctx.perms.has("customers.view_all") ? "Expediente único de cada cliente: operaciones, pagos, deudas y gestiones." : "Sus clientes asignados."}
        actions={ctx.perms.has("customers.create") ? <ButtonLink href="/clientes/nuevo" variant="primary"><Plus aria-hidden /> Nuevo cliente</ButtonLink> : null}
      />
      <Tabs active="clientes" items={[
        { key: "clientes", label: "Clientes", href: "/clientes" },
        ...(ctx.perms.has("crm.manage") || ctx.perms.has("customers.view_all") ? [{ key: "oportunidades", label: "Embudo comercial", href: "/clientes/oportunidades" }] : []),
      ]} />
      <FilterForm keep={[["orden", param(sp, "orden")], ["dir", param(sp, "dir")]]}>
        <SearchInput defaultValue={filters.q} placeholder="Nombre, documento, teléfono o correo" />
        {sellers.length ? <FilterSelect name="vendedor" label="Vendedor" defaultValue={filters.seller} options={sellers.map((s) => ({ value: s.id, label: s.full_name }))} /> : null}
        {canSeeDebt ? (
          <label className="flex h-9 items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" name="con_deuda" value="1" defaultChecked={filters.debt} className="size-4 accent-[var(--color-brand)]" />
            Sólo con deuda vencida
          </label>
        ) : null}
        {filters.q || filters.seller || filters.debt ? <Link href="/clientes" className={buttonClass("ghost", "sm", "h-9")}>Limpiar</Link> : null}
      </FilterForm>
      <p className="mb-3 text-[12.5px] text-faint">{formatNumber(rows.length)} {rows.length === 1 ? "cliente" : "clientes"}</p>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-line-soft bg-surface">
          <EmptyState title="No se encontraron clientes" description={filters.q ? "Pruebe con otro criterio de búsqueda." : "Todavía no hay clientes registrados."} />
        </div>
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <SortTh label="Cliente" field="nombre" current={sort.field} dir={sort.dir} hrefFor={sortHref} />
              <Th>Documento</Th>
              <Th className="hidden md:table-cell">Contacto</Th>
              <Th className="hidden lg:table-cell">Vendedor</Th>
              <Th numeric>Operaciones</Th>
              {canSeeDebt ? <SortTh label={`Saldo (${base})`} field="saldo" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric /> : null}
              {canSeeDebt ? <SortTh label={`Vencido (${base})`} field="vencido" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric /> : null}
              <Th className="hidden xl:table-cell">Próxima acción</Th>
            </THead>
            <tbody>
              {rows.map((c) => {
                const sev = agingSeverity(c.max_days_overdue ?? 0);
                return (
                  <Tr key={c.id}>
                    <Td>
                      <Link href={`/clientes/${c.id}`} className="font-medium text-ink hover:underline">{c.full_name}</Link>
                      {c.kind === "empresa" ? <span className="ml-2 text-[11.5px] text-faint">Empresa</span> : null}
                    </Td>
                    <Td className="num whitespace-nowrap">{DOC_TYPE[c.doc_type]} {c.doc_number}</Td>
                    <Td className="hidden md:table-cell" muted>{c.phone ?? c.email ?? "—"}</Td>
                    <Td className="hidden lg:table-cell" muted>{c.seller ?? "Sin asignar"}</Td>
                    <Td numeric>{c.deals}</Td>
                    {canSeeDebt ? <Td numeric>{c.outstanding_base ? <Money value={c.outstanding_base} currency={base} /> : <span className="text-faint">—</span>}</Td> : null}
                    {canSeeDebt ? (
                      <Td numeric>
                        {Number(c.overdue_base ?? 0) > 0 ? (
                          <span className="inline-flex flex-col items-end">
                            <Money value={c.overdue_base} currency={base} tone="critical" />
                            <span className={`text-[11.5px] ${sev === "critical" || sev === "high" ? "text-critical" : "text-warning"}`}>{c.max_days_overdue} días</span>
                          </span>
                        ) : c.contracts ? <StatusPill tone="positive">Al día</StatusPill> : <span className="text-faint">—</span>}
                      </Td>
                    ) : null}
                    <Td className="hidden xl:table-cell" muted>{c.next_action_at ? formatDate(c.next_action_at) : "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {canSeeDebt ? <p className="mt-3 text-[12px] text-faint">Saldos en moneda extranjera convertidos a {base} con el último tipo de cambio registrado (referencial).</p> : null}
    </>
  );
}
