# Despliegue en producción

El repositorio no contiene credenciales. Estos pasos los ejecuta quien administre el
proyecto de Supabase y el hosting de la aplicación.

## 1. Proyecto Supabase

1. Cree un proyecto (región cercana a Paraguay, p. ej. São Paulo).
2. **Authentication → Providers → Email**: habilitado; desactive el registro público
   (*Allow new users to sign up* = off). Las cuentas se crean desde Configuración → Usuarios.
3. Aplique las migraciones en orden, con la CLI de Supabase o el editor SQL:

   ```bash
   supabase link --project-ref <ref>
   supabase db push            # aplica supabase/migrations/*.sql
   ```

   No aplique nada de `supabase/dev/`: es sólo para desarrollo local.
4. La migración `*_storage.sql` crea los buckets privados `documents` y `vehicle-photos` con
   sus políticas. Verifique en **Storage** que ambos figuran como *private*.

## 2. Variables de entorno de la aplicación

| Variable | Dónde se obtiene | Ámbito |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | público |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API (anon / publishable) | público |
| `DATABASE_URL` | Project Settings → Database → *Transaction pooler* (puerto 6543), usuario `postgres` | **sólo servidor** |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (service_role / secret) | **sólo servidor** |
| `STORAGE_MODE` | `supabase` | servidor |

Nunca anteponga `NEXT_PUBLIC_` a `DATABASE_URL` ni a la clave service_role. La aplicación se
niega a arrancar en producción con `STORAGE_MODE=local`.

## 3. Organización y primer director

Una sola vez, desde una máquina de confianza con las variables anteriores:

```bash
ORG_NAME="Da Silva Automotores" \
ORG_LEGAL_NAME="<razón social>" ORG_TAX_ID="<RUC>" \
DIRECTOR_EMAIL="<correo del director>" DIRECTOR_NAME="<nombre completo>" \
npm run org:create
```

Crea la organización real (no demo), la cuenta del director con una contraseña inicial
aleatoria que se muestra una vez, y las marcas Range Rover, Ford y Changan (`ORG_BRANDS`
permite cambiarlas). No crea ningún dato de negocio. El director debe:

1. Cambiar su contraseña en **Mi cuenta**.
2. Revisar **Configuración → General** (descuento máximo, vigencias, convención de tasa…).
3. Crear las cuentas de caja y banco reales en **Caja → Nueva cuenta** y registrar su saldo
   inicial como movimiento de apertura.
4. Cargar el tipo de cambio del día en **Caja → Tipos de cambio** antes de operar en USD.
5. Dar de alta a los usuarios con su rol en **Configuración → Usuarios**.

## 4. Aplicación

Cualquier hosting de Next.js con Node 22 (Vercel, contenedor propio…):

```bash
npm ci
npm run build
npm start
```

Compruebe tras desplegar: ingreso, que la franja «DATOS DE DEMOSTRACIÓN» **no** aparece,
y que un vendedor no ve costes ni el menú de Caja.

## 5. Tareas periódicas (opcionales)

Las reservas vencidas se liberan automáticamente al consultar el inventario o al intentar
reservar (`rpc_housekeeping`). Si se desea liberarlas aunque nadie use el sistema, programe
con `pg_cron`:

```sql
select cron.schedule('reservas-vencidas', '*/15 * * * *',
  $$select app.expire_reservations(id) from public.organizations$$);
```

## 6. Copias de seguridad

Active los backups diarios (y PITR si el plan lo permite) en Supabase. La auditoría y los
movimientos son append-only: una restauración parcial debe hacerse siempre a un punto en el
tiempo completo, nunca editando tablas.

## Lo que no está integrado

- Bancos y BCP: no hay conexión automática. Saldos de caja = **registrados**; la verificación
  es la conciliación manual contra el extracto.
- Facturación electrónica (SIFEN): fuera del alcance actual.
- Correo saliente: no es necesario; si se configura SMTP en Supabase podría usarse la
  invitación por correo en lugar de la contraseña inicial.
