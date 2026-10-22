import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { Notice } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import {
  AddBranchForm, AddBrandForm, AddCategoryForm, AddDocumentTypeForm, AgingBucketsForm, BrandToggle, DOC_ENTITIES, DocTypeToggle,
  MemberActiveButton, NewUserDialog, OrganizationForm, RoleSelect, SettingsForm,
} from "@/components/settings/settings-forms";
import { ROLE_LABELS, ROLES, isRole, type Role } from "@/domain/permissions";
import { formatDate } from "@/lib/format";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { getSettings } from "@/server/queries/common";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("settings.manage", "users.manage");
  const sp = await searchParams;
  const canSettings = ctx.perms.has("settings.manage");
  const canUsers = ctx.perms.has("users.manage");
  const tabs = [
    ...(canSettings ? [{ key: "general", label: "General", href: "/configuracion" }] : []),
    ...(canUsers ? [{ key: "usuarios", label: "Usuarios", href: "/configuracion?vista=usuarios" }] : []),
    { key: "roles", label: "Roles y permisos", href: "/configuracion?vista=roles" },
    ...(canSettings ? [{ key: "catalogos", label: "Catálogos", href: "/configuracion?vista=catalogos" }] : []),
  ];
  const wanted = param(sp, "vista") ?? tabs[0]!.key;
  const tab = tabs.some((t) => t.key === wanted) ? wanted : tabs[0]!.key;

  return (
    <>
      <PageHeader title="Configuración" description="Parámetros de la organización, usuarios y roles, y catálogos. Cada cambio queda registrado en la auditoría." />
      <Tabs active={tab} items={tabs} />
      {tab === "general" ? <General ctx={ctx} /> : tab === "usuarios" ? <Users ctx={ctx} /> : tab === "roles" ? <RolesMatrix ctx={ctx} /> : <Catalogs ctx={ctx} />}
    </>
  );
}

async function General({ ctx }: { ctx: AppContext }) {
  const [settings, [org], buckets] = await Promise.all([
    getSettings(ctx),
    ctx.db((tx) => tx<{ name: string; legal_name: string | null; tax_id: string | null; base_currency: string; timezone: string; is_demo: boolean; created_at: string }[]>`
      select name, legal_name, tax_id, base_currency, timezone, is_demo, created_at from public.organizations where id = ${ctx.org.id}`),
    ctx.db((tx) => tx<{ label: string; min_days: number; max_days: number | null }[]>`
      select label, min_days, max_days from public.aging_buckets where org_id = ${ctx.org.id} order by sort_order`),
  ]);
  const limits = buckets.filter((b) => b.max_days !== null && b.max_days > 0).map((b) => b.max_days!);
  return (
    <div className="space-y-5">
      <Panel title="Organización">
        <OrganizationForm org={org!} />
        <div className="mt-5 border-t border-line-soft pt-4">
          <DescriptionList cols={3} items={[
            { label: "Moneda base", value: org!.base_currency, hint: "Fija una vez registradas operaciones: todos los importes «base» dependen de ella." },
            { label: "Zona horaria", value: org!.timezone, hint: "Define el «hoy» para vencimientos y mora." },
            { label: "Tipo", value: org!.is_demo ? <StatusPill tone="brand">Demostración</StatusPill> : "Operativa" },
          ]} />
        </div>
      </Panel>
      <Panel title="Parámetros comerciales y financieros" description="Se aplican en el servidor y en la base de datos, no sólo en pantalla.">
        <SettingsForm settings={settings} />
      </Panel>
      <Panel title="Tramos de mora" description="Agrupan la cartera vencida por días de atraso en cobranzas, tablero y reportes.">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {buckets.map((b) => <StatusPill key={b.label}>{b.label}</StatusPill>)}
        </div>
        <AgingBucketsForm limits={limits} />
      </Panel>
    </div>
  );
}

/** Roles que el usuario actual puede asignar: sólo un director asigna «director». */
function assignableRoles(ctx: AppContext): Role[] {
  return ROLES.filter((r) => r !== "director" || ctx.org.role === "director");
}

async function Users({ ctx }: { ctx: AppContext }) {
  const members = await ctx.db((tx) => tx<{ id: string; user_id: string; full_name: string; email: string | null; role: string; is_active: boolean; created_at: Date }[]>`
    select m.id, m.user_id, u.full_name, e.email, m.role, m.is_active, m.created_at
    from public.memberships m join public.user_profiles u on u.id = m.user_id
    left join public.rpc_member_emails(${ctx.org.id}) e on e.user_id = m.user_id
    where m.org_id = ${ctx.org.id} order by m.is_active desc, u.full_name`);
  const assignable = assignableRoles(ctx);
  return (
    <Panel title="Usuarios de la organización" description="Los permisos dependen del rol. Nadie puede cambiar su propio rol ni desactivarse; sólo un director asigna o retira el rol de director."
      actions={<NewUserDialog assignable={assignable} />} bodyClassName="p-0">
      <TableWrap className="rounded-none border-0">
        <Table>
          <THead><Th>Nombre</Th><Th>Correo</Th><Th>Rol</Th><Th>Estado</Th><Th>Alta</Th><Th /></THead>
          <tbody>
            {members.map((m) => {
              const self = m.user_id === ctx.userId;
              const role = isRole(m.role) ? m.role : "vendedor";
              const locked = self || (role === "director" && ctx.org.role !== "director");
              return (
                <Tr key={m.id}>
                  <Td className="whitespace-nowrap text-ink">{m.full_name}{self ? <span className="ml-1.5 text-[11.5px] text-faint">(usted)</span> : null}</Td>
                  <Td muted>{m.email ?? "—"}</Td>
                  <Td>{locked || !m.is_active ? <span className="text-ink-2">{ROLE_LABELS[role]}</span> : <RoleSelect memberId={m.id} role={role} assignable={assignable} />}</Td>
                  <Td>{m.is_active ? <StatusPill tone="positive">Activo</StatusPill> : <StatusPill>Inactivo</StatusPill>}</Td>
                  <Td className="num" muted>{formatDate(m.created_at)}</Td>
                  <Td className="text-right">{locked ? null : <MemberActiveButton memberId={m.id} active={m.is_active} name={m.full_name} />}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
    </Panel>
  );
}

const MODULE_LABELS: Record<string, string> = {
  direccion: "Dirección", inventario: "Inventario", clientes: "Clientes", ventas: "Ventas", contratos: "Contratos y financiación",
  cobranzas: "Cobranzas", pagos: "Pagos", tradein: "Trade-in", compras: "Compras y proveedores", gastos: "Gastos", caja: "Caja",
  reportes: "Reportes", auditoria: "Auditoría", documentos: "Documentos", configuracion: "Configuración",
};

async function RolesMatrix({ ctx }: { ctx: AppContext }) {
  const [perms, grants] = await Promise.all([
    ctx.db((tx) => tx<{ key: string; module: string; description: string }[]>`select key, module, description from public.permissions order by module, key`),
    ctx.db((tx) => tx<{ role: string; permission: string }[]>`select role, permission from public.role_permissions`),
  ]);
  const has = new Set(grants.map((g) => `${g.role}|${g.permission}`));
  return (
    <>
      <div className="mb-4"><Notice>La matriz se lee de la base de datos, que es la que aplica los permisos (políticas RLS y funciones). Cambiarla requiere una migración revisada: no se edita desde la interfaz.</Notice></div>
      <TableWrap className="max-h-[75vh]">
        <Table>
          <THead>
            <Th className="sticky left-0 bg-surface">Permiso</Th>
            {ROLES.map((r) => <Th key={r} className="text-center normal-case tracking-normal">{ROLE_LABELS[r]}</Th>)}
          </THead>
          <tbody>
            {perms.map((p, i) => {
              const header = i === 0 || perms[i - 1]!.module !== p.module;
              return [
                header ? (
                  <tr key={`m-${p.module}`} className="border-b border-line-soft bg-elevated/40">
                    <td colSpan={ROLES.length + 1} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{MODULE_LABELS[p.module] ?? p.module}</td>
                  </tr>
                ) : null,
                <Tr key={p.key}>
                  <Td className="sticky left-0 min-w-72 bg-surface"><span className="block text-ink-2">{p.description}</span><span className="font-mono text-[11px] text-faint">{p.key}</span></Td>
                  {ROLES.map((r) => (
                    <Td key={r} className="text-center">
                      {has.has(`${r}|${p.key}`) ? <Check className="mx-auto size-4 text-positive" aria-label="Sí" /> : <span className="text-line" aria-label="No">·</span>}
                    </Td>
                  ))}
                </Tr>,
              ];
            })}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}

async function Catalogs({ ctx }: { ctx: AppContext }) {
  const [brands, categories, branches, docTypes] = await Promise.all([
    ctx.db((tx) => tx<{ id: string; name: string; is_active: boolean; units: number }[]>`
      select b.id, b.name, b.is_active, (select count(*)::int from public.vehicles v where v.brand_id = b.id) as units
      from public.brands b where b.org_id = ${ctx.org.id} order by b.sort_order, b.name`),
    ctx.db((tx) => tx<{ id: string; name: string }[]>`select id, name from public.vehicle_categories where org_id = ${ctx.org.id} order by name`),
    ctx.db((tx) => tx<{ id: string; name: string; address: string | null; city: string | null; is_active: boolean }[]>`
      select id, name, address, city, is_active from public.branches where org_id = ${ctx.org.id} order by name`),
    ctx.db((tx) => tx<{ id: string; entity_type: string; name: string; is_required: boolean; applies_to_condition: string | null }[]>`
      select id, entity_type, name, is_required, applies_to_condition from public.document_types where org_id = ${ctx.org.id} order by entity_type, name`),
  ]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Marcas" description="Una marca desactivada no se ofrece para unidades nuevas; las existentes no cambian.">
        <ul className="mb-4 divide-y divide-line-soft">
          {brands.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <span className={b.is_active ? "text-ink" : "text-faint line-through"}>{b.name} <span className="text-[12px] text-faint no-underline">· {b.units} unidades</span></span>
              <BrandToggle id={b.id} active={b.is_active} />
            </li>
          ))}
        </ul>
        <AddBrandForm />
      </Panel>
      <Panel title="Categorías de vehículo">
        <div className="mb-4 flex flex-wrap gap-1.5">{categories.length ? categories.map((c) => <StatusPill key={c.id}>{c.name}</StatusPill>) : <span className="text-[13px] text-faint">Sin categorías</span>}</div>
        <AddCategoryForm />
      </Panel>
      <Panel title="Sucursales" className="lg:col-span-2">
        {branches.length ? (
          <ul className="mb-4 divide-y divide-line-soft">
            {branches.map((b) => <li key={b.id} className="py-2 text-[13px]"><span className="text-ink">{b.name}</span> <span className="text-faint">{[b.address, b.city].filter(Boolean).join(", ")}</span></li>)}
          </ul>
        ) : <p className="mb-4 text-[13px] text-faint">Sin sucursales registradas.</p>}
        <AddBranchForm />
      </Panel>
      <Panel title="Tipos de documento" description="Los obligatorios determinan la alerta de documentación incompleta." className="lg:col-span-2" bodyClassName="p-0">
        <TableWrap className="rounded-none border-0">
          <Table>
            <THead><Th>Aplica a</Th><Th>Documento</Th><Th>Condición</Th><Th>Obligatorio</Th><Th /></THead>
            <tbody>
              {docTypes.map((d) => (
                <Tr key={d.id}>
                  <Td muted>{DOC_ENTITIES[d.entity_type] ?? d.entity_type}</Td>
                  <Td className="text-ink">{d.name}</Td>
                  <Td muted>{d.applies_to_condition === "nuevo" ? "0 km" : d.applies_to_condition === "usado" ? "Usados" : "Todas"}</Td>
                  <Td>{d.is_required ? <StatusPill tone="warning">Obligatorio</StatusPill> : <span className="text-faint">Opcional</span>}</Td>
                  <Td className="text-right"><DocTypeToggle id={d.id} required={d.is_required} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <div className="border-t border-line-soft p-4"><AddDocumentTypeForm /></div>
      </Panel>
    </div>
  );
}
