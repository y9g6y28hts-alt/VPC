# Seguridad

## Principios

1. **Defensa en profundidad**: el servidor verifica el permiso antes de cada acción
   (`guarded()` / `requirePerm()`), las funciones `rpc_*` lo verifican de nuevo
   (`app.require_perm`) y las políticas RLS impiden leer o escribir filas sin permiso aunque
   alguien use la API de datos de Supabase directamente con su JWT.
2. **Identidad real en la base**: cada consulta corre como `authenticated` con los claims del
   usuario; `auth.uid()` identifica al autor en auditoría y segregación de funciones.
3. **Sin secretos en el cliente**: sólo `NEXT_PUBLIC_SUPABASE_URL` y la clave anon llegan al
   navegador. `DATABASE_URL` y la clave service_role se leen exclusivamente en módulos
   `server-only`.
4. **Nada confirmado se borra**: pagos, movimientos, aplicaciones, asientos, versiones de
   contrato, propuestas y auditoría son append-only (privilegios revocados + trigger).
   Las correcciones son reversiones auditables.

## Roles

La matriz completa está en Configuración → Roles y permisos (leída de `role_permissions`) y en
`supabase/migrations/20261022000100_foundation.sql`. Resumen:

| Rol | Alcance |
|---|---|
| Director | Todo, incluidas aprobaciones de cualquier tipo |
| Administración | Formaliza y entrega, registra y confirma pagos, ajustes, proveedores, caja (sin revertir ni conciliar) |
| Gerencia comercial | Precios, aprobación de descuentos y tasaciones, CRM, ventas de todos |
| Vendedor | Sus clientes y operaciones, reservas, tasaciones; **no** ve costes, márgenes, caja ni pagos confirmados de otros |
| Cobranzas | Cartera, gestiones, promesas, registro de pagos (no confirma) |
| Inventario | Alta y ficha de unidades, costes, documentación |
| Finanzas | Caja, conciliación, reversiones, pagos a proveedores, aprobaciones financieras |
| Auditor | Sólo lectura de todo, auditoría y exportación |
| Administrador técnico | Usuarios y configuración; no opera ni ve finanzas |

Reglas destacadas verificadas por pruebas:

- Un vendedor no puede alterar pagos confirmados, editar costes históricos
  (`inventory.costs.edit_history`) ni ver costes: `v_vehicle_economics` devuelve `NULL`.
- Quien solicita una aprobación no puede aprobarla (salvo el director).
- Nadie cambia su propio rol ni se desactiva; sólo un director asigna o retira «director».
- Un pago registrado no reduce saldos hasta que otro usuario con `payments.confirm` lo confirma.
- Documentos restringidos (`documents.view_restricted`) sólo para roles autorizados; los
  archivos se sirven tras comprobar el registro con RLS, por URL firmada de 60 segundos.
- Archivos subidos: tipo verificado por firma binaria (PDF, JPEG, PNG, WebP) y límite de tamaño.
- Exportaciones CSV: requieren `reports.export` y quedan en la auditoría con sus filtros.

## Auditoría

`audit_events` registra automáticamente altas y modificaciones (valor anterior y nuevo) de
unidades, costes, documentos, clientes, operaciones, reservas, aprobaciones, tasaciones,
contratos, pagos, movimientos, facturas, gastos, membresías, configuración, catálogos y tipos
de cambio, más eventos de negocio (venta formalizada, pago confirmado/revertido, conciliación,
exportación…). Es legible con `audit.view` y no se puede modificar ni borrar.

## Datos de demostración

La organización demo tiene `is_demo = true` (inmutable desde la aplicación), está aislada por
RLS y la interfaz, los PDF y las exportaciones la marcan como «DATOS DE DEMOSTRACIÓN».
`db:reset` y `db:seed-demo` se niegan a ejecutarse con `NODE_ENV=production`.

## Cabeceras

`next.config.ts` aplica `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` y `Permissions-Policy` restrictiva.
