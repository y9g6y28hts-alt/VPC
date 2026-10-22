import { getContext, can } from "@/server/context";
import { ROLE } from "@/lib/labels";
import { Sidebar, NavGroup } from "./Sidebar";
import { logoutAction } from "../login/actions";
import { isEmbedded } from "@/server/driver";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const groups: NavGroup[] = [
    { label: "Dirección", items: [
      { href: "/", label: "Centro de control", icon: "gauge", show: can(ctx, "report.read", "deal.read", "receivable.read", "treasury.read", "inventory.read") },
      { href: "/reports", label: "Rentabilidad y reportes", icon: "chart", show: can(ctx, "report.read") },
    ] },
    { label: "Activos", items: [
      { href: "/inventory", label: "Inventario", icon: "car", show: can(ctx, "inventory.read") },
      { href: "/imports", label: "Importaciones", icon: "ship", show: can(ctx, "import.read") },
      { href: "/service", label: "Preparación y servicio", icon: "wrench", show: can(ctx, "service.read") },
    ] },
    { label: "Comercial", items: [
      { href: "/customers", label: "Clientes", icon: "users", show: can(ctx, "customer.read") },
      { href: "/deals", label: "Mesa de negociación", icon: "handshake", show: can(ctx, "deal.read", "deal.read_own") },
      { href: "/appraisals", label: "Tasaciones", icon: "scale", show: can(ctx, "tradein.read") },
      { href: "/contracts", label: "Contratos y reservas", icon: "file", show: can(ctx, "deal.read", "deal.read_own", "receivable.read") },
    ] },
    { label: "Finanzas", items: [
      { href: "/receivables", label: "Cuentas por cobrar", icon: "receipt", show: can(ctx, "receivable.read", "receivable.read_own") },
      { href: "/payments", label: "Pagos recibidos", icon: "banknote", show: can(ctx, "payment.read") },
      { href: "/treasury", label: "Tesorería", icon: "landmark", show: can(ctx, "treasury.read") },
      { href: "/payables", label: "Cuentas por pagar", icon: "wallet", show: can(ctx, "payable.read") },
    ] },
    { label: "Control", items: [
      { href: "/approvals", label: "Aprobaciones", icon: "stamp", show: can(ctx, "deal.approve", "tradein.approve", "payable.approve", "deal.write") },
      { href: "/documents", label: "Documentos", icon: "files", show: can(ctx, "document.read") },
      { href: "/audit", label: "Auditoría", icon: "shield", show: can(ctx, "audit.read") },
      { href: "/admin", label: "Administración", icon: "settings", show: can(ctx, "admin.users", "admin.policies") },
    ] },
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <Sidebar
        groups={groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length)}
        org={ctx.org.name}
        isDemo={ctx.org.isDemo}
        user={ctx.user.name || ctx.user.email}
        role={ROLE[ctx.role] ?? ctx.role}
        logout={logoutAction}
      />
      <div className="min-w-0">
        {ctx.org.isDemo && (
          <div className="border-b border-warn/25 bg-warn-bg px-4 py-1.5 text-center text-[11px] tracking-wide text-warn lg:px-8">
            DATOS DE DEMOSTRACIÓN · organización ficticia; ninguna cifra corresponde a resultados reales
            {isEmbedded() && " · base embebida: los cambios son temporales y pueden reiniciarse"}
          </div>
        )}
        <main className="mx-auto max-w-[1440px] px-4 py-5 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
