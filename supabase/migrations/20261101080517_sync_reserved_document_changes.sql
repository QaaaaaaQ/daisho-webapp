-- Keep stock reservations aligned with edits to the document they represent.
CREATE OR REPLACE FUNCTION app_private.sync_edited_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_signature jsonb; new_signature jsonb; location uuid; locations integer;
BEGIN
  IF OLD.inventory_mode <> 'reserve' THEN RETURN NEW; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'productId',x->>'qty',x->>'caseCount',x->>'unit') ORDER BY ord), '[]'::jsonb)
    INTO old_signature FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS t(x,ord);
  SELECT coalesce(jsonb_agg(jsonb_build_array(x->>'productId',x->>'qty',x->>'caseCount',x->>'unit') ORDER BY ord), '[]'::jsonb)
    INTO new_signature FROM jsonb_array_elements(NEW.items) WITH ORDINALITY AS t(x,ord);
  IF old_signature = new_signature THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE document_id=NEW.id AND status='shipped') THEN
    RAISE EXCEPTION '出庫済みの数量は変更できません。出庫記録を確認してください';
  END IF;
  SELECT count(DISTINCT location_id), min(location_id::text)::uuid INTO locations, location
    FROM public.inventory_reservations WHERE document_id=NEW.id AND status='reserved';
  IF locations > 1 THEN RAISE EXCEPTION '複数倉庫の予約は変更できません。予約を確認してください'; END IF;
  IF locations = 1 THEN
    PERFORM public.inventory_workflow('release', NEW.id, NULL, '明細変更による予約更新');
    PERFORM public.inventory_workflow('reserve', NEW.id, location, '明細変更による予約更新');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_edited_reservation ON public.documents;
CREATE TRIGGER sync_edited_reservation AFTER UPDATE OF items ON public.documents
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_edited_reservation();

DROP POLICY IF EXISTS documents_read_authenticated ON public.documents;
CREATE POLICY documents_read_owner_or_admin ON public.documents FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.current_user_role() = 'admin');
