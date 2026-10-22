/**
 * Roles y permisos. La fuente de verdad es la base de datos
 * (public.role_permissions); esta copia permite construir la navegación sin
 * consultas adicionales. Una prueba de base de datos verifica que coincidan.
 * Nunca se usa para autorizar: el servidor consulta los permisos efectivos
 * del usuario y la base de datos los vuelve a verificar (RLS y RPC).
 */

export const ROLES = [
  "director",
  "administracion",
  "gerencia_comercial",
  "vendedor",
  "cobranzas",
  "inventario",
  "finanzas",
  "auditor",
  "admin_tecnico",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  director: "Director",
  administracion: "Administración",
  gerencia_comercial: "Gerencia comercial",
  vendedor: "Vendedor",
  cobranzas: "Cobranzas",
  inventario: "Inventario",
  finanzas: "Finanzas",
  auditor: "Auditor",
  admin_tecnico: "Administrador técnico",
};

export const PERMISSIONS = [
  "dashboard.view",
  "inventory.view",
  "inventory.create",
  "inventory.edit",
  "inventory.pricing.edit",
  "inventory.costs.view",
  "inventory.costs.create",
  "inventory.costs.edit_history",
  "customers.view",
  "customers.view_all",
  "customers.create",
  "customers.edit",
  "crm.manage",
  "deals.view",
  "deals.view_all",
  "deals.create",
  "deals.approve",
  "deals.formalize",
  "deals.deliver",
  "deals.cancel",
  "reservations.manage",
  "contracts.view",
  "contracts.adjust",
  "contracts.approve",
  "payments.view",
  "payments.register",
  "payments.confirm",
  "payments.reverse",
  "collections.view",
  "collections.manage",
  "collections.assign",
  "tradein.view",
  "tradein.create",
  "tradein.approve",
  "tradein.acquire",
  "suppliers.view",
  "suppliers.manage",
  "payables.view",
  "payables.create",
  "payables.approve",
  "payables.pay",
  "expenses.view",
  "expenses.create",
  "expenses.approve",
  "cash.view",
  "cash.register",
  "cash.reverse",
  "cash.reconcile",
  "reports.view",
  "reports.export",
  "audit.view",
  "documents.view_restricted",
  "settings.manage",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];
const READ_ONLY = PERMISSIONS.filter(
  (p) => p.endsWith(".view") || p.endsWith(".view_all") || p === "reports.export" || p === "documents.view_restricted",
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  director: ALL,
  auditor: READ_ONLY,
  administracion: [
    "dashboard.view", "inventory.view", "inventory.costs.view", "inventory.costs.create",
    "customers.view", "customers.view_all", "customers.create", "customers.edit",
    "deals.view", "deals.view_all", "deals.formalize", "deals.deliver",
    "contracts.view", "contracts.adjust", "payments.view", "payments.register", "payments.confirm",
    "collections.view", "tradein.view", "suppliers.view", "suppliers.manage",
    "payables.view", "payables.create", "expenses.view", "expenses.create",
    "cash.view", "cash.register", "reports.view", "documents.view_restricted",
  ],
  gerencia_comercial: [
    "dashboard.view", "inventory.view", "inventory.pricing.edit", "inventory.costs.view",
    "customers.view", "customers.view_all", "customers.create", "customers.edit", "crm.manage",
    "deals.view", "deals.view_all", "deals.create", "deals.approve", "deals.formalize", "deals.deliver", "deals.cancel",
    "reservations.manage", "contracts.view", "payments.view", "collections.view",
    "tradein.view", "tradein.create", "tradein.approve", "reports.view",
  ],
  vendedor: [
    "inventory.view", "customers.view", "customers.create", "customers.edit", "crm.manage",
    "deals.view", "deals.create", "reservations.manage", "tradein.view", "tradein.create",
  ],
  cobranzas: [
    "customers.view", "customers.view_all", "contracts.view", "payments.view", "payments.register",
    "collections.view", "collections.manage", "collections.assign",
  ],
  inventario: [
    "inventory.view", "inventory.create", "inventory.edit", "inventory.costs.view", "inventory.costs.create",
    "tradein.view", "tradein.acquire", "suppliers.view", "payables.view", "payables.create", "expenses.view",
  ],
  finanzas: [
    "dashboard.view", "inventory.view", "inventory.costs.view", "inventory.costs.edit_history",
    "customers.view", "customers.view_all", "deals.view", "deals.view_all",
    "contracts.view", "contracts.adjust", "contracts.approve",
    "payments.view", "payments.register", "payments.confirm", "payments.reverse",
    "collections.view", "collections.assign", "tradein.view", "tradein.acquire",
    "suppliers.view", "suppliers.manage", "payables.view", "payables.create", "payables.approve", "payables.pay",
    "expenses.view", "expenses.create", "expenses.approve",
    "cash.view", "cash.register", "cash.reverse", "cash.reconcile",
    "reports.view", "reports.export", "documents.view_restricted",
  ],
  admin_tecnico: ["audit.view", "settings.manage", "users.manage"],
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export class PermissionSet {
  private readonly set: ReadonlySet<string>;
  constructor(permissions: Iterable<string>) {
    this.set = new Set(permissions);
  }
  has(p: Permission): boolean {
    return this.set.has(p);
  }
  any(...ps: Permission[]): boolean {
    return ps.some((p) => this.set.has(p));
  }
  all(...ps: Permission[]): boolean {
    return ps.every((p) => this.set.has(p));
  }
  list(): string[] {
    return [...this.set].sort();
  }
}
