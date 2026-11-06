-- New products created by a shipment remain visible for administrator review.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pending_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id);
-- Browser-created products cannot grant themselves the negative-stock exception.
REVOKE INSERT ON public.products FROM authenticated;
GRANT INSERT (code,name,origin,unit,price,purchase_price,category,tax_rate,case_qty,qty_per_case,note)
  ON public.products TO authenticated;

-- Patch the existing implementation only if the expected source is present.
DO $migration$
DECLARE definition text; changed text;
BEGIN
  definition:=replace(pg_get_functiondef('app_private.prepare_document(jsonb,boolean)'::regprocedure),E'\r\n',E'\n');
  changed:=replace(definition,
    $old$SELECT count(*) INTO matches FROM public.products WHERE archived_at IS NULL AND btrim(name)=btrim(it->>'name');
        IF matches <> 1 THEN RAISE EXCEPTION '商品「%」をマスターに登録し、候補から選択してください', it->>'name'; END IF;
        SELECT * INTO product FROM public.products WHERE archived_at IS NULL AND btrim(name)=btrim(it->>'name');$old$,
    $new$PERFORM pg_advisory_xact_lock(hashtextextended('pending-product:' || btrim(it->>'name'),0));
        SELECT count(*) INTO matches FROM public.products WHERE archived_at IS NULL AND btrim(name)=btrim(it->>'name');
        IF matches > 1 THEN RAISE EXCEPTION '商品「%」の候補が複数あります。商品を選択してください', it->>'name'; END IF;
        IF matches = 0 THEN
          IF nullif(btrim(it->>'unit'),'') IS NULL THEN RAISE EXCEPTION '商品「%」の単位を入力してください',it->>'name'; END IF;
          INSERT INTO public.products(name,origin,unit,price,tax_rate,stock,pending_review)
          VALUES(btrim(it->>'name'),nullif(btrim(it->>'origin'),''),btrim(it->>'unit'),price,coalesce(nullif(it->>'taxRate','')::integer,8),0,true)
          RETURNING * INTO product;
        ELSE
          SELECT * INTO product FROM public.products WHERE archived_at IS NULL AND btrim(name)=btrim(it->>'name');
        END IF;$new$);
  IF changed=definition THEN RAISE EXCEPTION 'prepare_document source mismatch'; END IF;
  EXECUTE changed;
  definition:=replace(pg_get_functiondef('app_private.sync_stock_v2(public.documents,boolean)'::regprocedure),E'\r\n',E'\n');
  changed:=replace(definition,
    $old$IF move.delta<0 AND coalesce(balance,0)+move.delta<0 THEN RAISE EXCEPTION '在庫が不足しています。入庫数量を確認してください'; END IF;$old$,
    $new$IF move.delta<0 AND coalesce(balance,0)+move.delta<0 AND NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=move.id AND p.pending_review) THEN RAISE EXCEPTION '在庫が不足しています。入庫数量を確認してください'; END IF;$new$);
  IF changed=definition THEN RAISE EXCEPTION 'sync_stock_v2 source mismatch'; END IF;
  EXECUTE changed;
END $migration$;

CREATE OR REPLACE FUNCTION public.review_pending_product(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
 UPDATE public.products SET pending_review=false,reviewed_at=now(),reviewed_by=auth.uid()
 WHERE id=p_id AND pending_review AND nullif(btrim(category),'') IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION '商品分類を確認してください'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.review_pending_product(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_pending_product(uuid) TO authenticated;
