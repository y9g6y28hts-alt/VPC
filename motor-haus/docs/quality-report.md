# Motor Haus · Informe de calidad y riesgos pendientes

Fecha de verificación: 22/10/2026. Entorno: PostgreSQL 16 local con shim de Supabase, Next.js 16.4, Node 22, Chromium headless.

## Cómo se verificó

| Verificación | Comando | Resultado |
|---|---|---|
| Motor financiero (unitarias) | `npm run test:unit` | 20/20 |
| Reglas de negocio contra PostgreSQL | `npm run test:db` (business) | 22/22 |
| Seguridad, RLS y aislamiento | `npm run test:db` (security) | 10/10 |
| Tipos estrictos | `npm run typecheck` | sin errores |
| Build de producción | `npm run build` | correcto, 35 rutas |
| Seed por funciones de negocio reales | `npm run db:seed` | completo (9 contratos, 21 unidades, pagos, reversión, tasaciones, alertas) |
| Recorrido de 33 pantallas como director | `tsx --env-file=.env scripts/crawl.ts` | todas cargan sin errores de servidor ni de consola |
| E2E por la interfaz (negociación → autorización → propuesta → formalización → pago → conciliación → auditoría) | `npm run e2e` | 12/12 pasos |

## Criterios de aceptación

### Verificados con pruebas automatizadas

**Inventario**
- No se puede vender dos veces una unidad, ni con formalizaciones simultáneas (prueba concurrente).
- Dos reservas simultáneas de la misma unidad: solo una tiene éxito; una reserva vencida libera la unidad.
- Una unidad recibida queda en preparación; no puede habilitarse con tareas o documentos obligatorios pendientes.
- Estados, precios y fechas de negocio no se modifican con UPDATE directos; precios con historial, motivo y concurrencia optimista.
- Costes reales y estimados se suman por separado; otra moneda exige cotización; VIN duplicado rechazado salvo excepción documentada.

**Ventas y negociación**
- Descuento sobre el límite y margen bajo generan autorizaciones; el vendedor/solicitante no puede aprobar; cambiar términos anula la solicitud y bloquea la formalización.
- El margen usa los costes registrados; el margen de reventa del trade-in se informa aparte.
- El servidor rechaza calendarios manipulados (interés alterado), con capital distinto o con tasa inconsistente.
- La formalización genera obligaciones que reconcilian con el contrato (discrepancia 0) e inmutables.
- Monedas distintas no se mezclan en una operación.

**Trade-in**
- La tasación no crea inventario; el valor de mercado exige fuente y fecha; margen y porcentaje calculados con los costes estimados; la adquisición exige aceptación en contrato.

**Cuentas por cobrar**
- Pago parcial que cubre varias cuotas se asigna en orden y solo cuenta al confirmarse.
- Idempotencia del formulario de pago; misma referencia bancaria rechazada.
- Pago revertido deja de contar como cobrado y genera contrapartida de caja; los movimientos no se editan.
- No hay sobreasignación ni pagos en otra moneda o cuenta.
- La mora se determina por fecha exigible + período de gracia (probado con fecha "al").
- El estado de cuenta reconcilia con el saldo pendiente; un ajuste no puede dejar la cuota por debajo de lo cobrado.
- Segregación: quien registra un pago no lo confirma; un asesor no confirma pagos.

**Finanzas**
- Francés con tasa cero y positiva (coincide con la fórmula cerrada), alemán con interés sobre saldo, refuerzos, primer período irregular, recorte de fin de mes, entregas variables, calendario personalizado, prepago (reducción de cuota y de plazo), guaraníes sin decimales, TNA ≠ TEA.
- El PDF de la propuesta se genera desde la instantánea validada (sin costes ni márgenes) y verifica su integridad.

**Seguridad**
- Aislamiento entre organizaciones; sin claims no se lee nada; el rol de conexión no tiene privilegios propios.
- El asesor no ve costes (recibe NULL, no cero) ni operaciones de otro asesor; el administrador técnico no ve finanzas.
- Documentos de identidad no legibles por columna; acceso por función auditada; la auditoría no copia documentos completos.
- El auditor no puede escribir; un asesor no crea organizaciones; `audit_events` y documentos emitidos no se modifican ni eliminan (ni como superusuario).
- PDF y fotos: acceso autorizado (dueño 200, otro asesor 403/404, anónimo 401).

### Verificados manualmente (capturas)

Centro de control, showroom y vista ejecutiva, ficha de unidad, mesa de negociación, cartera, estado de cuenta, PDF de propuesta, vista móvil del centro de control. Estados vacíos, de carga y de error implementados para todas las vistas.

## Despliegue de demostración embebido

Sin base configurada, la app usa PostgreSQL embebido (PGlite 0.5, PostgreSQL 18) generado en el build con las mismas migraciones y el mismo seed. Verificado con build limpio en producción: 27 pantallas, PDF y negociación por la interfaz (`scripts/smoke-demo.ts`). Los cambios en ese modo son temporales y por instancia.

## Parcialmente implementado

| Funcionalidad | Estado |
|---|---|
| Supabase Auth (`MH_AUTH_MODE=supabase`) y Supabase Storage | Código implementado; **no verificado contra un proyecto Supabase real** (no hay credenciales en este entorno). Las migraciones usan solo objetos compatibles con Supabase. |
| Reprogramación por pago extraordinario | Motor probado (`applyPrepayment`); falta la interfaz para emitir una nueva versión contractual. |
| Órdenes de compra | Tablas, seed y vínculo con embarques; falta formulario de alta y aprobación de OC. |
| Órdenes de servicio e inspecciones de unidades | Tablas y RLS; la preparación operativa usa tareas (con interfaz); faltan formularios de órdenes de servicio. |
| Leads y oportunidades | Tablas y RLS; el CRM usa interacciones y operaciones; falta embudo de oportunidades. |
| Conciliación bancaria | Marcado de movimientos y diferencia contra extracto; sin importación de extractos. |
| Cotizaciones | Se registran por movimiento/coste; falta pantalla de tabla de cotizaciones. |
| Filtros por sucursal | Soportados por el modelo y el resumen ejecutivo; la demo tiene una sola sucursal y la interfaz no muestra el filtro. |
| Notificaciones a clientes | Se registra la intención y se declara "no enviado: sin canal"; no hay integración de WhatsApp/correo. |

## Pendiente

- Anulación/rescisión de contratos formalizados y devolución de unidades.
- Edición de plantillas de documentos y firma electrónica (los PDF no tienen validez jurídica; el contrato es un borrador sujeto a revisión legal).
- Supabase Realtime para refresco en vivo (las vistas se actualizan al navegar o tras cada acción).
- Monitorización y alertas operativas (hoy: registro de errores en consola del servidor).
- ESLint y pruebas de componentes de interfaz.
- Tarea programada `pg_cron` para expirar reservas (documentada; sin ella se liberan en la siguiente operación sobre la unidad).
- Integración bancaria y de fuentes de valor de mercado (no simuladas).

## Riesgos y limitaciones conocidas

1. **Resultado operativo de base mixta**: margen bruto realizado − gastos pagados en el período; se rotula como tal y no sustituye al resultado contable.
2. **Margen realizado** usa los costes reales congelados al formalizar; los costes posteriores a la venta se muestran aparte en Reportes.
3. **Conversión comercial** en la demo: todas las operaciones del seed se crearon el día de la carga, por lo que la métrica de conversión del período está sesgada.
4. **Fecha de negocio**: `America/Asuncion` (configurable con `MH_TIMEZONE`). Datos sembrados en otra zona horaria pueden desplazar un día las fechas relativas cerca de medianoche UTC.
5. **Rendimiento**: las alertas recalculan la economía de cada operación en borrador; adecuado para cientos de unidades y operaciones; para volúmenes mayores conviene materializar vistas.
6. **Autenticación local**: solo para desarrollo y demostraciones; bloqueada en producción salvo habilitación explícita.
7. **Importes en JSON**: la economía de la operación viaja como números JSON; precisión exacta hasta 15 dígitos significativos (holgado para USD y PYG, documentado).
8. **Política de costes**: los conceptos incluidos en el coste del inventario deben validarse con el asesor contable antes del uso real.
