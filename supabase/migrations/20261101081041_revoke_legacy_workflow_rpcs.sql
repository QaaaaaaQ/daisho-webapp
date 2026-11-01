-- Browser clients use sales_workflow; its security-definer owner may still call
-- internal helpers. Retire direct browser access to the legacy entry points.
DO $$
DECLARE signature text; fn regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.create_document(jsonb)',
    'public.update_document(uuid,jsonb)',
    'public.delete_document(uuid)',
    'public.delete_documents(uuid[])',
    'public.adjust_stock(uuid,numeric,text,uuid)',
    'public.register_document_stock(uuid,text,text,text,jsonb)',
    'public.reconcile_document_stock(uuid,text,jsonb,text,jsonb,text)',
    'public.convert_delivery_notes_to_invoice(uuid[],jsonb)',
    'public.log_document_delete()'
  ] LOOP
    fn := to_regprocedure(signature);
    IF fn IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END $$;
