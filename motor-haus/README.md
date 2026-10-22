# Motor Haus

Sistema operativo privado para la gestión integral de una concesionaria de vehículos y activos de lujo: inventario, importaciones, preparación, CRM, mesa de negociación, tasaciones, contratos, cuentas por cobrar, pagos, tesorería, cuentas por pagar, rentabilidad, documentos, aprobaciones y auditoría sobre una única fuente de verdad en PostgreSQL.

> Los datos incluidos son **de demostración** (organización `Motor Haus`, `is_demo = true`), ficticios y señalizados en todas las pantallas y documentos.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Arquitectura, flujo de una operación crítica, decisiones y dependencias |
| [docs/domain-model.md](docs/domain-model.md) | Dominios, diagrama de relaciones, saldos derivados, estados y concurrencia |
| [docs/financial-engine.md](docs/financial-engine.md) | Fórmulas y convenciones del motor financiero y su validación en el servidor |
| [docs/security.md](docs/security.md) | Autenticación, RLS, roles, datos sensibles, respaldo y recuperación |
| [docs/demo-script.md](docs/demo-script.md) | Guion de presentación en cinco actos y usuarios demo |
| [docs/quality-report.md](docs/quality-report.md) | Funcionalidades verificadas, parciales y pendientes; riesgos |

## Requisitos

- Node.js 22+
- PostgreSQL 15+ (local) **o** un proyecto Supabase
- Chromium (solo para `npm run e2e`, `crawl` y capturas)

## Puesta en marcha local

```bash
npm install
cp .env.example .env            # ajuste MH_SESSION_SECRET (≥ 32 caracteres)
npm run db:reset                # crea la base motor_haus: shim local de Supabase + migraciones
npm run db:seed                 # datos de demostración vía funciones de negocio
npm run dev                     # http://localhost:3000
```

`db:reset` usa `sudo -u postgres psql` por defecto; defina `MH_PSQL_ADMIN` para otro acceso de superusuario. Crea dos roles **solo locales**: `mh_app` (conexión del servidor, sin privilegios propios) y `mh_admin` (seed y pruebas).

Ingreso: `direccion@motorhaus.demo` / `MotorHaus-Demo-2026` (otros usuarios y roles en [docs/demo-script.md](docs/demo-script.md)).

## Pruebas

```bash
npm run typecheck
npm test                 # unitarias del motor + integración contra PostgreSQL (52 pruebas)
npm run e2e              # flujo completo por la interfaz (requiere servidor y seed)
npm run crawl            # recorre todas las pantallas y reporta errores
```

Las pruebas de integración crean organizaciones aisladas y no dependen del seed.

## Despliegue con Supabase

1. Crear el proyecto y habilitar **PITR**.
2. Aplicar `supabase/migrations/*.sql` en orden (SQL Editor o `supabase db push`). **No** ejecutar `supabase/local/`.
3. Crear la organización con la clave de servicio:
   ```sql
   select public.create_organization('Nombre', 'USD', false, '<uuid del usuario director>');
   ```
   y asignar membresías (`insert into memberships` o desde Administración una vez existan los usuarios en Supabase Auth).
4. Variables del servidor:
   ```
   DATABASE_URL=<cadena de conexión directa o session pooler del rol postgres>
   MH_AUTH_MODE=supabase
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   MH_STORAGE_MODE=supabase
   SUPABASE_SERVICE_ROLE_KEY=...      # solo servidor, para el bucket privado
   MH_STORAGE_BUCKET=unit-media       # bucket privado
   MH_SESSION_SECRET=...
   MH_TIMEZONE=America/Asuncion
   ```
5. Programar la expiración de reservas con `pg_cron` (ver [docs/security.md](docs/security.md)).
6. `npm run build && npm start`.

El modo Supabase está implementado pero **no fue verificado contra un proyecto real** en este entorno (ver informe de calidad).

## Estructura

```
supabase/migrations/   esquema, funciones, vistas, RLS y configuración inicial
supabase/local/        shim de Supabase para PostgreSQL local (no usar en Supabase)
src/domain/finance/    motor financiero (compartido navegador/servidor)
src/server/            gateway, sesión, acciones, documentos, PDF, almacenamiento
src/app/(app)/         pantallas por dominio y server actions
src/components/ui/     sistema de diseño
scripts/               reset, seed, e2e, crawl, capturas
tests/                 unitarias e integración
docs/                  documentación
```
