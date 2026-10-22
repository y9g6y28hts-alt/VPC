-- =============================================================================
-- Motor Haus · 0010 Documentos, plantillas, notificaciones y objetivos
-- Un documento conserva la instantánea exacta de los datos con que se emitió
-- y su suma de verificación; el PDF se regenera de forma determinista desde ella.
-- Emitir un PDF no implica validez jurídica ni firma electrónica.
-- =============================================================================

create table public.document_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in (
                    'proposal','reservation','purchase_order','appraisal_report','account_statement',
                    'payment_schedule','delivery_record','sales_contract')),
  version         int not null check (version > 0),
  title           text not null,
  legal_notice    text not null,
  body            jsonb not null default '{}'::jsonb,
  requires_legal_review boolean not null default false,
  active          boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organization_id, kind, version)
);
create unique index document_templates_active_idx on public.document_templates(organization_id, kind) where active;

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null,
  number           text not null,
  template_id      uuid not null references public.document_templates(id),
  template_version int not null,
  entity_type      text not null check (entity_type in ('deal','contract','customer','trade_in_appraisal','unit','purchase_order')),
  entity_id        uuid not null,
  data_snapshot    jsonb not null,
  data_checksum    text not null,
  status           text not null default 'issued' check (status in ('issued','superseded','void')),
  void_reason      text,
  storage_path     text,
  issued_by        uuid not null,
  issued_at        timestamptz not null default now(),
  unique (organization_id, number)
);
create index documents_entity_idx on public.documents(entity_type, entity_id);
create trigger documents_audit after insert or update on public.documents
  for each row execute function app.audit_row('data_snapshot');

create or replace function app.document_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MH_FORBIDDEN: los documentos emitidos no se eliminan; anúlelos con motivo';
  end if;
  if new.data_snapshot <> old.data_snapshot or new.data_checksum <> old.data_checksum
     or new.number <> old.number or new.template_version <> old.template_version then
    raise exception 'MH_FORBIDDEN: el contenido de un documento emitido es inmutable';
  end if;
  return new;
end $$;
create trigger documents_guard before update or delete on public.documents
  for each row execute function app.document_guard();

-- Registro de intenciones de notificación. Sin integración de mensajería
-- configurada, el estado queda en 'not_sent_no_channel': nunca se afirma un envío.
create table public.notification_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid references public.customers(id),
  channel         text not null check (channel in ('whatsapp','email','sms')),
  template_code   text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'not_sent_no_channel'
                    check (status in ('not_sent_no_channel','queued','sent','failed')),
  provider_ref    text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table public.sales_targets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_month    date not null check (extract(day from period_month) = 1),
  salesperson_id  uuid references public.user_profiles(id),
  category        text,
  currency        char(3) not null references public.currencies(code),
  target_revenue  numeric(18,2) check (target_revenue >= 0),
  target_units    int check (target_units >= 0),
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create unique index sales_targets_unique_idx on public.sales_targets
  (organization_id, period_month, coalesce(salesperson_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(category, ''), currency);
