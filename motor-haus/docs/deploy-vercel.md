# Motor Haus · Despliegue en Vercel

## Opción A — Demostración sin configurar nada (recomendada para mostrar)

1. Suba la carpeta `motor-haus` (con `vercel.json`) a Vercel: importando el repositorio con **Root Directory = `motor-haus`**, o con `npx vercel --prod` dentro de la carpeta.
2. No hace falta definir variables ni base de datos.

Durante el build (`npm run build`) se genera una **base PostgreSQL embebida** (PGlite) con el esquema completo y los datos de demostración, y la app la usa automáticamente cuando no hay una base configurada. Si Vercel tiene una `DATABASE_URL` (por ejemplo, de una integración) que está vacía o no responde, también se usa la base embebida en lugar de fallar.

Verificado en una simulación de Vercel (instalación limpia, build sin variables, `next start` en producción) en tres situaciones: sin base, con `DATABASE_URL` vacía y con `DATABASE_URL` inaccesible. En las tres, las 19 secciones, sus expedientes, la descarga de PDF y una negociación con escenario de financiación funcionan. Para revisar el despliegue real: `MH_BASE_URL=https://<su-app>.vercel.app npx tsx scripts/smoke-demo.ts`.

**Limitación:** en este modo los cambios (operaciones, pagos, etc.) viven en la memoria de cada instancia del servidor: son temporales, se pierden al reiniciarse la instancia y no se comparten entre instancias. Sirve para demostrar y explorar; para uso real, use la opción B.

Ingreso: `direccion@motorhaus.demo` / `MotorHaus-Demo-2026`.

## Opción B — Base persistente (Neon)

La aplicación necesita una base PostgreSQL. La forma más simple en Vercel es **Neon** (Marketplace de Vercel). Este procedimiento fue verificado contra una base que replica las restricciones de un Postgres gestionado (propietario con `CREATEROLE`, sin superusuario): instalación, seed, 52 pruebas, build de producción, 33 pantallas y el E2E completo. **No** se verificó todavía sobre una cuenta real de Vercel/Neon.

> Este despliegue usa los **datos de demostración** y la autenticación local con contraseñas demo conocidas. Active *Deployment Protection* en Vercel si el enlace no debe ser público, y no cargue datos reales en este modo.

## 1. Crear el proyecto en Vercel

1. Vercel → **Add New → Project** → importe el repositorio de GitHub.
2. **Root Directory:** `motor-haus` · Framework: Next.js (detectado) · comandos por defecto.
3. Rama: el código está en `claude/motor-haus-os`. Fúndala en `main` o, en *Settings → Git → Production Branch*, elija esa rama.

## 2. Crear la base

1. En el proyecto: **Storage → Create Database → Neon (Postgres)** y conéctela al proyecto.
2. Copie de *Settings → Environment Variables* la conexión **sin pooler** (`DATABASE_URL_UNPOOLED`): es la del rol propietario.

## 3. Instalar el esquema y los datos demo (una sola vez, desde su computadora)

Requiere Node.js 22+.

```bash
cd motor-haus
npm install
export MH_ADMIN_DATABASE_URL="<DATABASE_URL_UNPOOLED de Neon>"
export MH_APP_DB_PASSWORD="<contraseña larga y aleatoria para el rol mh_app>"
npm run db:setup          # crea roles, esquema, funciones y RLS

# Conexión de la aplicación: misma URL con usuario mh_app y la contraseña anterior
export MH_DATABASE_URL="postgresql://mh_app:<MH_APP_DB_PASSWORD>@<host-pooler-de-neon>/<base>?sslmode=require"
npm run db:seed           # datos de demostración
```

`db:setup` no modifica una base que ya tiene el esquema.

## 4. Variables de entorno en Vercel

| Variable | Valor |
|---|---|
| `MH_DATABASE_URL` | Conexión **pooled** de Neon con usuario `mh_app` (la del paso 3) |
| `MH_AUTH_MODE` | `local` |
| `MH_ALLOW_LOCAL_AUTH` | `true` (solo para demostración) |
| `MH_SESSION_SECRET` | Cadena aleatoria de 32+ caracteres |
| `MH_TIMEZONE` | `America/Asuncion` |
| `MH_DB_POOL_MAX` | `3` |

No reemplace `DATABASE_URL` de la integración: la aplicación usa `MH_DATABASE_URL`, que se conecta con un rol sin privilegios propios (RLS siempre activo).

## 5. Desplegar

*Deployments → Redeploy* (o un push a la rama de producción). Ingreso: `direccion@motorhaus.demo` / `MotorHaus-Demo-2026`.

## Limitaciones en Vercel

- **Fotografías:** el sistema de archivos de Vercel es de solo lectura; la carga de fotos requiere `MH_STORAGE_MODE=supabase` con un bucket privado de Supabase Storage. Sin eso, la carga muestra un error y no guarda nada.
- **Producción real:** usar Supabase Auth (`MH_AUTH_MODE=supabase`) en lugar de la autenticación local; ver el README.
