-- =============================================================================
-- Motor Haus · 0018 Alta de organizaciones y configuración inicial
-- Solo service_role (o el propietario de la base) puede crear organizaciones.
-- =============================================================================

create or replace function app.bootstrap_organization(p_org uuid) returns void
language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.org_policies (organization_id) values (p_org) on conflict do nothing;

  insert into public.cost_concepts (organization_id, code, label, include_in_inventory_cost, sort_order) values
    (p_org, 'purchase_price',      'Precio de compra',            true, 10),
    (p_org, 'transport',           'Transporte',                  true, 20),
    (p_org, 'transport_insurance', 'Seguro de transporte',        true, 30),
    (p_org, 'import_fees',         'Gastos de importación',       true, 40),
    (p_org, 'taxes',               'Tributos y tasas',            true, 50),
    (p_org, 'professional_fees',   'Honorarios y servicios',      true, 60),
    (p_org, 'repairs',             'Reparaciones',                true, 70),
    (p_org, 'preparation',         'Preparación para entrega',    true, 80),
    (p_org, 'storage',             'Almacenaje',                  false, 90),
    (p_org, 'other',               'Otros costes autorizados',    true, 100)
  on conflict do nothing;

  insert into public.status_transitions (organization_id, dimension, from_status, to_status, via_function, label) values
    (p_org, 'acquisition', 'evaluation', 'approved', false, 'Aprobar compra'),
    (p_org, 'acquisition', 'evaluation', 'rejected', false, 'Rechazar compra'),
    (p_org, 'acquisition', 'approved',   'acquired', false, 'Formalizar adquisición'),
    (p_org, 'acquisition', 'approved',   'rejected', false, 'Cancelar compra'),
    (p_org, 'logistics',   'pending',    'in_transit', false, 'Despachado / en tránsito'),
    (p_org, 'logistics',   'in_transit', 'in_customs', false, 'Ingreso a aduana'),
    (p_org, 'logistics',   'in_customs', 'in_transit', false, 'Liberado de aduana, en traslado'),
    (p_org, 'logistics',   'pending',    'received',   true,  'Recepción física'),
    (p_org, 'logistics',   'in_transit', 'received',   true,  'Recepción física'),
    (p_org, 'logistics',   'in_customs', 'received',   true,  'Recepción física'),
    (p_org, 'preparation', 'in_preparation', 'ready',  false, 'Preparación completa'),
    (p_org, 'preparation', 'ready', 'in_preparation',  false, 'Reabrir preparación'),
    (p_org, 'preparation', 'ready', 'in_service',      false, 'Enviar a servicio o reparación'),
    (p_org, 'preparation', 'in_preparation', 'in_service', false, 'Enviar a servicio o reparación'),
    (p_org, 'preparation', 'in_service', 'in_preparation', false, 'Retorno de servicio'),
    (p_org, 'commercial',  'not_listed', 'available',  false, 'Habilitar para comercialización'),
    (p_org, 'commercial',  'available',  'not_listed', false, 'Retirar de comercialización'),
    (p_org, 'commercial',  'available',  'reserved',   true,  'Reservar'),
    (p_org, 'commercial',  'reserved',   'available',  true,  'Liberar reserva'),
    (p_org, 'commercial',  'reserved',   'sold_pending_delivery', true, 'Formalizar venta'),
    (p_org, 'commercial',  'available',  'sold_pending_delivery', true, 'Formalizar venta'),
    (p_org, 'commercial',  'sold_pending_delivery', 'delivered', true, 'Entregar'),
    (p_org, 'commercial',  'not_listed', 'retired',    false, 'Retirar del inventario'),
    (p_org, 'commercial',  'available',  'retired',    false, 'Retirar del inventario')
  on conflict do nothing;

  insert into public.unit_document_requirements (organization_id, origin, doc_type, label, required_for_sale) values
    (p_org, 'import', 'title',               'Título / certificado de propiedad de origen', true),
    (p_org, 'import', 'purchase_invoice',    'Factura de compra',                           true),
    (p_org, 'import', 'bill_of_lading',      'Documento de transporte',                     false),
    (p_org, 'import', 'customs_clearance',   'Despacho aduanero',                           true),
    (p_org, 'import', 'technical_inspection','Inspección técnica',                          true),
    (p_org, 'local_purchase', 'title',               'Título de propiedad',                 true),
    (p_org, 'local_purchase', 'purchase_invoice',    'Factura o boleta de compra',          true),
    (p_org, 'local_purchase', 'technical_inspection','Inspección técnica',                  true),
    (p_org, 'trade_in', 'title',               'Título de propiedad',                       true),
    (p_org, 'trade_in', 'transfer_form',       'Formulario de transferencia firmado',       true),
    (p_org, 'trade_in', 'lien_release',        'Certificado de libre deuda / cancelación de prenda', true),
    (p_org, 'consignment', 'consignment_agreement', 'Contrato de consignación',             true),
    (p_org, 'consignment', 'title',                 'Título de propiedad',                  true)
  on conflict do nothing;

  insert into public.preparation_templates (organization_id, title, mandatory, sort_order) values
    (p_org, 'Inspección de ingreso',                 true, 10),
    (p_org, 'Checklist mecánico',                    true, 20),
    (p_org, 'Verificación de identificadores (VIN/chasis/motor)', true, 30),
    (p_org, 'Limpieza y detailing',                  true, 40),
    (p_org, 'Sesión fotográfica',                    false, 50),
    (p_org, 'Control de llaves, manuales y accesorios', true, 60)
  on conflict do nothing;

  insert into public.document_templates (organization_id, kind, version, title, legal_notice, requires_legal_review) values
    (p_org, 'proposal', 1, 'Propuesta comercial',
     'Propuesta comercial sin valor contractual. No constituye contrato, reserva ni aprobación de crédito. Importes sujetos a disponibilidad de la unidad y a la aprobación interna indicada.', false),
    (p_org, 'payment_schedule', 1, 'Calendario de pagos',
     'Calendario generado a partir del plan contractual vigente. Las fechas y los importes corresponden a la versión del contrato indicada.', false),
    (p_org, 'account_statement', 1, 'Estado de cuenta',
     'Estado de cuenta basado en pagos confirmados. Los pagos pendientes de conciliación no se reflejan como cobrados.', false),
    (p_org, 'appraisal_report', 1, 'Informe de tasación',
     'Documento interno. El valor de mercado es una estimación del tasador con la fuente y fecha indicadas.', false),
    (p_org, 'reservation', 1, 'Constancia de reserva',
     'La reserva vence en la fecha indicada. Una seña solo se considera recibida cuando su pago está confirmado.', false),
    (p_org, 'sales_contract', 1, 'Contrato de compraventa (borrador)',
     'BORRADOR SUJETO A REVISIÓN LEGAL. Este documento no tiene validez jurídica ni firma electrónica hasta su revisión y firma conforme a la normativa aplicable.', true),
    (p_org, 'delivery_record', 1, 'Acta de entrega',
     'Acta de entrega emitida por sistema. Requiere firma del cliente y del responsable de la entrega.', false)
  on conflict do nothing;
end $$;

create or replace function public.create_organization(
  p_name text, p_currency char(3), p_is_demo boolean default false, p_owner uuid default null
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  insert into public.organizations (name, default_currency, is_demo) values (p_name, p_currency, p_is_demo)
  returning id into v_id;
  perform app.bootstrap_organization(v_id);
  if p_owner is not null then
    insert into public.memberships (organization_id, user_id, role_code) values (v_id, p_owner, 'ceo');
  end if;
  return v_id;
end $$;
-- La protección es el privilegio de ejecución: authenticated y anon no pueden invocarla.
revoke execute on function public.create_organization(text, char, boolean, uuid) from authenticated, anon, public;
grant execute on function public.create_organization(text, char, boolean, uuid) to service_role;
