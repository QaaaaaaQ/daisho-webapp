-- Only structured event codes and field identifiers are stored, never entered values.
CREATE TABLE IF NOT EXISTS app_private.document_input_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  doc_type text NOT NULL CHECK (doc_type IN ('納品書','請求書','領収書','見積書','不明')),
  event_type text NOT NULL CHECK (event_type IN ('validation_error','save_error','saved')),
  issue_code text NOT NULL CHECK (issue_code IN ('saved','validation_invalid','customer_missing','customer_ambiguous','customer_code_missing','details_missing','product_category_missing','tax_rate_invalid','amount_invalid','quantity_invalid','price_invalid','date_missing','item_name_missing','receipt_amount_mismatch','reservation_invalid','save_failed','conflict','insufficient_stock','network_error')),
  field_name text NOT NULL CHECK (field_name ~ '^(document|customer|customer_code|amount|items|items[.][0-9]+[.](category|taxRate|amount)|inventory)$'),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS document_input_events_actor_time_idx ON app_private.document_input_events(actor_id,created_at DESC);
ALTER TABLE app_private.document_input_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.document_input_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_document_input_event(p_doc_type text,p_event_type text,p_issue_code text,p_field_name text,p_document_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=p_document_id AND (created_by=actor OR public.current_user_role()='admin')) THEN
    RAISE EXCEPTION '書類を確認できません';
  END IF;
  INSERT INTO app_private.document_input_events(actor_id,doc_type,event_type,issue_code,field_name,document_id)
    VALUES(actor,p_doc_type,p_event_type,p_issue_code,p_field_name,p_document_id);
END $$;
REVOKE ALL ON FUNCTION public.record_document_input_event(text,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_document_input_event(text,text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_document_input_events(p_actor_id uuid DEFAULT NULL,p_doc_type text DEFAULT NULL,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_limit integer DEFAULT 200)
RETURNS TABLE(id bigint,created_at timestamptz,actor_id uuid,actor_email text,doc_type text,event_type text,issue_code text,field_name text,document_id uuid,doc_no text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>500 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) THEN RAISE EXCEPTION '検索条件を確認してください'; END IF;
  RETURN QUERY SELECT e.id,e.created_at,e.actor_id,u.email::text,e.doc_type,e.event_type,e.issue_code,e.field_name,e.document_id,d.doc_no
    FROM app_private.document_input_events e LEFT JOIN auth.users u ON u.id=e.actor_id LEFT JOIN public.documents d ON d.id=e.document_id
    WHERE (p_actor_id IS NULL OR e.actor_id=p_actor_id) AND (p_doc_type IS NULL OR e.doc_type=p_doc_type)
      AND (p_from IS NULL OR e.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Tokyo'))
      AND (p_to IS NULL OR e.created_at < ((p_to+1)::timestamp AT TIME ZONE 'Asia/Tokyo'))
    ORDER BY e.created_at DESC,e.id DESC LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_document_input_events(uuid,text,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_document_input_events(uuid,text,date,date,integer) TO authenticated;
