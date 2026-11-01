-- Manual receipts replace bank CSV ingestion. Existing payment rows are retained.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS pca_bank_account_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pca_bank_subaccount_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pca_receivable_account_code text NOT NULL DEFAULT '';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pca_subaccount_code text NOT NULL DEFAULT '';

ALTER TABLE public.payment_audit DROP CONSTRAINT IF EXISTS payment_audit_event_check;
ALTER TABLE public.payment_audit ADD CONSTRAINT payment_audit_event_check
  CHECK (event IN ('import','manual','allocate'));

CREATE OR REPLACE FUNCTION public.create_manual_payment(
  p_payment_date date, p_payer text, p_amount numeric, p_reference text, p_request_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); key_value text; result uuid; prior public.payments%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_request_id IS NULL OR p_payment_date IS NULL OR nullif(btrim(p_payer),'') IS NULL
    OR length(btrim(p_payer)) > 200 OR length(coalesce(p_reference,'')) > 500
    OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount <= 0 OR p_amount <> trunc(p_amount) OR p_amount > 999999999999 THEN
    RAISE EXCEPTION '入金日、振込人、1円以上の整数金額を確認してください';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text,0));
  key_value := 'manual:' || actor::text || ':' || p_request_id::text;
  SELECT * INTO prior FROM public.payments WHERE import_key=key_value;
  IF FOUND THEN
    IF prior.payment_date<>p_payment_date OR prior.payer<>btrim(p_payer)
      OR prior.amount<>p_amount OR prior.reference<>coalesce(btrim(p_reference),'') THEN
      RAISE EXCEPTION '同じ処理IDで内容が変更されました';
    END IF;
    RETURN prior.id;
  END IF;
  INSERT INTO public.payments(import_key,payment_date,payer,amount,reference,imported_by)
    VALUES(key_value,p_payment_date,btrim(p_payer),p_amount,coalesce(btrim(p_reference),''),actor)
    RETURNING id INTO result;
  INSERT INTO public.payment_audit(payment_id,event,actor_id,details)
    VALUES(result,'manual',actor,jsonb_build_object('date',p_payment_date,'amount',p_amount,'reference',coalesce(btrim(p_reference),'')));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_manual_payment(date,text,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_manual_payment(date,text,numeric,text,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
