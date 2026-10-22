import type { Permission } from "@/domain/permissions";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** Visible si el usuario tiene al menos uno */
  anyOf: Permission[];
  group: "direccion" | "comercial" | "finanzas" | "control";
}

export const NAV: NavItem[] = [
  { key: "direccion", label: "Dirección", href: "/direccion", icon: "LayoutDashboard", anyOf: ["dashboard.view"], group: "direccion" },
  { key: "aprobaciones", label: "Aprobaciones", href: "/aprobaciones", icon: "Stamp", anyOf: ["deals.approve", "contracts.approve", "tradein.approve", "payables.approve", "expenses.approve"], group: "direccion" },
  { key: "inventario", label: "Inventario", href: "/inventario", icon: "CarFront", anyOf: ["inventory.view"], group: "comercial" },
  { key: "ventas", label: "Ventas", href: "/ventas", icon: "Handshake", anyOf: ["deals.view", "deals.view_all"], group: "comercial" },
  { key: "clientes", label: "Clientes", href: "/clientes", icon: "Users", anyOf: ["customers.view", "customers.view_all"], group: "comercial" },
  { key: "tradein", label: "Trade-in", href: "/tradein", icon: "ArrowLeftRight", anyOf: ["tradein.view"], group: "comercial" },
  { key: "financiaciones", label: "Financiaciones", href: "/financiaciones", icon: "Calculator", anyOf: ["contracts.view", "deals.create"], group: "finanzas" },
  { key: "cobranzas", label: "Cobranzas", href: "/cobranzas", icon: "HandCoins", anyOf: ["collections.view"], group: "finanzas" },
  { key: "compras", label: "Compras y proveedores", href: "/compras", icon: "Truck", anyOf: ["payables.view", "suppliers.view"], group: "finanzas" },
  { key: "gastos", label: "Gastos", href: "/gastos", icon: "Receipt", anyOf: ["expenses.view"], group: "finanzas" },
  { key: "caja", label: "Caja y movimientos", href: "/caja", icon: "Landmark", anyOf: ["cash.view"], group: "finanzas" },
  { key: "reportes", label: "Reportes", href: "/reportes", icon: "ChartColumn", anyOf: ["reports.view"], group: "control" },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", icon: "ShieldCheck", anyOf: ["audit.view"], group: "control" },
  { key: "configuracion", label: "Configuración", href: "/configuracion", icon: "Settings", anyOf: ["settings.manage", "users.manage"], group: "control" },
];

export const GROUP_LABELS: Record<NavItem["group"], string> = {
  direccion: "Dirección",
  comercial: "Comercial",
  finanzas: "Finanzas",
  control: "Control",
};
