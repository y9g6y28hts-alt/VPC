-- =============================================================================
-- Da Silva OS — Supabase Storage privado
--
-- Buckets privados (sin URL pública). Convención de rutas:
--   documents:       {org_id}/{entity_type}/{entity_id}/{uuid}-{archivo}
--   vehicle-photos:  {org_id}/{vehicle_id}/{uuid}.{ext}
-- La descarga se hace con URL firmadas de corta duración que genera el
-- servidor tras verificar el acceso al registro en public.documents.
-- En entornos sin Supabase Storage (desarrollo local) este bloque no hace nada.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'Esquema storage inexistente: se omite la configuración de buckets';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('documents', 'documents', false, 26214400,
          array['application/pdf','image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('vehicle-photos', 'vehicle-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

  execute $p$
    create policy dasilva_documents_read on storage.objects for select to authenticated
    using (bucket_id = 'documents'
           and exists (select 1 from public.documents d where d.storage_bucket = bucket_id and d.storage_path = name))
  $p$;
  execute $p$
    create policy dasilva_documents_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents'
                and app.can_write_entity(((storage.foldername(name))[1])::uuid, (storage.foldername(name))[2]))
  $p$;
  execute $p$
    create policy dasilva_photos_read on storage.objects for select to authenticated
    using (bucket_id = 'vehicle-photos'
           and app.has_perm(((storage.foldername(name))[1])::uuid, 'inventory.view'))
  $p$;
  execute $p$
    create policy dasilva_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'vehicle-photos'
                and app.has_perm(((storage.foldername(name))[1])::uuid, 'inventory.edit'))
  $p$;
  execute $p$
    create policy dasilva_photos_delete on storage.objects for delete to authenticated
    using (bucket_id = 'vehicle-photos'
           and app.has_perm(((storage.foldername(name))[1])::uuid, 'inventory.edit'))
  $p$;
end $$;
