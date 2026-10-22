import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { Money } from "@/components/ui/money";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { SupplierDialog } from "@/components/payables/payables-forms";
import { SUPPLIER_KIND } from "@/lib/labels";
import { requirePerm } from "@/server/auth/context";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage() {
  const ctx = await requirePerm("suppliers.view", "payables.view");
  const rows = await ctx.db((tx) => tx<{ id: string; name: string; tax_id: string | null; kind: string; phone: string | null; email: string | null; address: string | null; notes: string | null; invoices: number; outstanding_pyg: string; outstanding_usd: string }[]>`
    select s.id, s.name, s.tax_id, s.kind, s.phone, s.email, s.address, s.notes,
           (select count(*)::int from public.supplier_invoices i where i.supplier_id = s.id) as invoices,
           coalesce((select sum(outstanding) from public.v_supplier_invoice_balances b where b.supplier_id = s.id and b.status = 'aprobada' and b.currency = 'PYG'), 0) as outstanding_pyg,
           coalesce((select sum(outstanding) from public.v_supplier_invoice_balances b where b.supplier_id = s.id and b.status = 'aprobada' and b.currency = 'USD'), 0) as outstanding_usd
    from public.suppliers s where s.org_id = ${ctx.org.id} and s.is_active order by s.name`);
  const canManage = ctx.perms.has("suppliers.manage");
  return (
    <>
      <PageHeader title="Compras y proveedores" description="Proveedores de vehículos, transporte, reparación, documentación y servicios." actions={canManage ? <SupplierDialog /> : null} />
      <Tabs active="proveedores" items={[{ key: "facturas", label: "Facturas", href: "/compras" }, { key: "proveedores", label: "Proveedores", href: "/compras/proveedores", count: rows.length }]} />
      {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin proveedores" /></div> : (
        <TableWrap>
          <Table>
            <THead><Th>Proveedor</Th><Th>RUC</Th><Th>Tipo</Th><Th className="hidden lg:table-cell">Contacto</Th><Th numeric>Facturas</Th><Th numeric>Saldo Gs.</Th><Th numeric>Saldo US$</Th><Th /></THead>
            <tbody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium text-ink">{s.name}</Td>
                  <Td className="num">{s.tax_id ?? "—"}</Td>
                  <Td>{SUPPLIER_KIND[s.kind]}</Td>
                  <Td className="hidden lg:table-cell" muted>{[s.phone, s.email].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td numeric>{s.invoices}</Td>
                  <Td numeric><Money value={s.outstanding_pyg} currency="PYG" tone={Number(s.outstanding_pyg) ? undefined : "muted"} /></Td>
                  <Td numeric><Money value={s.outstanding_usd} currency="USD" tone={Number(s.outstanding_usd) ? undefined : "muted"} /></Td>
                  <Td className="text-right">{canManage ? <SupplierDialog supplier={s} /> : null}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
