# Desarrollo local

Todo lo de esta guía es **sólo para desarrollo**. Las contraseñas `*_dev_only` y las claves
JWT generadas por `scripts/dev-env.mjs` no sirven fuera de la máquina local.

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 15/16 local con un superusuario `postgres` / `postgres_dev_only`
  (o defina `DATABASE_ADMIN_URL`).
- Opcional, para ingresar a la interfaz: binario de **Supabase Auth (GoTrue)**. Se compila
  desde su código fuente con Go:

  ```bash
  git clone --depth 1 https://github.com/supabase/auth .dev/gotrue-src
  (cd .dev/gotrue-src && go build -o ../gotrue .)
  ```

Sin GoTrue funcionan igual las pruebas de base de datos: se usa `supabase/dev/auth-shim.sql`,
un sustituto mínimo de `auth.users` / `auth.uid()`.

## Puesta en marcha

```bash
npm install
npm run env:local                               # genera .env.local (no sobrescribe)
GOTRUE_BIN=.dev/gotrue npm run db:seed-demo     # base dasilva_dev + organización DEMO + usuarios
GOTRUE_BIN=.dev/gotrue npm run auth:dev         # Supabase Auth en :9999 y pasarela /auth/v1 en :54321
npm run dev                                     # http://localhost:3000
```

`db:seed-demo` recrea la base `dasilva_dev` desde cero aplicando `supabase/dev/bootstrap.sql`
(roles de Supabase: `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, y el rol
de la aplicación `dasilva_app`), las migraciones de Supabase Auth y luego
`supabase/migrations/*.sql` en orden.

> Ejecute siempre `db:seed-demo` con `GOTRUE_BIN`: sin él se crean usuarios en el sustituto
> y el ingreso real por Supabase Auth no funcionará.

### Usuarios de demostración

Contraseña de todos: `DemoDaSilva2026!`

| Rol | Correo |
|---|---|
| Director | director@demo.dasilva.local |
| Administración | administracion@demo.dasilva.local |
| Gerencia comercial | gerencia@demo.dasilva.local |
| Vendedor | vendedor@demo.dasilva.local · vendedor2@demo.dasilva.local |
| Cobranzas | cobranzas@demo.dasilva.local |
| Inventario | inventario@demo.dasilva.local |
| Finanzas | finanzas@demo.dasilva.local |
| Auditor | auditor@demo.dasilva.local |
| Administrador técnico | tecnico@demo.dasilva.local |

## Pruebas

```bash
npm test               # unitarias (dominio: dinero, tasas, amortización, mora, márgenes, formularios)
npm run test:db        # recrea la base dasilva_test y prueba RLS, concurrencia y flujos completos
npm run test:e2e       # Playwright contra http://localhost:3000 (stack local en marcha y demo recién sembrada)
```

`PW_CHROMIUM=/ruta/a/chrome` permite usar un Chromium ya instalado.

## Almacenamiento local

Con `STORAGE_MODE=local` los documentos y fotos se guardan en `storage-local/` (ignorado por
git) y se sirven sólo a través de las rutas autenticadas `/api/documentos/[id]` y
`/api/fotos/[id]`. La aplicación rechaza este modo en producción.

## Convenciones del código

- `src/domain/` — lógica pura sin dependencias (dinero, fechas, financiación, mora, márgenes).
- `src/server/` — sólo servidor: contexto de sesión, consultas, acciones, PDF, almacenamiento.
- `src/components/` — componentes propios; `ui/` son primitivas.
- Los importes viajan como `numeric` de Postgres (cadena) y se formatean con `src/lib/format.ts`.
- Toda acción de servidor pasa por `guarded()` (sesión + permiso + errores legibles).
