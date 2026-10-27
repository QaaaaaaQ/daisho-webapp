-- Additive v2 workflows. No historical quantity or balance is rewritten.
-- Existing legacy RPCs are left intact until all clients have been upgraded.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS tax_summary jsonb;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source_document_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS workflow_version integer;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;
CREATE TABLE IF NOT EXISTS app_private.workflow_requests (
  actor_id uuid NOT NULL, request_id uuid NOT NULL, action text NOT NULL,
  payload jsonb NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, request_id)
);
ALTER TABLE app_private.workflow_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.workflow_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.document_tax(p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_item jsonb; v_rate integer; v_amount numeric; g8 numeric := 0; g10 numeric := 0;
  t8 numeric; t10 numeric;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '明細の形式が正しくありません'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_rate := coalesce((v_item->>'taxRate')::integer, 8);
    v_amount := coalesce((v_item->>'amount')::numeric, 0);
    IF v_rate NOT IN (8,10) OR v_amount < 0 OR v_amount > 1000000000000 THEN RAISE EXCEPTION '金額・税率を確認してください'; END IF;
    IF NOT coalesce((v_item->>'taxIncluded')::boolean, false) THEN v_amount := v_amount * (100+v_rate)/100; END IF;
    IF v_rate = 8 THEN g8 := g8 + v_amount; ELSE g10 := g10 + v_amount; END IF;
  END LOOP;
  g8 := round(g8); g10 := round(g10);
  t8 := round(g8*8/108); t10 := round(g10*10/110);
  RETURN jsonb_build_object('version',2,'gross8',g8,'gross10',g10,'t8',t8,'t10',t10,
    's8',g8-t8,'s10',g10-t10,'sub',g8+g10-t8-t10,'tax',t8+t10,'total',g8+g10);
END $$;

CREATE OR REPLACE FUNCTION app_private.quantity_signature(p_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(x.v ORDER BY x.v::text), '[]'::jsonb) FROM (
    SELECT jsonb_build_array(coalesce(nullif(value->>'productId',''), btrim(value->>'name')),
      coalesce(nullif(value->>'qty',''),'0')::numeric, coalesce(value->>'unit','')) AS v
    FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  ) x;
$$;

CREATE OR REPLACE FUNCTION app_private.prepare_document(p_doc jsonb, p_manage boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE it jsonb; result jsonb := '[]'::jsonb; product public.products%ROWTYPE;
  qty numeric; price numeric; amount numeric; matches integer; tx jsonb; typ text := p_doc->>'docType';
BEGIN
  IF typ IS NULL OR typ NOT IN ('納品書','請求書','領収書','見積書') THEN RAISE EXCEPTION '書類種別が正しくありません'; END IF;
  IF nullif(btrim(p_doc->>'customer'),'') IS NULL THEN RAISE EXCEPTION '取引先を入力してください'; END IF;
  IF nullif(p_doc->>'date','') IS NULL THEN RAISE EXCEPTION '日付を入力してください'; END IF;
  IF jsonb_typeof(p_doc->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '明細の形式が正しくありません'; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(p_doc->'items') LOOP
    qty := coalesce(nullif(it->>'qty','')::numeric,0);
    price := coalesce(nullif(it->>'price','')::numeric,0);
    amount := coalesce(nullif(it->>'amount','')::numeric,qty*price);
    IF nullif(btrim(it->>'name'),'') IS NULL OR qty <= 0 OR qty > 1000000000
      OR price < 0 OR price > 1000000000000 OR amount < 0 OR amount > 1000000000000
      OR abs(qty*price-amount)>0.01 THEN RAISE EXCEPTION '商品名・数量・単価・金額を確認してください'; END IF;
    -- Limit precision to the same six decimal places used by the JS calculation.
    IF amount <> round(amount,6) THEN RAISE EXCEPTION '金額の小数は6桁以内で入力してください'; END IF;
    it := it || jsonb_build_object('name',btrim(it->>'name'),'qty',qty,'price',price,'amount',amount);
    IF p_manage THEN
      IF nullif(it->>'productId','') IS NOT NULL THEN
        SELECT * INTO product FROM public.products WHERE id=(it->>'productId')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION '商品が見つかりません'; END IF;
      ELSE
        SELECT count(*) INTO matches FROM public.products WHERE btrim(name)=btrim(it->>'name');
        IF matches <> 1 THEN RAISE EXCEPTION '商品「%」をマスターに登録し、候補から選択してください', it->>'name'; END IF;
        SELECT * INTO product FROM public.products WHERE btrim(name)=btrim(it->>'name');
      END IF;
      IF nullif(it->>'unit','') IS DISTINCT FROM nullif(product.unit,'') THEN RAISE EXCEPTION '商品「%」の在庫単位と明細単位が一致しません', product.name; END IF;
      it := it || jsonb_build_object('productId',product.id,'productCode',product.code);
    END IF;
    result := result || jsonb_build_array(it);
  END LOOP;
  tx := app_private.document_tax(result);
  IF typ = '領収書' THEN
    amount := coalesce(nullif(p_doc->>'amount','')::numeric,0);
    IF amount <= 0 THEN amount := (tx->>'total')::numeric; END IF;
    IF amount <= 0 OR amount > 1000000000000 THEN RAISE EXCEPTION '金額・税率を確認してください'; END IF;
    IF jsonb_array_length(result)=0 OR amount <> (tx->>'total')::numeric THEN tx := NULL; END IF;
  ELSE
    IF jsonb_array_length(result)=0 THEN RAISE EXCEPTION '明細の形式が正しくありません'; END IF;
    amount := (tx->>'total')::numeric;
  END IF;
  RETURN p_doc || jsonb_build_object('items',result,'amount',amount,'taxSummary',tx);
END $$;

CREATE OR REPLACE FUNCTION app_private.sync_stock_v2(p_doc public.documents, p_reverse boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE move record; balance numeric; v_name text; effects jsonb := '[]'::jsonb;
BEGIN
  -- Product rows are locked in UUID order, including rows present only in old logs.
  PERFORM p.id FROM public.products p WHERE p.id IN (
    SELECT (it->>'productId')::uuid FROM jsonb_array_elements(p_doc.items) it WHERE nullif(it->>'productId','') IS NOT NULL
    UNION SELECT sl.product_id FROM public.stock_logs sl WHERE sl.doc_id=p_doc.id
  ) ORDER BY p.id FOR UPDATE;
  FOR move IN
    WITH actual AS (
      SELECT sl.product_id,sum(sl.change) AS qty FROM public.stock_logs sl WHERE sl.doc_id=p_doc.id GROUP BY sl.product_id
    ), desired AS (
      SELECT (it->>'productId')::uuid AS product_id, -sum((it->>'qty')::numeric) AS qty
      FROM jsonb_array_elements(p_doc.items) it WHERE NOT p_reverse AND p_doc.stock_managed IS TRUE
      GROUP BY (it->>'productId')::uuid
    )
    SELECT coalesce(a.product_id,d.product_id) AS id,coalesce(d.qty,0)-coalesce(a.qty,0) AS delta
      FROM actual a FULL JOIN desired d USING(product_id)
      WHERE coalesce(d.qty,0)<>coalesce(a.qty,0)
      ORDER BY coalesce(a.product_id,d.product_id)
  LOOP
    SELECT stock,name INTO balance,v_name FROM public.products WHERE id=move.id;
    IF move.delta<0 AND coalesce(balance,0)+move.delta<0 THEN RAISE EXCEPTION '在庫が不足しています。入庫数量を確認してください'; END IF;
    UPDATE public.products SET stock=coalesce(stock,0)+move.delta WHERE id=move.id;
    IF NOT FOUND THEN RAISE EXCEPTION '商品が見つかりません'; END IF;
    INSERT INTO public.stock_logs(product_id,change,reason,doc_id,created_by)
      VALUES(move.id,move.delta,CASE WHEN p_reverse THEN '未出荷登録の取消: ' ELSE '出荷・数量訂正: ' END || p_doc.doc_no,p_doc.id,auth.uid());
    effects := effects || jsonb_build_array(jsonb_build_object('productId',move.id,'name',v_name,'qty',-move.delta,'change',move.delta));
  END LOOP;
  RETURN effects;
END $$;

CREATE OR REPLACE FUNCTION app_private.sales_workflow(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); previous app_private.workflow_requests%ROWTYPE;
  old_doc public.documents%ROWTYPE; doc public.documents%ROWTYPE; prepared jsonb;
  effects jsonb:='[]'::jsonb; output jsonb; manage boolean; changed boolean;
  sources uuid[]; source_count integer; v_customer text; all_items jsonb; ids uuid[];
  delta numeric; balance numeric; product_name text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'リクエスト形式が不正です'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text,0));
  SELECT * INTO previous FROM app_private.workflow_requests WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.action<>p_action OR previous.payload<>p_payload THEN RAISE EXCEPTION '同じ処理IDで内容が変更されました'; END IF;
    RETURN previous.response;
  END IF;
  IF p_action='create' THEN
    manage := (p_payload->'doc'->>'docType' IN ('納品書','請求書')) AND
      coalesce((p_payload->'doc'->>'stockManaged')::boolean,p_payload->'doc'->>'docType'='納品書');
    prepared := app_private.prepare_document(p_payload->'doc',manage);
    SELECT * INTO doc FROM public.create_document(prepared || jsonb_build_object('stockManaged',manage));
    UPDATE public.documents SET tax_summary=prepared->'taxSummary', workflow_version=2
      WHERE id=doc.id RETURNING * INTO doc;
    IF manage THEN effects:=app_private.sync_stock_v2(doc); END IF;
  ELSIF p_action IN ('update','void') THEN
    SELECT * INTO old_doc FROM public.documents WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT (old_doc.created_by IS NOT DISTINCT FROM actor OR public.is_admin()) THEN RAISE EXCEPTION '書類が見つからないか、操作権限がありません'; END IF;
    IF old_doc.converted_to_document_id IS NOT NULL THEN RAISE EXCEPTION '請求書にまとめ済みです。先に請求書を確認してください'; END IF;
    IF p_action='void' THEN
      IF nullif(btrim(p_payload->>'reason'),'') IS NULL THEN RAISE EXCEPTION '理由を入力してください'; END IF;
      IF old_doc.voided_at IS NULL THEN
        IF coalesce((p_payload->>'reverseStock')::boolean,false) THEN
          IF old_doc.stock_managed IS DISTINCT FROM TRUE OR cardinality(old_doc.source_document_ids)>0 THEN RAISE EXCEPTION 'この書類は在庫自動戻しの対象外です。原始記録を確認してください'; END IF;
          effects:=app_private.sync_stock_v2(old_doc,true);
        END IF;
        UPDATE public.documents SET voided_at=now(),void_reason=p_payload->>'reason' WHERE id=old_doc.id;
        -- An invoice cancellation releases its sources for re-billing, never stock.
        UPDATE public.documents SET converted_to_document_id=NULL,converted_at=NULL
          WHERE converted_to_document_id=old_doc.id AND id=ANY(old_doc.source_document_ids);
      END IF;
      SELECT * INTO doc FROM public.documents WHERE id=old_doc.id;
    ELSE
      IF old_doc.voided_at IS NOT NULL THEN RAISE EXCEPTION '取消済み書類は編集できません'; END IF;
      IF nullif(p_payload->>'expectedUpdatedAt','') IS NULL OR
        (p_payload->>'expectedUpdatedAt')::timestamptz IS DISTINCT FROM old_doc.updated_at THEN RAISE EXCEPTION '別の操作で更新されました。再読込してから編集してください'; END IF;
      IF p_payload->'doc'->>'docType' IS DISTINCT FROM old_doc.doc_type THEN RAISE EXCEPTION '発行済み書類の種別は変更できません'; END IF;
      changed := app_private.quantity_signature(p_payload->'doc'->'items') IS DISTINCT FROM app_private.quantity_signature(old_doc.items);
      IF changed AND (old_doc.stock_managed IS NULL OR cardinality(old_doc.source_document_ids)>0 OR
        (old_doc.stock_managed IS TRUE AND old_doc.workflow_version IS DISTINCT FROM 2 AND
         NOT EXISTS(SELECT 1 FROM public.stock_logs WHERE doc_id=old_doc.id))) THEN RAISE EXCEPTION '旧書類・まとめ請求書の数量訂正は原始記録の確認が必要です'; END IF;
      prepared:=app_private.prepare_document(p_payload->'doc',old_doc.stock_managed IS TRUE AND changed);
      UPDATE public.documents SET date=(prepared->>'date')::date,customer=btrim(prepared->>'customer'),
        subject=prepared->>'subject',due_date=nullif(prepared->>'dueDate','')::date,bank=prepared->>'bank',
        note=prepared->>'note',amount=(prepared->>'amount')::numeric,description=prepared->>'description',
        to_addr=prepared->>'toAddr',to_contact=prepared->>'toContact',items=prepared->'items',
        expiry_date=nullif(prepared->>'expiryDate','')::date,conditions=prepared->>'conditions',
        tax_summary=prepared->'taxSummary'
        WHERE id=old_doc.id RETURNING * INTO doc;
      IF changed AND old_doc.stock_managed IS TRUE THEN effects:=app_private.sync_stock_v2(doc); END IF;
    END IF;
  ELSIF p_action='invoice' THEN
    SELECT array_agg(value::uuid) INTO sources FROM jsonb_array_elements_text(p_payload->'sourceIds');
    IF coalesce(cardinality(sources),0)=0 OR cardinality(sources)<>(SELECT count(DISTINCT s) FROM unnest(sources)s) THEN RAISE EXCEPTION '同一取引先の未請求・操作権限のある納品書だけを選択してください'; END IF;
    PERFORM id FROM public.documents WHERE id=ANY(sources) ORDER BY id FOR UPDATE;
    SELECT count(*),min(d.customer) INTO source_count,v_customer FROM public.documents d WHERE d.id=ANY(sources)
      AND d.doc_type='納品書' AND d.voided_at IS NULL AND d.converted_to_document_id IS NULL
      AND (d.created_by=actor OR public.is_admin());
    IF source_count<>cardinality(sources) OR EXISTS(SELECT 1 FROM public.documents d WHERE d.id=ANY(sources) AND d.customer IS DISTINCT FROM v_customer)
      THEN RAISE EXCEPTION '同一取引先の未請求・操作権限のある納品書だけを選択してください'; END IF;
    SELECT jsonb_agg(it.value || jsonb_build_object('date',coalesce(nullif(it.value->>'date',''),d.date::text),
      'sourceDocumentId',d.id,'sourceDocNo',d.doc_no) ORDER BY d.date,d.id,it.ordinality)
      INTO all_items FROM public.documents d CROSS JOIN LATERAL jsonb_array_elements(d.items) WITH ORDINALITY AS it(value,ordinality)
      WHERE d.id=ANY(sources);
    prepared:=app_private.prepare_document((p_payload->'doc') || jsonb_build_object('docType','請求書','customer',v_customer,'items',all_items,'stockManaged',false),false);
    SELECT * INTO doc FROM public.create_document(prepared || jsonb_build_object('stockManaged',false));
    UPDATE public.documents SET source_document_ids=sources,tax_summary=prepared->'taxSummary',workflow_version=2
      WHERE id=doc.id RETURNING * INTO doc;
    UPDATE public.documents SET converted_to_document_id=doc.id,converted_at=now() WHERE id=ANY(sources);
  ELSIF p_action='adjust' THEN
    IF nullif(btrim(p_payload->>'reason'),'') IS NULL THEN RAISE EXCEPTION '理由を入力してください'; END IF;
    delta:=(p_payload->>'change')::numeric;
    IF delta IS NULL OR delta=0 OR delta>1000000000 OR delta< -1000000000 THEN RAISE EXCEPTION '調整数量が正しくありません'; END IF;
    SELECT coalesce(stock,0),name INTO balance,product_name FROM public.products WHERE id=(p_payload->>'productId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '商品が見つかりません'; END IF;
    IF delta<0 AND balance+delta<0 THEN RAISE EXCEPTION '在庫が不足しています。入庫数量を確認してください'; END IF;
    UPDATE public.products SET stock=balance+delta WHERE id=(p_payload->>'productId')::uuid;
    INSERT INTO public.stock_logs(product_id,change,reason,created_by) VALUES((p_payload->>'productId')::uuid,delta,p_payload->>'reason',actor);
    output:=jsonb_build_object('stock',balance+delta);
  ELSE RAISE EXCEPTION '未対応の操作です'; END IF;
  IF output IS NULL THEN output:=jsonb_build_object('document',to_jsonb(doc),'stockLogs',effects,'newProducts','[]'::jsonb,'newCustomer',NULL); END IF;
  INSERT INTO app_private.workflow_requests(actor_id,request_id,action,payload,response)
    VALUES(actor,p_request_id,p_action,p_payload,output);
  RETURN output;
END $$;

CREATE OR REPLACE FUNCTION public.sales_workflow(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.sales_workflow(p_action,p_payload,p_request_id);
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.sales_workflow(text,jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.sales_workflow(text,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_workflow(text,jsonb,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
