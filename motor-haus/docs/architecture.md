# Motor Haus · Arquitectura

## Principios

1. **PostgreSQL es la fuente de verdad.** Estados, saldos y obligaciones se derivan de datos relacionados; ningún saldo es un campo editable.
2. **Las reglas críticas viven en la base.** Reservas, ventas, aprobaciones, cobros, reversiones y ajustes son funciones transaccionales (`SECURITY DEFINER`) que verifican permiso y estado actual antes de escribir.
3. **El servidor de aplicación no tiene "modo dios".** Cada request abre una transacción, adopta el rol `authenticated` y fija los claims JWT del usuario (igual que PostgREST en Supabase). RLS y funciones aplican siempre.
4. **Un único motor financiero.** El mismo código TypeScript calcula la vista previa en el navegador y el plan definitivo en el servidor; PostgreSQL verifica de forma independiente cada calendario antes de guardarlo y al formalizar.
5. **Trazabilidad por construcción.** Triggers de auditoría inmutables y eventos semánticos (`deal.formalize`, `payment.reverse`, `customer.pii.view`, `export`…) con identificador de operación por request.

## Componentes

```mermaid
flowchart LR
  subgraph Navegador
    UI[React · componentes cliente<br/>formularios, vista previa del motor]
  end
  subgraph Next.js 16 · servidor
    RSC[Server Components<br/>lectura por pantalla]
    SA[Server Actions<br/>validación zod]
    API[Rutas /api<br/>PDF · CSV · fotos]
    GW[Gateway pg<br/>SET LOCAL ROLE authenticated<br/>request.jwt.claims · app.op_id]
    ENG[Motor financiero<br/>src/domain/finance]
    PDF[Modelo de documento + pdf-lib]
  end
  subgraph PostgreSQL / Supabase
    RLS[RLS + privilegios de columna]
    FN[Funciones transaccionales<br/>reserve_unit · formalize_deal · confirm_payment …]
    V[Vistas security_invoker<br/>installment_status · contract_balances …]
    AUD[(audit_events inmutable)]
  end
  AUTH[Supabase Auth<br/>o auth local de desarrollo]
  ST[(Almacenamiento privado<br/>local o Supabase Storage)]
  UI --> SA & RSC
  UI -. vista previa .-> ENG
  SA --> ENG --> GW
  RSC --> GW
  API --> GW
  API --> PDF
  API --> ST
  GW --> RLS --> FN & V
  FN --> AUD
  SA --> AUTH
```

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| Esquema y reglas | `supabase/migrations/0001–0018` | Tablas, restricciones, índices, vistas, funciones de negocio, RLS, configuración inicial |
| Shim local | `supabase/local/000_supabase_shim.sql` | Roles `anon/authenticated/service_role`, `auth.uid()`, verificación de contraseña local. **No se ejecuta en Supabase.** |
| Gateway | `src/server/gateway.ts` | Transacción por operación, rol `authenticated`, claims, zona horaria de negocio, mapeo de errores `MH_*` |
| Sesión | `src/server/session.ts` | `MH_AUTH_MODE=supabase` (verifica con `auth.getUser()`) o `local` (cookie HMAC, bloqueado en producción) |
| Acciones | `src/app/(app)/**/actions.ts` + `src/server/action.ts` | Validación zod, transacción del usuario, redirección tras commit |
| Motor | `src/domain/finance` | Tasas, francés, alemán, sin interés, refuerzos, primer período irregular, prepago, reconciliación |
| Documentos | `src/server/documents.ts`, `src/server/pdf.ts` | Modelo único → vista HTML y PDF; verificación SHA-256 de la instantánea |
| Interfaz | `src/app/(app)` y `src/components/ui` | 15 dominios, sistema de diseño propio |

## Flujo de una operación crítica (formalización)

1. La CFO pulsa *Formalizar* → confirmación en dos pasos (resumen) → server action.
2. El gateway abre la transacción como la CFO; `formalize_deal()`:
   - bloquea la operación (`FOR UPDATE`), verifica `deal.formalize`, estado `approved` y que el *hash* de términos no cambió desde la aprobación;
   - bloquea las unidades en orden y vuelve a comprobar su disponibilidad real (reservas vencidas se liberan en la misma transacción);
   - recalcula la economía, revalida el calendario del plan con `app.validate_schedule()`;
   - crea contrato, versión contractual inmutable, entregas iniciales, cuotas y refuerzos; verifica que el principal programado reconcilia con entregas + capital financiado;
   - marca unidades vendidas, convierte la reserva, acepta tasaciones, registra auditoría.
3. Commit. Cualquier error revierte todo; un intento simultáneo sobre la misma unidad falla con `MH_CONFLICT` (probado).

## Decisiones

- **Gateway `pg` + RLS en lugar de supabase-js en el servidor:** una sola ruta de datos para local y producción, transacciones de varias consultas consistentes por pantalla y el mismo modelo de seguridad que PostgREST. En Supabase el servidor se conecta con la cadena de conexión del proyecto y sigue usando `SET LOCAL ROLE authenticated`.
- **Escrituras sensibles solo por funciones.** Triggers de guarda rechazan, para el rol `authenticated`, cambios directos de estado, precio, fechas de negocio, importes de obligaciones, pagos confirmados, movimientos de caja y documentos emitidos.
- **Sin conversión implícita de monedas.** Claves foráneas compuestas `(id, currency)` obligan a que pago, cuenta, cuota y asignación compartan moneda; otra moneda exige cotización, fecha y fuente.
- **Fecha de negocio** en la zona `MH_TIMEZONE` (por defecto `America/Asuncion`) por transacción; `app.today()` admite `app.as_of_date` para estados "al" y pruebas reproducibles.
- **Sin infraestructura distribuida.** Un backend transaccional bien diseñado cubre la etapa actual; Realtime de Supabase puede añadirse para refrescar vistas sin afectar la integridad (pendiente).

## Dependencias y su justificación

| Dependencia | Motivo |
|---|---|
| next, react | Aplicación web, server components y server actions |
| pg | Gateway transaccional con control de rol y claims |
| @supabase/ssr, @supabase/supabase-js | Supabase Auth y Storage en producción |
| decimal.js | Aritmética decimal exacta en el motor financiero (compatible con `numeric` de PostgreSQL) |
| zod | Validación tipada de formularios en el servidor |
| pdf-lib | PDF determinista desde la instantánea validada, sin navegador headless |
| tailwindcss | Sistema de diseño con tokens propios |
| geist, lucide-react | Tipografía con cifras tabulares e iconografía lineal (sin emojis) |
| vitest, tsx, playwright-core (dev) | Pruebas unitarias/integración, scripts y E2E con el Chromium del entorno |
