# Arquitectura

## Capas

```
Navegador ──► Next.js (App Router, Server Components + Server Actions)
                 │  src/proxy.ts            renueva la sesión de Supabase Auth
                 │  src/server/auth         sesión validada (getUser), organización activa, permisos
                 │  src/server/action.ts    guarded(): sesión + permiso + errores legibles
                 │  src/server/queries      lecturas
                 │  src/server/actions      escrituras (validación zod → RPC / SQL)
                 ▼
          PostgreSQL (Supabase)
                 │  withUser(): BEGIN; set_config('request.jwt.claims'); SET LOCAL ROLE authenticated
                 │  RLS en todas las tablas           (app.has_perm / app.is_member)
                 │  funciones rpc_* SECURITY DEFINER  (app.require_perm + bloqueos de fila)
                 │  vistas security_invoker           (saldos, mora, economía de unidades)
                 │  triggers                          (guardas de estado, auditoría, inmutabilidad)
                 ▼
          Supabase Storage (buckets privados, URL firmadas de 60 s)
```

La lógica financiera pura vive en `src/domain/` (sin dependencias, probada unitariamente) y
se usa en el simulador, el constructor de operaciones y el PDF. Al formalizar, el cronograma
definitivo se genera con el mismo motor y se inserta en la misma transacción que el contrato.

Las consultas se ejecutan con la identidad del usuario (no con una cuenta de servicio): aunque
una consulta del servidor olvidara un filtro, RLS impide ver o modificar filas sin permiso.
La clave service_role sólo se usa para crear cuentas de acceso en Configuración → Usuarios.

## Modelo de datos (principales)

| Dominio | Tablas |
|---|---|
| Organización | `organizations`, `branches`, `user_profiles`, `roles`, `permissions`, `role_permissions`, `memberships`, `org_settings`, `aging_buckets`, `exchange_rates`, `document_sequences` |
| Inventario | `brands`, `vehicle_categories`, `vehicles`, `vehicle_status_events`, `vehicle_costs`, `vehicle_photos`, `document_types`, `documents` |
| Comercial | `customers`, `customer_interactions`, `leads`, `pipeline_stages`, `opportunities`, `deals`, `deal_events`, `reservations`, `proposals`, `approvals`, `trade_in_appraisals`, `appraisal_inspections` |
| Financiación | `contracts`, `contract_versions`, `financing_plans`, `installments`, `contract_ledger_entries` |
| Cobros | `customer_payments`, `payment_allocations` (N:M pago↔cuota), `payment_reversals`, `collection_actions` |
| Compras y gastos | `suppliers`, `supplier_invoices`, `supplier_payments`, `expenses` |
| Caja | `cash_accounts`, `cash_movements`, `reconciliations` |
| Control | `audit_events` |

Convenciones:

- Importes `numeric(18,2)` con su `currency` explícita en cada fila; `app.money_ok` impide
  decimales en PYG. Conversión a moneda base con `fx_rate_to_base` fijado en el momento del hecho.
- Claves foráneas compuestas `(id, org_id)`: es imposible vincular registros de otra organización.
- Cinco estados independientes por unidad: físico, comercial, contractual, preparación y
  documentación. El comercial y el contractual sólo los cambian las funciones transaccionales.
- Numeración legible sin huecos por organización y año (`U-2026-00001`, `V-…`, `C-…`, `P-…`).

## Concurrencia

- Reservas: índice único parcial «una reserva activa por unidad» + `SELECT … FOR UPDATE` de la
  unidad dentro de `rpc_reservation_create`.
- Ventas: índice único parcial «una operación formalizada por unidad» y bloqueo de la unidad en
  `rpc_deal_formalize`; dos formalizaciones simultáneas → una falla con mensaje claro.
- Pagos: la confirmación bloquea el pago y el contrato; las aplicaciones se validan con un
  trigger diferido que impide aplicar más que el saldo de la cuota o el importe del pago.
- `row_version` en unidades para detectar ediciones concurrentes de la ficha.

Las pruebas `tests/db/sales-flow.test.ts` ejecutan reservas y formalizaciones en paralelo real.

## Saldos verificables

El saldo de un contrato nunca se escribe: se calcula (`v_contract_balances`) como
cuotas − aplicaciones de pagos confirmados. En paralelo se mantiene un libro mayor
(`contract_ledger_entries`) append-only; `rpc_contract_consistency` comprueba que ambos
coincidan y la ficha del contrato muestra el resultado («Saldos verificados»).

Las correcciones se hacen con movimientos nuevos: reversión de pago (contraasiento de caja +
aplicaciones negativas + asiento en el mayor), notas de crédito y ajustes con aprobación,
refinanciación con nueva versión de contrato. Nada confirmado se borra.

## Gráficos

Componentes propios renderizados en el servidor (`src/components/charts`): una serie por
gráfico, colores validados contra la superficie oscura, tooltip por elemento y tabla «Ver
datos» accesible. Con datos vacíos muestran un estado vacío, nunca valores de relleno.
