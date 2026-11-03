-- Keep the original inventory and status records even when an erroneous master is removed.
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS deleted_product_id uuid;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS deleted_product_name text;
ALTER TABLE app_private.product_status_audit ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE app_private.product_status_audit ADD COLUMN IF NOT EXISTS deleted_product_id uuid;
ALTER TABLE app_private.product_status_audit ADD COLUMN IF NOT EXISTS deleted_product_name text;
CREATE INDEX IF NOT EXISTS stock_logs_deleted_product_id_idx ON public.stock_logs(deleted_product_id) WHERE deleted_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_status_audit_deleted_product_id_idx ON app_private.product_status_audit(deleted_product_id) WHERE deleted_product_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS app_private.product_deletion_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 original_product_id uuid NOT NULL,
 product_snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_private.product_deletion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.product_deletion_audit FROM PUBLIC,anon,authenticated;

-- All product removal must pass through the audited administrator function.
REVOKE DELETE ON public.products FROM authenticated;

-- Serialize document references against deletion, including older name-only rows.
CREATE OR REPLACE FUNCTION app_private.lock_document_product_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(NEW.items)='array' THEN
   PERFORM p.id FROM public.products p WHERE EXISTS (
     SELECT 1 FROM jsonb_array_elements(NEW.items) item
     WHERE p.id::text=item->>'productId' OR
       (nullif(item->>'productId','') IS NULL AND btrim(p.name)=btrim(item->>'name'))
   ) ORDER BY p.id FOR KEY SHARE OF p;
   IF EXISTS (
     SELECT 1 FROM jsonb_array_elements(NEW.items) item
     WHERE nullif(item->>'productId','') IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id::text=item->>'productId')
       AND NOT (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(OLD.items,'[]'::jsonb)) old_item WHERE old_item->>'productId'=item->>'productId'))
       AND NOT (NEW.doc_type='請求書' AND EXISTS(SELECT 1 FROM public.documents src CROSS JOIN LATERAL jsonb_array_elements(src.items) original
         WHERE src.id::text=item->>'sourceDocumentId' AND src.customer=NEW.customer
         AND (src.created_by=auth.uid() OR public.current_user_role()='admin') AND original->>'productId'=item->>'productId'))
   ) THEN RAISE EXCEPTION '商品が削除されています。最新の商品を選択してください'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lock_document_product_references ON public.documents;
CREATE TRIGGER lock_document_product_references BEFORE INSERT OR UPDATE OF items ON public.documents
 FOR EACH ROW EXECUTE FUNCTION app_private.lock_document_product_references();

CREATE OR REPLACE FUNCTION public.delete_misregistered_product(p_product_id uuid,p_expected_stock numeric,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.products%ROWTYPE; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
 IF p_expected_stock IS NULL OR nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>500 THEN RAISE EXCEPTION '現在庫と削除理由を確認してください'; END IF;
 SELECT * INTO p FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '商品が見つかりません'; END IF;
 IF p.stock IS DISTINCT FROM p_expected_stock THEN RAISE EXCEPTION '在庫が変更されています。最新情報を確認してください'; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_lots WHERE product_id=p.id)
   OR EXISTS(SELECT 1 FROM public.inventory_reservations WHERE product_id=p.id)
   OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE product_id=p.id)
   OR EXISTS(SELECT 1 FROM public.stock_logs WHERE product_id=p.id AND doc_id IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.documents d CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.items)='array' THEN d.items ELSE '[]'::jsonb END) item
      WHERE item->>'productId'=p.id::text OR (nullif(item->>'productId','') IS NULL AND btrim(item->>'name')=btrim(p.name))) THEN
    RAISE EXCEPTION '書類、ロットまたは予約の履歴があるため削除できません。停用をご利用ください';
 END IF;
 INSERT INTO app_private.product_deletion_audit(original_product_id,product_snapshot,actor_id,reason)
 VALUES(p.id,to_jsonb(p),actor,btrim(p_reason));
 UPDATE public.stock_logs SET deleted_product_id=p.id,deleted_product_name=p.name,product_id=NULL WHERE product_id=p.id;
 UPDATE app_private.product_status_audit SET deleted_product_id=p.id,deleted_product_name=p.name,product_id=NULL WHERE product_id=p.id;
 DELETE FROM public.products WHERE id=p.id;
END $$;
REVOKE ALL ON FUNCTION public.delete_misregistered_product(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_misregistered_product(uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_deleted_product_history()
RETURNS TABLE(product_id uuid,product_name text,product_code text,stock numeric,unit text,actor_email text,reason text,deleted_at timestamptz,stock_events jsonb,status_events jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
 RETURN QUERY SELECT a.original_product_id,a.product_snapshot->>'name',a.product_snapshot->>'code',
   (a.product_snapshot->>'stock')::numeric,a.product_snapshot->>'unit',u.email::text,a.reason,a.created_at,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'change',s.change,'reason',s.reason,'created_at',s.created_at,'actor_email',su.email) ORDER BY s.created_at) FROM public.stock_logs s LEFT JOIN auth.users su ON su.id=s.created_by WHERE s.deleted_product_id=a.original_product_id),'[]'::jsonb),
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'archived',h.archived,'reason',h.reason,'created_at',h.created_at,'actor_email',hu.email) ORDER BY h.created_at) FROM app_private.product_status_audit h LEFT JOIN auth.users hu ON hu.id=h.actor_id WHERE h.deleted_product_id=a.original_product_id),'[]'::jsonb)
 FROM app_private.product_deletion_audit a LEFT JOIN auth.users u ON u.id=a.actor_id
 ORDER BY a.created_at DESC,a.id DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.list_deleted_product_history() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_deleted_product_history() TO authenticated;
