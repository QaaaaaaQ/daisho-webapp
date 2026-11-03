-- Deactivation keeps product IDs, stock and every historic inventory record intact.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Keep name-only stock resolution working when an older duplicate is inactive.
DO $$
DECLARE definition text:=pg_get_functiondef('app_private.prepare_document(jsonb,boolean)'::regprocedure);
BEGIN
 IF position('SELECT count(*) INTO matches FROM public.products WHERE btrim(name)=btrim(it->>''name'');' in definition)=0
    OR position('SELECT * INTO product FROM public.products WHERE btrim(name)=btrim(it->>''name'');' in definition)=0 THEN
   RAISE EXCEPTION '商品名の照合処理が想定と異なります';
 END IF;
 definition:=replace(definition,'SELECT count(*) INTO matches FROM public.products WHERE btrim(name)=btrim(it->>''name'');',
   'SELECT count(*) INTO matches FROM public.products WHERE archived_at IS NULL AND btrim(name)=btrim(it->>''name'');');
 definition:=replace(definition,'SELECT * INTO product FROM public.products WHERE btrim(name)=btrim(it->>''name'');',
   'SELECT * INTO product FROM public.products WHERE archived_at IS NULL AND btrim(name)=btrim(it->>''name'');');
 EXECUTE definition;
END $$;
CREATE TABLE IF NOT EXISTS app_private.product_status_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id uuid NOT NULL REFERENCES public.products(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 archived boolean NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 stock_at_change numeric NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.product_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.product_status_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_product_archived(p_product_id uuid,p_archived boolean,p_reason text,p_expected_stock numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE product_row public.products%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
 IF p_archived IS NULL OR p_expected_stock IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>500 THEN RAISE EXCEPTION '理由と現在庫を確認してください'; END IF;
 SELECT * INTO product_row FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '商品が見つかりません'; END IF;
 IF product_row.stock IS DISTINCT FROM p_expected_stock THEN RAISE EXCEPTION '在庫が変更されています。最新情報を確認してください'; END IF;
 IF (product_row.archived_at IS NOT NULL)=p_archived THEN RETURN; END IF;
 IF p_archived AND EXISTS(SELECT 1 FROM public.inventory_reservations WHERE product_id=p_product_id AND status='reserved') THEN
   RAISE EXCEPTION '未出庫の予約がある商品は停用できません';
 END IF;
 UPDATE public.products SET archived_at=CASE WHEN p_archived THEN now() ELSE NULL END WHERE id=p_product_id;
 INSERT INTO app_private.product_status_audit(product_id,actor_id,archived,reason,stock_at_change)
 VALUES(p_product_id,actor,p_archived,btrim(p_reason),product_row.stock);
END $$;
REVOKE ALL ON FUNCTION public.set_product_archived(uuid,boolean,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_product_archived(uuid,boolean,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_product_status_audit(p_product_id uuid)
RETURNS TABLE(created_at timestamptz,actor_email text,archived boolean,reason text,stock_at_change numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
 RETURN QUERY SELECT a.created_at,u.email::text,a.archived,a.reason,a.stock_at_change
 FROM app_private.product_status_audit a LEFT JOIN auth.users u ON u.id=a.actor_id
 WHERE a.product_id=p_product_id ORDER BY a.created_at DESC,a.id DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.list_product_status_audit(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_product_status_audit(uuid) TO authenticated;

-- Existing documents and genuine invoice conversions retain their source items.
CREATE OR REPLACE FUNCTION app_private.guard_archived_product_documents()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;
BEGIN
 IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
   IF EXISTS(SELECT 1 FROM public.products p WHERE p.id::text=item->>'productId' AND p.archived_at IS NOT NULL)
     AND NOT (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(OLD.items,'[]'::jsonb)) prior WHERE prior->>'productId'=item->>'productId'))
     AND NOT (NEW.doc_type='請求書' AND EXISTS(
       SELECT 1 FROM public.documents src CROSS JOIN LATERAL jsonb_array_elements(src.items) original
       WHERE src.id::text=item->>'sourceDocumentId' AND src.doc_type='納品書' AND src.customer=NEW.customer
         AND (src.created_by=auth.uid() OR public.current_user_role()='admin')
         AND original->>'productId'=item->>'productId')) THEN
     RAISE EXCEPTION '停用済みの商品は新しい書類に追加できません';
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_archived_product_documents ON public.documents;
CREATE TRIGGER guard_archived_product_documents BEFORE INSERT OR UPDATE OF items ON public.documents
 FOR EACH ROW EXECUTE FUNCTION app_private.guard_archived_product_documents();
