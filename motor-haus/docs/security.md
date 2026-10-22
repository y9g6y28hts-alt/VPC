# Motor Haus · Seguridad, permisos y continuidad

## Autenticación

| Modo | Uso | Mecanismo |
|---|---|---|
| `MH_AUTH_MODE=supabase` | Producción | Supabase Auth; en cada request el servidor valida la sesión con `auth.getUser()` (no confía en un JWT sin verificar) |
| `MH_AUTH_MODE=local` | Desarrollo y demostración | Contraseñas bcrypt en `auth.users` local; cookie `httpOnly`, `SameSite=Lax`, firmada HMAC-SHA256, 8 h. **Se niega a operar con `NODE_ENV=production`** salvo `MH_ALLOW_LOCAL_AUTH=true` explícito |

## Autorización en capas

1. **Rol de conexión sin privilegios propios** (`NOINHERIT`): sin `SET ROLE authenticated` no lee nada (probado).
2. **RLS en todas las tablas**, filtrada por membresía y permiso (`app.has_perm`). Las vistas son `security_invoker`.
3. **Privilegios de columna:** documento de identidad, RUC y dirección del cliente no son legibles por columna; solo por `get_customer_sensitive()`, que exige `customer.pii.read` y registra auditoría.
4. **Funciones transaccionales** para toda operación crítica, con verificación de permiso y estado actual; triggers de guarda impiden eludirlas con UPDATE directos.
5. **Segregación de funciones** (configurable): quien solicita una excepción no la aprueba; el vendedor no aprueba excepciones de su operación; quien registra un pago o factura no la confirma ni aprueba.
6. **La interfaz oculta acciones según permisos solo por usabilidad**; la autorización real está en la base.

## Matriz de roles (resumen)

| Rol | Puede | No puede |
|---|---|---|
| Director general | Todo, incluidas aprobaciones | Formalizar con fecha anterior |
| Director financiero | Finanzas, tesorería, cobranzas, aprobaciones, políticas, formalización con fecha anterior | Administrar usuarios |
| Gerente comercial | Inventario (precios y estados), CRM, operaciones, aprobaciones comerciales y de tasaciones, formalizar | Confirmar/revertir pagos, tesorería |
| Asesor de ventas | Clientes, sus operaciones, tasaciones, reservas, propuestas | Ver costes de inventario, otras operaciones, confirmar pagos, aprobar |
| Responsable de cobranzas | Cartera completa, gestiones, registro de pagos, datos sensibles | Confirmar pagos (segregación), ajustes |
| Responsable de inventario | Unidades, costes, preparación, conteos, entregas | Ventas, finanzas |
| Responsable de importaciones | Embarques, recepciones, facturas de proveedores | Aprobar o pagar facturas |
| Auditor | Lectura completa y auditoría | Cualquier escritura |
| Administrador técnico | Usuarios, roles, políticas | Datos financieros (las secciones devuelven `null`, no cero) |

Matriz completa: migración `0001_foundation.sql`.

## Datos y documentos

- Documentos emitidos con instantánea + SHA-256; la descarga del PDF verifica la integridad y la autorización sobre la entidad de origen; respuesta `private, no-store`.
- Fotografías en almacenamiento privado (fuera de `public/` o bucket privado de Supabase), tipo verificado por firma, servidas por ruta autorizada por RLS.
- Exportaciones CSV: requieren `report.export`, se registran en auditoría antes de entregar el archivo y neutralizan inyección de fórmulas.
- La auditoría excluye identificadores personales completos; `audit_events` rechaza UPDATE/DELETE/TRUNCATE incluso para superusuario mediante trigger.
- Errores: los mensajes al usuario son de dominio; los errores internos no exponen SQL.
- Cabeceras: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.

## Respaldo, restauración y recuperación

| Elemento | Estrategia recomendada |
|---|---|
| Base de datos | Supabase con PITR (point-in-time recovery) habilitado; además `pg_dump --format=custom` diario cifrado a almacenamiento externo con retención 35 días y mensual 12 meses |
| Archivos | Versionado del bucket privado o réplica diaria |
| Restauración | Simulacro trimestral: restaurar en un proyecto aislado, ejecutar `npm test` contra él y verificar `contract_balances.schedule_discrepancy = 0` y conteos de auditoría |
| Objetivos | RPO ≤ 5 min (PITR), RTO ≤ 4 h (a validar con el primer simulacro) |
| Claves | `MH_SESSION_SECRET`, claves de Supabase y cadena de conexión solo en variables del servidor; nunca en el cliente |

Comandos de referencia:

```bash
pg_dump "$DATABASE_URL_DIRECT" --format=custom --no-owner -f motor_haus_$(date +%F).dump
pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" motor_haus_YYYY-MM-DD.dump
```

## Tareas programadas recomendadas (Supabase `pg_cron`)

```sql
select cron.schedule('expirar-reservas', '*/15 * * * *', $$
  select public.expire_reservations(id) from public.organizations $$);
```

Sin esta tarea, las reservas vencidas se liberan igualmente en la siguiente reserva o formalización de la unidad.
