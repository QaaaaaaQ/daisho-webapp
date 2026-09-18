-- 連番書類番号 + 原子的な在庫操作
-- Supabase Dashboard > SQL Editor で一度だけ実行してください。

ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS admin_emails TEXT DEFAULT 'shin@kobedaisho.com';
UPDATE company_settings SET admin_emails = 'shin@kobedaisho.com' WHERE NULLIF(BTRIM(admin_emails), '') IS NULL;

ALTER TABLE stock_logs DROP CONSTRAINT IF EXISTS stock_logs_product_id_fkey;
ALTER TABLE stock_logs ADD CONSTRAINT stock_logs_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type TEXT PRIMARY KEY CHECK (doc_type IN ('納品書','請求書','領収書','見積書')),
  next_number BIGINT NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON document_sequences FROM anon, authenticated;

DO $$
DECLARE
  v_type TEXT;
  v_next BIGINT;
BEGIN
  FOREACH v_type IN ARRAY ARRAY['納品書','請求書','領収書','見積書'] LOOP
    SELECT COALESCE(MAX((m[1])::BIGINT), 0) + 1
      INTO v_next
      FROM documents d
      CROSS JOIN LATERAL regexp_match(COALESCE(d.doc_no, ''), '(\d+)$') AS m
     WHERE d.doc_type = v_type;
    INSERT INTO document_sequences(doc_type, next_number)
      VALUES (v_type, GREATEST(v_next, 1))
      ON CONFLICT (doc_type) DO NOTHING;
  END LOOP;
END $$;

-- 新しい請求書・領収書シリーズはそれぞれ 100001 から開始する。
UPDATE document_sequences SET next_number = 100001 WHERE doc_type IN ('請求書','領収書');

CREATE OR REPLACE FUNCTION public.create_document(p_doc JSONB)
RETURNS documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_type TEXT := p_doc->>'docType';
  v_number BIGINT;
  v_prefix TEXT;
  v_doc_no TEXT;
  v_row documents;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF v_type NOT IN ('納品書','請求書','領収書','見積書') THEN RAISE EXCEPTION '書類種別が正しくありません'; END IF;
  IF NULLIF(BTRIM(p_doc->>'customer'), '') IS NULL THEN RAISE EXCEPTION '取引先を入力してください'; END IF;

  INSERT INTO document_sequences(doc_type, next_number) VALUES (v_type, 1) ON CONFLICT DO NOTHING;
  v_prefix := CASE v_type WHEN '請求書' THEN 'INV' WHEN '領収書' THEN 'REC' WHEN '見積書' THEN 'EST' ELSE 'DEL' END;

  LOOP
    UPDATE document_sequences SET next_number = next_number + 1 WHERE doc_type = v_type RETURNING next_number - 1 INTO v_number;
    v_doc_no := v_prefix || '-' || LPAD(v_number::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM documents WHERE doc_no = v_doc_no);
  END LOOP;

  INSERT INTO documents(
    doc_type, doc_no, date, customer, subject, due_date, bank, note, amount,
    description, to_addr, to_contact, items, expiry_date, conditions,
    created_by, created_by_name, created_by_email
  ) VALUES (
    v_type, v_doc_no,
    NULLIF(p_doc->>'date', '')::DATE,
    BTRIM(p_doc->>'customer'), NULLIF(p_doc->>'subject', ''), NULLIF(p_doc->>'dueDate', '')::DATE,
    NULLIF(p_doc->>'bank', ''), NULLIF(p_doc->>'note', ''), NULLIF(p_doc->>'amount', '')::NUMERIC,
    NULLIF(p_doc->>'description', ''), NULLIF(p_doc->>'toAddr', ''), NULLIF(p_doc->>'toContact', ''),
    COALESCE(p_doc->'items', '[]'::JSONB), NULLIF(p_doc->>'expiryDate', '')::DATE,
    NULLIF(p_doc->>'conditions', ''), v_user,
    COALESCE(NULLIF(p_doc->>'savedBy', ''), auth.jwt()->>'email'), auth.jwt()->>'email'
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_product_id UUID,
  p_change NUMERIC,
  p_reason TEXT DEFAULT '手動調整',
  p_doc_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_stock NUMERIC;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_product_id IS NULL OR COALESCE(p_change, 0) = 0 THEN RAISE EXCEPTION '在庫変更量が正しくありません'; END IF;
  SELECT stock INTO v_stock FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '商品が見つかりません'; END IF;
  UPDATE products SET stock = COALESCE(stock, 0) + p_change WHERE id = p_product_id RETURNING stock INTO v_stock;
  INSERT INTO stock_logs(product_id, change, reason, doc_id, created_by)
  VALUES (p_product_id, p_change, p_reason, p_doc_id, v_user);
  RETURN v_stock;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_document_stock(
  p_doc_id UUID,
  p_doc_type TEXT,
  p_customer TEXT,
  p_doc_no TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_item JSONB;
  v_name TEXT;
  v_qty NUMERIC;
  v_product_id UUID;
  v_is_new BOOLEAN;
  v_logs JSONB := '[]'::JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_doc_type NOT IN ('納品書','請求書') THEN RETURN v_logs; END IF;
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_doc_id AND created_by = v_user) THEN
    RAISE EXCEPTION '書類を登録する権限がありません';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) LOOP
    v_name := NULLIF(BTRIM(v_item->>'name'), '');
    v_qty := COALESCE(NULLIF(v_item->>'qty', '')::NUMERIC, 0);
    IF v_name IS NULL OR v_qty = 0 THEN CONTINUE; END IF;
    IF v_qty < 0 THEN RAISE EXCEPTION '商品「%」の数量は0より大きくしてください', v_name; END IF;
    v_is_new := false;
    SELECT id INTO v_product_id FROM products WHERE LOWER(BTRIM(name)) = LOWER(v_name) ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO products(name, origin, unit, price, tax_rate, qty_per_case, stock)
      VALUES (v_name, NULLIF(v_item->>'origin',''), COALESCE(NULLIF(v_item->>'unit',''), '個'), COALESCE(NULLIF(v_item->>'price','')::NUMERIC, 0), CASE WHEN (v_item->>'taxRate')::INTEGER = 10 THEN 10 ELSE 8 END, NULLIF(v_item->>'qtyPerCase','')::INTEGER, 0)
      RETURNING id INTO v_product_id;
      v_is_new := true;
    END IF;
    UPDATE products SET stock = COALESCE(stock, 0) - v_qty WHERE id = v_product_id;
    INSERT INTO stock_logs(product_id, change, reason, doc_id, created_by)
    VALUES (v_product_id, -v_qty, p_doc_type || ' 出庫: ' || COALESCE(p_customer,'') || ' ' || COALESCE(p_doc_no,''), p_doc_id, v_user);
    v_logs := v_logs || jsonb_build_array(jsonb_build_object('name', v_name, 'qty', v_qty, 'newProduct', v_is_new));
  END LOOP;
  RETURN v_logs;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_document_stock(
  p_doc_id UUID,
  p_old_doc_type TEXT,
  p_old_items JSONB,
  p_new_doc_type TEXT,
  p_new_items JSONB,
  p_reason TEXT DEFAULT '書類編集による在庫調整'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_name TEXT;
  v_delta NUMERIC;
  v_product_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_doc_id AND created_by = v_user) THEN
    RAISE EXCEPTION '書類を編集する権限がありません';
  END IF;

  FOR v_name, v_delta IN
    SELECT name, SUM(delta)
      FROM (
        SELECT BTRIM(value->>'name') AS name,
               COALESCE(NULLIF(value->>'qty', '')::NUMERIC, 0) AS delta
          FROM jsonb_array_elements(COALESCE(p_old_items, '[]'::JSONB))
         WHERE p_old_doc_type IN ('納品書','請求書') AND NULLIF(BTRIM(value->>'name'), '') IS NOT NULL
        UNION ALL
        SELECT BTRIM(value->>'name') AS name,
               -COALESCE(NULLIF(value->>'qty', '')::NUMERIC, 0) AS delta
          FROM jsonb_array_elements(COALESCE(p_new_items, '[]'::JSONB))
         WHERE p_new_doc_type IN ('納品書','請求書') AND NULLIF(BTRIM(value->>'name'), '') IS NOT NULL
      ) changes
     GROUP BY name
    HAVING SUM(delta) <> 0
  LOOP
    SELECT id INTO v_product_id FROM products WHERE LOWER(BTRIM(name)) = LOWER(v_name) ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '商品「%」が商品マスターにありません', v_name; END IF;
    UPDATE products SET stock = COALESCE(stock, 0) + v_delta WHERE id = v_product_id;
    INSERT INTO stock_logs(product_id, change, reason, doc_id, created_by)
    VALUES (v_product_id, v_delta, p_reason, p_doc_id, v_user);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_document(p_doc_id UUID, p_doc JSONB)
RETURNS documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_old documents;
  v_row documents;
  v_type TEXT := p_doc->>'docType';
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  SELECT * INTO v_old FROM documents WHERE id = p_doc_id AND created_by = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '書類が見つからないか、編集権限がありません'; END IF;
  PERFORM public.reconcile_document_stock(p_doc_id, v_old.doc_type, v_old.items, v_type, COALESCE(p_doc->'items', '[]'::JSONB));
  UPDATE documents SET
    doc_type = v_type, date = NULLIF(p_doc->>'date', '')::DATE, customer = BTRIM(p_doc->>'customer'),
    subject = NULLIF(p_doc->>'subject', ''), due_date = NULLIF(p_doc->>'dueDate', '')::DATE,
    bank = NULLIF(p_doc->>'bank', ''), note = NULLIF(p_doc->>'note', ''), amount = NULLIF(p_doc->>'amount', '')::NUMERIC,
    description = NULLIF(p_doc->>'description', ''), to_addr = NULLIF(p_doc->>'toAddr', ''),
    to_contact = NULLIF(p_doc->>'toContact', ''), items = COALESCE(p_doc->'items', '[]'::JSONB),
    expiry_date = NULLIF(p_doc->>'expiryDate', '')::DATE, conditions = NULLIF(p_doc->>'conditions', '')
  WHERE id = p_doc_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_document(p_doc_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_doc documents;
  v_item JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_doc_id AND created_by = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '書類が見つからないか、削除権限がありません'; END IF;
  IF v_doc.doc_type IN ('納品書','請求書') THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_doc.items, '[]'::JSONB)) LOOP
      v_qty := COALESCE(NULLIF(v_item->>'qty', '')::NUMERIC, 0);
      IF v_qty <= 0 OR NULLIF(BTRIM(v_item->>'name'), '') IS NULL THEN CONTINUE; END IF;
      SELECT id INTO v_product_id FROM products WHERE LOWER(BTRIM(name)) = LOWER(BTRIM(v_item->>'name')) ORDER BY created_at, id LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE products SET stock = COALESCE(stock, 0) + v_qty WHERE id = v_product_id;
        INSERT INTO stock_logs(product_id, change, reason, doc_id, created_by)
        VALUES (v_product_id, v_qty, '書類削除による在庫戻し: ' || v_doc.doc_no, p_doc_id, v_user);
      END IF;
    END LOOP;
  END IF;
  DELETE FROM documents WHERE id = p_doc_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_document(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_document_stock(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_document_stock(UUID, TEXT, JSONB, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_document(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_document(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM company_settings c
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(c.admin_emails, ''), '[,;[:space:]]+') AS e(email)
     WHERE LOWER(BTRIM(e.email)) = LOWER(COALESCE(auth.jwt()->>'email', ''))
  );
$$;
REVOKE ALL ON FUNCTION public.is_company_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_admin() TO authenticated;

DROP POLICY IF EXISTS "auth_read_docs" ON documents;
CREATE POLICY "auth_read_docs" ON documents FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.is_company_admin());

DROP POLICY IF EXISTS "auth_update_docs" ON documents;
CREATE POLICY "auth_update_docs" ON documents FOR UPDATE TO authenticated
  USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
