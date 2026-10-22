import Link from "next/link";
import { Anchor, Bike, Car, CarFront, Gem, LayoutGrid, Rows3, Truck } from "lucide-react";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { LinkButton, buttonClass } from "@/components/ui/Button";
import { hrefWith, orderBy, SearchParams, SortTh, sp } from "@/components/ui/Table";
import { CATEGORY, DISPLAY_STATUS, label } from "@/lib/labels";
import { num } from "@/lib/format";

export const metadata = { title: "Inventario" };

interface Row {
  id: string; stock_number: string; category: string; make: string; model: string; version: string | null; model_year: number | null;
  usage_value: string | null; usage_unit: string; exterior_color: string | null; currency: string; list_price: string | null;
  offer_price: string | null; minimum_price: string | null; display_status: string; days_in_stock: number | null; cost_actual: string | null;
  cost_estimated_pending: string | null; potential_margin: string | null; potential_margin_pct: string | null; location_name: string | null;
  reservation_expires_at: string | null; primary_identifier: string | null; in_stock: boolean;
}

const ICON: Record<string, typeof Car> = { supercar: CarFront, premium_suv: Truck, sedan_gt: Car, classic: Gem, motorcycle: Bike, boat: Anchor, other: Car };
const SCOPES: Record<string, [string, string]> = {
  stock: ["En stock", "in_stock"],
  available: ["Disponibles", "display_status = 'available'"],
  pipeline: ["En tránsito y preparación", "display_status in ('purchase_approved','in_transit','in_customs','in_preparation','ready_not_listed','in_service','evaluation')"],
  sold: ["Vendidas", "commercial_status in ('sold_pending_delivery','delivered')"],
  all: ["Todas", "true"],
};

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const view = sp(params, "view") === "table" ? "table" : "showroom";
  const scope = SCOPES[sp(params, "scope") ?? ""] ? sp(params, "scope")! : "stock";
  const q = sp(params, "q")?.trim() ?? "";
  const cat = sp(params, "cat") ?? "";
  const status = sp(params, "status") ?? "";
  const showCost = can(ctx, "inventory.cost.read");
  const order = orderBy(params, {
    stock: "stock_number", unit: "make", days: "days_in_stock", price: "list_price", cost: "cost_actual", margin: "potential_margin_pct", status: "display_status",
  }, "days_in_stock desc nulls last");

  const rows = await query(ctx, (db) => db.rows<Row>(
    `select * from public.unit_overview
      where organization_id = $1 and (${SCOPES[scope][1]})
        and ($2 = '' or category = $2) and ($3 = '' or display_status = $3)
        and ($4 = '' or stock_number ilike '%' || $4 || '%' or make ilike '%' || $4 || '%' or model ilike '%' || $4 || '%'
             or coalesce(version, '') ilike '%' || $4 || '%' or coalesce(primary_identifier, '') ilike '%' || $4 || '%')
      order by ${order} limit 500`, [ctx.org.id, cat, status, q]));

  const byCcy = new Map<string, { list: number; cost: number; n: number }>();
  rows.filter((r) => r.in_stock).forEach((r) => {
    const t = byCcy.get(r.currency) ?? { list: 0, cost: 0, n: 0 };
    t.list += Number(r.list_price ?? 0); t.cost += Number(r.cost_actual ?? 0); t.n++;
    byCcy.set(r.currency, t);
  });
  const base = "/inventory";

  return (
    <>
      <PageHeader title="Inventario de activos" subtitle="Fuente única de verdad sobre unidades, estados y capital"
        actions={<>
          <div className="flex rounded-sm border border-line">
            <Link href={hrefWith(base, params, { view: null })} aria-current={view === "showroom"} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${view === "showroom" ? "bg-raised text-text" : "text-muted"}`}><LayoutGrid className="size-3.5" />Showroom</Link>
            <Link href={hrefWith(base, params, { view: "table" })} aria-current={view === "table"} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${view === "table" ? "bg-raised text-text" : "text-muted"}`}><Rows3 className="size-3.5" />Ejecutivo</Link>
          </div>
          {can(ctx, "inventory.write") && <LinkButton href="/inventory/new" variant="primary">Nueva unidad</LinkButton>}
        </>} />
      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(SCOPES).map(([k, [l]]) => (
          <Link key={k} href={hrefWith(base, params, { scope: k === "stock" ? null : k })}
            className={`${buttonClass(k === scope ? "secondary" : "ghost", "sm")}`}>{l}</Link>
        ))}
      </div>
      <FilterBar base={base} hidden={{ ...(view === "table" ? { view } : {}), ...(scope !== "stock" ? { scope } : {}) }} filters={[
        { name: "q", label: "Buscar", type: "search", value: q, placeholder: "Stock, marca, modelo, VIN" },
        { name: "cat", label: "Categoría", options: Object.entries(CATEGORY), value: cat, all: "Todas" },
        { name: "status", label: "Estado", options: Object.entries(DISPLAY_STATUS).map(([k, [l]]) => [k, l]), value: status, all: "Todos" },
      ]} />

      <p className="mb-3 text-xs text-muted">
        {num(rows.length)} unidades{[...byCcy.entries()].map(([c, t]) => (
          <span key={c}> · {c}: {num(t.n)} en stock, lista <Money value={t.list} currency={c} />{showCost && <>, coste real <Money value={t.cost} currency={c} /></>}</span>
        ))}
      </p>

      {rows.length === 0 ? (
        <Panel><Empty title="No hay unidades con estos filtros" hint="Ajuste la búsqueda o el alcance." /></Panel>
      ) : view === "showroom" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => {
            const Icon = ICON[r.category] ?? Car;
            return (
              <Link key={r.id} href={`/inventory/${r.id}`} className="group flex flex-col rounded-md border border-line bg-surface transition-colors hover:border-faint">
                <div className="relative flex h-32 items-end justify-between overflow-hidden rounded-t-md border-b border-line-soft bg-gradient-to-br from-raised to-surface px-4 pb-3">
                  <Icon aria-hidden strokeWidth={0.6} className="absolute -right-3 -top-4 size-36 text-line transition-colors group-hover:text-faint" />
                  <span className="relative text-[10px] uppercase tracking-[0.2em] text-muted">{label(CATEGORY, r.category)}</span>
                  <span className="relative"><StatusBadge map={DISPLAY_STATUS} value={r.display_status} /></span>
                </div>
                <div className="flex flex-1 flex-col px-4 py-3">
                  <div className="text-[11px] tracking-wider text-faint">{r.stock_number} · {r.model_year ?? "—"}</div>
                  <div className="mt-0.5 text-[15px] font-semibold tracking-tight text-text">{r.make} {r.model}</div>
                  <div className="truncate text-xs text-muted">{r.version ?? "—"} · {r.exterior_color ?? "—"} · {num(r.usage_value)} {r.usage_unit}</div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-faint">{r.offer_price ? "Oferta" : "Precio de lista"}</div>
                      <div className="text-base font-semibold text-text">{r.list_price ? <Money value={r.offer_price ?? r.list_price} currency={r.currency} /> : <span className="text-sm text-muted">Sin precio</span>}</div>
                    </div>
                    <div className="text-right text-xs text-muted">
                      {r.days_in_stock !== null ? `${r.days_in_stock} días` : "No recibida"}
                      <div className="text-faint">{r.location_name ?? "—"}</div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="mh-table">
              <thead>
                <tr>
                  <SortTh label="Stock" field="stock" base={base} params={params} defaultDir="asc" />
                  <SortTh label="Unidad" field="unit" base={base} params={params} defaultDir="asc" />
                  <th>Categoría</th>
                  <SortTh label="Estado" field="status" base={base} params={params} defaultDir="asc" />
                  <SortTh label="Días" field="days" base={base} params={params} right />
                  <SortTh label="Precio lista" field="price" base={base} params={params} right />
                  <th className="r">Mínimo</th>
                  {showCost && <SortTh label="Coste real" field="cost" base={base} params={params} right />}
                  {showCost && <th className="r">Estimado pend.</th>}
                  {showCost && <SortTh label="Margen pot." field="margin" base={base} params={params} right />}
                  <th>Ubicación</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/inventory/${r.id}`} className="text-text hover:text-accent">{r.stock_number}</Link></td>
                    <td><div className="text-text">{r.make} {r.model}</div><div className="text-xs text-muted">{r.version} · {r.model_year}</div></td>
                    <td className="text-text-2">{label(CATEGORY, r.category)}</td>
                    <td><StatusBadge map={DISPLAY_STATUS} value={r.display_status} /></td>
                    <td className="r num">{r.days_in_stock ?? "—"}</td>
                    <td className="r"><Money value={r.list_price} currency={r.currency} /></td>
                    <td className="r"><Money value={r.minimum_price} currency={r.currency} muted /></td>
                    {showCost && <td className="r"><Money value={r.cost_actual} currency={r.currency} /></td>}
                    {showCost && <td className="r">{Number(r.cost_estimated_pending) ? <Money value={r.cost_estimated_pending} currency={r.currency} className="text-warn" /> : <span className="text-faint">—</span>}</td>}
                    {showCost && <td className="r"><Pct value={r.potential_margin_pct} /></td>}
                    <td className="text-text-2">{r.location_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
