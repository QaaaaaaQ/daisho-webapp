-- Additive operations modules. Existing stock and documents are not rewritten.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS inventory_mode text NOT NULL DEFAULT 'none'
  CHECK(inventory_mode IN ('none','ship','reserve'));
DO $$
DECLARE definition text; updated_definition text;
BEGIN
  definition:=pg_get_functiondef('app_private.sales_workflow(text,jsonb,uuid)'::regprocedure);
  updated_definition:=replace(definition,
    'UPDATE public.documents SET tax_summary=prepared->''taxSummary'', workflow_version=2',
    'UPDATE public.documents SET tax_summary=prepared->''taxSummary'', workflow_version=2, inventory_mode=CASE WHEN (prepared->>''docType'')=''納品書'' THEN coalesce(prepared->>''inventoryMode'',CASE WHEN manage THEN ''ship'' ELSE ''none'' END) ELSE ''none'' END');
  IF updated_definition=definition AND position('inventory_mode=' in definition)=0 THEN
    RAISE EXCEPTION 'sales_workflow source differs; review migration before applying';
  END IF;
  updated_definition:=replace(updated_definition,'public.is_admin()','public.current_user_role()=''admin''');
  IF position('IF manage THEN effects:=app_private.sync_stock_v2(doc); END IF;' in updated_definition)=0 THEN
    RAISE EXCEPTION 'sales_workflow reserve hook differs; review migration before applying';
  END IF;
  updated_definition:=replace(updated_definition,
    'IF manage THEN effects:=app_private.sync_stock_v2(doc); END IF;',
    'IF manage THEN effects:=app_private.sync_stock_v2(doc); END IF; IF doc.inventory_mode=''reserve'' THEN PERFORM public.inventory_workflow(''reserve'',doc.id,NULL,''受注確定''); END IF;');
  IF updated_definition<>definition THEN EXECUTE updated_definition; END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_private.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','employee')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE app_private.user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.user_roles FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); role_value text;
BEGIN
  IF actor IS NULL THEN RETURN NULL; END IF;
  SELECT role INTO role_value FROM app_private.user_roles WHERE user_id=actor;
  IF role_value IS NOT NULL THEN RETURN role_value; END IF;
  IF public.is_admin() THEN RETURN 'admin'; END IF;
  RETURN 'employee';
END $$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid,p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()<>'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
  IF p_user_id IS NULL OR p_role NOT IN ('admin','employee') THEN RAISE EXCEPTION 'ユーザーと権限を確認してください'; END IF;
  IF p_user_id=auth.uid() AND p_role<>'admin' THEN RAISE EXCEPTION '自分の管理者権限はここから変更できません'; END IF;
  INSERT INTO app_private.user_roles(user_id,role,updated_by) VALUES(auth.uid(),'admin',auth.uid()) ON CONFLICT(user_id) DO NOTHING;
  IF p_role='employee' AND NOT EXISTS(SELECT 1 FROM app_private.user_roles WHERE role='admin' AND user_id<>p_user_id) THEN
    RAISE EXCEPTION '最後の管理者は普通社員に変更できません。先に別の管理者を指定してください';
  END IF;
  INSERT INTO app_private.user_roles(user_id,role,updated_by) VALUES(p_user_id,p_role,auth.uid())
  ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,updated_at=now(),updated_by=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_app_users()
RETURNS TABLE(user_id uuid,email text,role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()<>'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
  RETURN QUERY SELECT u.id,u.email,coalesce(r.role,CASE WHEN u.id=auth.uid() AND public.is_admin() THEN 'admin' ELSE 'employee' END)
    FROM auth.users u LEFT JOIN app_private.user_roles r ON r.user_id=u.id ORDER BY u.email;
END $$;
REVOKE ALL ON FUNCTION public.list_app_users() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_app_users() TO authenticated;

CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  lot_code text NOT NULL, received_on date NOT NULL DEFAULT current_date, expires_on date,
  on_hand_kg numeric NOT NULL DEFAULT 0 CHECK(on_hand_kg>=0), reserved_kg numeric NOT NULL DEFAULT 0 CHECK(reserved_kg>=0 AND reserved_kg<=on_hand_kg),
  on_hand_cases bigint NOT NULL DEFAULT 0 CHECK(on_hand_cases>=0), reserved_cases bigint NOT NULL DEFAULT 0 CHECK(reserved_cases>=0 AND reserved_cases<=on_hand_cases),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(product_id,location_id,lot_code)
);
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES public.inventory_lots(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity_kg numeric NOT NULL CHECK(quantity_kg>=0), case_count bigint NOT NULL CHECK(case_count>=0 AND (quantity_kg>0 OR case_count>0)),
  status text NOT NULL CHECK(status IN ('reserved','shipped','released')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES auth.users(id),
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES public.inventory_lots(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity_kg numeric NOT NULL, case_count bigint NOT NULL, event text NOT NULL CHECK(event IN ('opening_balance','receipt','reserve','release','shipment')),
  actor_id uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), note text
);
CREATE OR REPLACE FUNCTION app_private.guard_legacy_stock_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock AND EXISTS(SELECT 1 FROM public.inventory_lots WHERE product_id=OLD.id)
    AND coalesce(current_setting('app.allow_lot_stock_sync',true),'off')<>'on' THEN
    RAISE EXCEPTION 'ロット管理中の在庫は商品画面から直接調整できません';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_legacy_stock_write ON public.products;
CREATE TRIGGER guard_legacy_stock_write BEFORE UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_legacy_stock_write();
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_read_authenticated ON public.inventory_locations;
CREATE POLICY inventory_read_authenticated ON public.inventory_locations FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS inventory_lot_read_authenticated ON public.inventory_lots;
CREATE POLICY inventory_lot_read_authenticated ON public.inventory_lots FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS inventory_reservation_read_authenticated ON public.inventory_reservations;
CREATE POLICY inventory_reservation_read_authenticated ON public.inventory_reservations FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS inventory_movement_read_authenticated ON public.inventory_movements;
CREATE POLICY inventory_movement_read_authenticated ON public.inventory_movements FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.inventory_locations,public.inventory_lots,public.inventory_reservations,public.inventory_movements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_locations,public.inventory_lots,public.inventory_reservations,public.inventory_movements TO authenticated;
INSERT INTO public.inventory_locations(name) VALUES ('主倉庫') ON CONFLICT(name) DO NOTHING;

-- Keep ordinary staff scoped to their own documents; administrator access comes
-- from the existing server check or the new server-owned role table.
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_read_docs ON public.documents;
DROP POLICY IF EXISTS auth_update_docs ON public.documents;
DROP POLICY IF EXISTS documents_read_own_or_admin ON public.documents;
CREATE POLICY documents_read_own_or_admin ON public.documents FOR SELECT TO authenticated
  USING(created_by=auth.uid() OR public.current_user_role()='admin');
-- All document writes must pass through the transactional workflow RPCs.
REVOKE INSERT,UPDATE,DELETE ON public.documents FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS auth_write_company ON public.company_settings;
DROP POLICY IF EXISTS company_insert ON public.company_settings;
DROP POLICY IF EXISTS company_update ON public.company_settings;
DROP POLICY IF EXISTS company_delete ON public.company_settings;
DROP POLICY IF EXISTS company_settings_read_authenticated ON public.company_settings;
DROP POLICY IF EXISTS company_settings_admin_write ON public.company_settings;
CREATE POLICY company_settings_read_authenticated ON public.company_settings FOR SELECT TO authenticated USING(true);
CREATE POLICY company_settings_admin_write ON public.company_settings FOR ALL TO authenticated
  USING(public.current_user_role()='admin') WITH CHECK(public.current_user_role()='admin');
DROP POLICY IF EXISTS auth_read_document_audit ON public.document_audit_log;
CREATE POLICY document_audit_owner_or_admin ON public.document_audit_log FOR SELECT TO authenticated
  USING(public.current_user_role()='admin' OR EXISTS(SELECT 1 FROM public.documents d WHERE d.id=document_id AND d.created_by=auth.uid()));
DROP POLICY IF EXISTS auth_stock_logs ON public.stock_logs;
CREATE POLICY stock_logs_read_authenticated ON public.stock_logs FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.stock_logs FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_inventory_location(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()<>'admin' THEN RAISE EXCEPTION '管理者権限が必要です'; END IF;
  IF nullif(btrim(p_name),'') IS NULL THEN RAISE EXCEPTION '倉庫名を入力してください'; END IF;
  INSERT INTO public.inventory_locations(name) VALUES(btrim(p_name)) RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_inventory_location(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_location(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_inventory_lot(p_product_id uuid,p_location_id uuid,p_lot_code text,p_received_on date,p_expires_on date,p_kg numeric,p_cases bigint,p_event text DEFAULT 'opening_balance',p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid; current_stock numeric; lot_stock numeric; product_unit text;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()<>'admin' THEN RAISE EXCEPTION '初期在庫・ロット登録は管理者のみ実行できます'; END IF;
  IF p_product_id IS NULL OR p_location_id IS NULL OR nullif(btrim(p_lot_code),'') IS NULL OR p_kg IS NULL OR p_kg::text IN ('NaN','Infinity','-Infinity') OR p_kg<=0 OR p_cases IS NULL OR p_cases<0 OR p_event IS NULL OR p_event NOT IN ('opening_balance','receipt') THEN RAISE EXCEPTION 'ロット、kg実重量、箱数を確認してください'; END IF;
  IF p_expires_on IS NOT NULL AND p_received_on IS NOT NULL AND p_expires_on<p_received_on THEN RAISE EXCEPTION '賞味期限が入庫日より前です'; END IF;
  SELECT stock,unit INTO current_stock,product_unit FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND OR product_unit<>'kg' THEN RAISE EXCEPTION 'kg単位の商品を選択してください'; END IF;
  IF p_event='opening_balance' THEN
    SELECT coalesce(sum(on_hand_kg),0) INTO lot_stock FROM public.inventory_lots WHERE product_id=p_product_id;
    IF lot_stock+p_kg>coalesce(current_stock,0)+0.000001 THEN RAISE EXCEPTION '期首ロット合計が現在のkg在庫を超えています'; END IF;
  END IF;
  INSERT INTO public.inventory_lots(product_id,location_id,lot_code,received_on,expires_on,on_hand_kg,on_hand_cases)
    VALUES(p_product_id,p_location_id,btrim(p_lot_code),coalesce(p_received_on,current_date),p_expires_on,p_kg,p_cases) RETURNING id INTO result;
  IF p_event='receipt' THEN
    PERFORM set_config('app.allow_lot_stock_sync','on',true);
    UPDATE public.products SET stock=coalesce(stock,0)+p_kg WHERE id=p_product_id;
  END IF;
  INSERT INTO public.inventory_movements(product_id,lot_id,location_id,quantity_kg,case_count,event,actor_id,note)
    VALUES(p_product_id,result,p_location_id,p_kg,p_cases,p_event,auth.uid(),p_note);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_inventory_lot(uuid,uuid,text,date,date,numeric,bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_lot(uuid,uuid,text,date,date,numeric,bigint,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.inventory_workflow(p_action text,p_document_id uuid,p_location_id uuid DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); doc public.documents%ROWTYPE; loc uuid; it jsonb; prod uuid; kg numeric; cases bigint; lot public.inventory_lots%ROWTYPE;
  res public.inventory_reservations%ROWTYPE; output jsonb:='[]'::jsonb; remaining_kg numeric; remaining_cases bigint; take_kg numeric; take_cases bigint; product_stock numeric; lot_stock numeric;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('reserve','ship','release') THEN RAISE EXCEPTION '未対応の在庫処理です'; END IF;
  SELECT * INTO doc FROM public.documents WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND OR NOT (doc.created_by=actor OR public.current_user_role()='admin') THEN RAISE EXCEPTION '書類が見つからないか、操作権限がありません'; END IF;
  IF doc.doc_type<>'納品書' OR doc.voided_at IS NOT NULL THEN RAISE EXCEPTION '有効な納品書のみ在庫予約できます'; END IF;
  IF doc.inventory_mode<>'reserve' THEN RAISE EXCEPTION 'この納品書は予約出庫方式で登録されていません'; END IF;
  IF p_action='reserve' THEN
    SELECT id INTO loc FROM public.inventory_locations WHERE active AND (p_location_id IS NULL OR id=p_location_id) ORDER BY name LIMIT 1;
    IF loc IS NULL THEN RAISE EXCEPTION '有効な倉庫がありません'; END IF;
    IF EXISTS(SELECT 1 FROM public.inventory_reservations WHERE document_id=doc.id AND status IN ('reserved','shipped')) THEN RAISE EXCEPTION 'この書類はすでに予約または出庫済みです'; END IF;
    FOR it IN SELECT value FROM jsonb_array_elements(doc.items) LOOP
      prod:=nullif(it->>'productId','')::uuid; kg:=nullif(it->>'qty','')::numeric; cases:=coalesce(nullif(it->>'caseCount','')::bigint,0);
      IF prod IS NULL OR kg IS NULL OR kg<=0 OR cases<0 OR nullif(it->>'unit','') IS DISTINCT FROM 'kg' THEN RAISE EXCEPTION '商品、kg実重量、箱数を確認してください'; END IF;
      SELECT stock INTO product_stock FROM public.products WHERE id=prod FOR UPDATE;
      SELECT coalesce(sum(on_hand_kg),0) INTO lot_stock FROM public.inventory_lots WHERE product_id=prod;
      IF abs(coalesce(product_stock,0)-lot_stock)>0.000001 THEN RAISE EXCEPTION '商品在庫とロット在庫が一致しません。期首ロット登録を完了してください'; END IF;
      remaining_kg:=kg; remaining_cases:=cases;
      FOR lot IN SELECT * FROM public.inventory_lots WHERE product_id=prod AND location_id=loc
        AND (expires_on IS NULL OR expires_on>=current_date) ORDER BY expires_on NULLS LAST,received_on,id FOR UPDATE LOOP
        take_kg:=least(remaining_kg,lot.on_hand_kg-lot.reserved_kg);
        take_cases:=least(remaining_cases,lot.on_hand_cases-lot.reserved_cases);
        IF take_kg>0 OR take_cases>0 THEN
          UPDATE public.inventory_lots SET reserved_kg=reserved_kg+take_kg,reserved_cases=reserved_cases+take_cases WHERE id=lot.id;
          INSERT INTO public.inventory_reservations(document_id,product_id,lot_id,location_id,quantity_kg,case_count,status,created_by)
            VALUES(doc.id,prod,lot.id,loc,take_kg,take_cases,'reserved',actor);
          INSERT INTO public.inventory_movements(document_id,product_id,lot_id,location_id,quantity_kg,case_count,event,actor_id,note)
            VALUES(doc.id,prod,lot.id,loc,take_kg,take_cases,'reserve',actor,p_note);
          remaining_kg:=remaining_kg-take_kg; remaining_cases:=remaining_cases-take_cases;
          output:=output||jsonb_build_array(jsonb_build_object('productId',prod,'lotId',lot.id,'kg',take_kg,'cases',take_cases));
        END IF;
        EXIT WHEN remaining_kg<=0.000001 AND remaining_cases=0;
      END LOOP;
      IF remaining_kg>0.000001 OR remaining_cases>0 THEN RAISE EXCEPTION '倉庫またはロット在庫が不足しています。商品: %',it->>'name'; END IF;
    END LOOP;
  ELSE
    PERFORM 1 FROM public.inventory_reservations WHERE document_id=doc.id AND status='reserved' ORDER BY product_id,location_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '有効な予約がありません'; END IF;
    FOR res IN SELECT * FROM public.inventory_reservations WHERE document_id=doc.id AND status='reserved' ORDER BY product_id,location_id LOOP
      IF p_action='ship' THEN
        PERFORM set_config('app.allow_lot_stock_sync','on',true);
        UPDATE public.products SET stock=coalesce(stock,0)-res.quantity_kg WHERE id=res.product_id AND coalesce(stock,0)>=res.quantity_kg;
        IF NOT FOUND THEN RAISE EXCEPTION '商品在庫が一致しません。出庫を停止して残高を確認してください'; END IF;
        UPDATE public.inventory_lots SET on_hand_kg=on_hand_kg-res.quantity_kg,reserved_kg=reserved_kg-res.quantity_kg,
          on_hand_cases=on_hand_cases-res.case_count,reserved_cases=reserved_cases-res.case_count
          WHERE id=res.lot_id;
        UPDATE public.inventory_reservations SET status='shipped',completed_at=now() WHERE id=res.id;
      ELSE
        UPDATE public.inventory_lots SET reserved_kg=reserved_kg-res.quantity_kg,reserved_cases=reserved_cases-res.case_count
          WHERE id=res.lot_id;
        UPDATE public.inventory_reservations SET status='released',completed_at=now() WHERE id=res.id;
      END IF;
      INSERT INTO public.inventory_movements(document_id,product_id,lot_id,location_id,quantity_kg,case_count,event,actor_id,note)
        VALUES(doc.id,res.product_id,res.lot_id,res.location_id,res.quantity_kg,res.case_count,CASE WHEN p_action='ship' THEN 'shipment' ELSE 'release' END,actor,p_note);
      output:=output||jsonb_build_array(jsonb_build_object('productId',res.product_id,'kg',res.quantity_kg,'cases',res.case_count));
    END LOOP;
  END IF;
  RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.inventory_workflow(text,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inventory_workflow(text,uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.guard_direct_ship_with_lots()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.inventory_mode='ship' AND NEW.stock_managed IS TRUE AND EXISTS(
    SELECT 1 FROM jsonb_array_elements(coalesce(NEW.items,'[]'::jsonb)) it
    JOIN public.inventory_lots lot ON lot.product_id=nullif(it->>'productId','')::uuid
  ) THEN RAISE EXCEPTION 'ロット管理中の商品は予約出庫フローを使用してください'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_direct_ship_with_lots ON public.documents;
CREATE TRIGGER guard_direct_ship_with_lots BEFORE UPDATE OF inventory_mode ON public.documents
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_direct_ship_with_lots();

CREATE OR REPLACE FUNCTION app_private.release_cancelled_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE res public.inventory_reservations%ROWTYPE;
BEGIN
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN
    FOR res IN SELECT * FROM public.inventory_reservations WHERE document_id=NEW.id AND status='reserved' ORDER BY product_id,lot_id FOR UPDATE LOOP
      UPDATE public.inventory_lots SET reserved_kg=reserved_kg-res.quantity_kg,reserved_cases=reserved_cases-res.case_count WHERE id=res.lot_id;
      UPDATE public.inventory_reservations SET status='released',completed_at=now() WHERE id=res.id;
      INSERT INTO public.inventory_movements(document_id,product_id,lot_id,location_id,quantity_kg,case_count,event,actor_id,note)
        VALUES(NEW.id,res.product_id,res.lot_id,res.location_id,res.quantity_kg,res.case_count,'release',auth.uid(),'納品書取消に伴う予約解放');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS release_inventory_on_document_void ON public.documents;
CREATE TRIGGER release_inventory_on_document_void AFTER UPDATE OF voided_at ON public.documents
  FOR EACH ROW EXECUTE FUNCTION app_private.release_cancelled_inventory();

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), import_key text NOT NULL UNIQUE, payment_date date NOT NULL,
  payer text NOT NULL, amount numeric NOT NULL CHECK(amount>0), reference text NOT NULL DEFAULT '',
  imported_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK(amount>0), request_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.payment_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  event text NOT NULL CHECK(event IN ('import','allocate')), actor_id uuid NOT NULL REFERENCES auth.users(id),
  details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_read_authenticated ON public.payments;
CREATE POLICY payments_read_authenticated ON public.payments FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS payment_allocations_read_authenticated ON public.payment_allocations;
CREATE POLICY payment_allocations_read_authenticated ON public.payment_allocations FOR SELECT TO authenticated USING(true);
DROP POLICY IF EXISTS payment_audit_read_authenticated ON public.payment_audit;
CREATE POLICY payment_audit_read_authenticated ON public.payment_audit FOR SELECT TO authenticated USING(true);
REVOKE INSERT,UPDATE,DELETE ON public.payments,public.payment_allocations,public.payment_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payments,public.payment_allocations,public.payment_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.import_payments(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); row_value jsonb; n integer:=0; payment_id uuid; key_value text; amt numeric;
BEGIN
  IF actor IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>5000 THEN RAISE EXCEPTION '入金データを確認してください'; END IF;
  FOR row_value IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    amt:=(row_value->>'amount')::numeric;
    IF nullif(row_value->>'date','') IS NULL OR nullif(btrim(row_value->>'payer'),'') IS NULL OR amt IS NULL OR amt::text IN ('NaN','Infinity','-Infinity') OR amt<=0 THEN RAISE EXCEPTION '日付、振込人、金額を確認してください'; END IF;
    key_value:=coalesce(row_value->>'importKey',''); IF key_value='' THEN RAISE EXCEPTION '取込キーがありません'; END IF;
    INSERT INTO public.payments(import_key,payment_date,payer,amount,reference,imported_by)
      VALUES(key_value,(row_value->>'date')::date,btrim(row_value->>'payer'),amt,coalesce(row_value->>'reference',''),actor)
      ON CONFLICT(import_key) DO NOTHING RETURNING id INTO payment_id;
    IF payment_id IS NOT NULL THEN
      INSERT INTO public.payment_audit(payment_id,event,actor_id,details) VALUES(payment_id,'import',actor,row_value-'importKey');
      n:=n+1; payment_id:=NULL;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.import_payments(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_payments(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.allocate_payment(p_payment_id uuid,p_document_id uuid,p_amount numeric,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); payment_row public.payments%ROWTYPE; invoice_row public.documents%ROWTYPE; allocated numeric; invoice_paid numeric; invoice_total numeric; previous public.payment_allocations%ROWTYPE;
BEGIN
  IF actor IS NULL OR p_request_id IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 THEN RAISE EXCEPTION '入金額を確認してください'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  SELECT * INTO previous FROM public.payment_allocations WHERE request_id=p_request_id;
  IF FOUND THEN
    IF previous.payment_id<>p_payment_id OR previous.document_id<>p_document_id OR previous.amount<>p_amount THEN RAISE EXCEPTION '同じ処理IDで内容が変更されました'; END IF;
    SELECT * INTO payment_row FROM public.payments WHERE id=p_payment_id;
    SELECT * INTO invoice_row FROM public.documents WHERE id=p_document_id;
    SELECT coalesce(sum(amount),0) INTO allocated FROM public.payment_allocations WHERE payment_id=p_payment_id;
    SELECT coalesce(sum(amount),0) INTO invoice_paid FROM public.payment_allocations WHERE document_id=p_document_id;
    RETURN jsonb_build_object('paymentAllocated',allocated,'invoicePaid',invoice_paid,'unapplied',payment_row.amount-allocated);
  END IF;
  SELECT * INTO payment_row FROM public.payments WHERE id=p_payment_id FOR UPDATE;
  SELECT * INTO invoice_row FROM public.documents WHERE id=p_document_id FOR UPDATE;
  IF payment_row.id IS NULL OR invoice_row.id IS NULL OR invoice_row.doc_type<>'請求書' OR invoice_row.voided_at IS NOT NULL THEN RAISE EXCEPTION '入金または有効な請求書が見つかりません'; END IF;
  SELECT coalesce(sum(amount),0) INTO allocated FROM public.payment_allocations WHERE payment_id=payment_row.id;
  SELECT coalesce(sum(amount),0) INTO invoice_paid FROM public.payment_allocations WHERE document_id=invoice_row.id;
  invoice_total:=coalesce((invoice_row.tax_summary->>'total')::numeric,invoice_row.amount);
  IF invoice_total IS NULL OR p_amount>payment_row.amount-allocated OR p_amount>invoice_total-invoice_paid THEN RAISE EXCEPTION '入金残額または請求残額を超えています'; END IF;
  INSERT INTO public.payment_allocations(payment_id,document_id,amount,request_id,created_by) VALUES(payment_row.id,invoice_row.id,p_amount,p_request_id,actor);
  INSERT INTO public.payment_audit(payment_id,event,actor_id,details) VALUES(payment_row.id,'allocate',actor,jsonb_build_object('documentId',invoice_row.id,'amount',p_amount));
  RETURN jsonb_build_object('paymentAllocated',allocated+p_amount,'invoicePaid',invoice_paid+p_amount,'unapplied',payment_row.amount-allocated-p_amount);
END $$;
REVOKE ALL ON FUNCTION public.allocate_payment(uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.allocate_payment(uuid,uuid,numeric,uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.historical_tax_repairs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id), old_items jsonb NOT NULL, new_items jsonb NOT NULL,
  old_tax_summary jsonb, new_tax_summary jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.historical_tax_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_tax_repairs FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.repair_legacy_document_tax(p_document_id uuid,p_expected_updated_at timestamptz,p_rates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); doc public.documents%ROWTYPE; old_items jsonb; old_summary jsonb; new_items jsonb:='[]'::jsonb; item_value jsonb; rate_value integer; idx integer:=0; summary jsonb;
BEGIN
  IF actor IS NULL OR public.current_user_role()<>'admin' THEN RAISE EXCEPTION '税率修正は管理者のみ実行できます'; END IF;
  SELECT * INTO doc FROM public.documents WHERE id=p_document_id FOR UPDATE;
  IF NOT FOUND OR doc.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION '書類が更新されています。最新の明細を再確認してください'; END IF;
  IF doc.doc_no='DEL-9102950006' THEN RAISE EXCEPTION 'この書類は今回の履歴修正対象外です'; END IF;
  IF jsonb_typeof(p_rates)<>'array' OR jsonb_array_length(p_rates)<>jsonb_array_length(doc.items) THEN RAISE EXCEPTION '明細税率の数が一致しません'; END IF;
  old_items:=doc.items; old_summary:=doc.tax_summary;
  FOR item_value IN SELECT value FROM jsonb_array_elements(doc.items) LOOP
    rate_value:=(p_rates->>idx)::integer;
    IF rate_value IS NULL OR rate_value NOT IN (8,10) THEN RAISE EXCEPTION '税率は8%%または10%%にしてください'; END IF;
    new_items:=new_items||jsonb_build_array(item_value||jsonb_build_object('taxRate',rate_value)); idx:=idx+1;
  END LOOP;
  summary:=app_private.document_tax(new_items);
  UPDATE public.documents SET items=new_items,tax_summary=summary WHERE id=doc.id RETURNING * INTO doc;
  INSERT INTO public.historical_tax_repairs(document_id,actor_id,old_items,new_items,old_tax_summary,new_tax_summary)
    VALUES(doc.id,actor,old_items,new_items,old_summary,summary);
  RETURN jsonb_build_object('id',doc.id,'docNo',doc.doc_no,'updatedAt',doc.updated_at,'taxSummary',summary);
END $$;
REVOKE ALL ON FUNCTION public.repair_legacy_document_tax(uuid,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.repair_legacy_document_tax(uuid,timestamptz,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
