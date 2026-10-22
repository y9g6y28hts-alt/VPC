#!/usr/bin/env bash
# Recrea la base local de Motor Haus: shim de Supabase + migraciones.
# Uso: bash scripts/db-reset.sh  (requiere PostgreSQL local y acceso como superusuario)
set -euo pipefail
DB="${MH_DB_NAME:-motor_haus}"
PSQL_ADMIN="${MH_PSQL_ADMIN:-sudo -u postgres psql -v ON_ERROR_STOP=1 -q}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

$PSQL_ADMIN -d postgres -c "drop database if exists ${DB} with (force)"
$PSQL_ADMIN -d postgres -c "create database ${DB}"
$PSQL_ADMIN -d "$DB" -f "$DIR/supabase/local/000_supabase_shim.sql"
for f in "$DIR"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  $PSQL_ADMIN -d "$DB" -f "$f"
done
$PSQL_ADMIN -d "$DB" -c "grant connect on database ${DB} to mh_app"
# Rol administrativo SOLO para desarrollo local (seed y pruebas). En Supabase se usa service_role.
$PSQL_ADMIN -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'mh_admin') then create role mh_admin login superuser password 'mh_admin_local_only'; end if; end \$\$"
echo "Base ${DB} lista."
