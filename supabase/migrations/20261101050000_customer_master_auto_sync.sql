-- Keep invoice and receipt counterparties represented in the customer master.
-- The document's saved customer text remains unchanged; new master codes are left blank.
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.customer_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_name, '')), '[[:space:]　]', '', 'g'),
      '(株式会社|有限会社|合同会社|合名会社|合資会社)', '', 'g'
    )
  );
$$;

-- Match the application's corporate-suffix and whitespace normalization while
-- preventing duplicates when concurrent documents are issued for one customer.
CREATE UNIQUE INDEX IF NOT EXISTS customers_normalized_name_uidx
  ON public.customers (app_private.customer_name_key(name))
  WHERE app_private.customer_name_key(name) <> '';

-- Backfill only names that have no normalized customer-master match. Existing
-- customer codes and document rows are never updated.
INSERT INTO public.customers (name, code)
SELECT DISTINCT ON (app_private.customer_name_key(d.customer)) pg_catalog.btrim(d.customer), NULL
FROM public.documents AS d
WHERE d.doc_type IN ('請求書', '領収書')
  AND pg_catalog.btrim(COALESCE(d.customer, '')) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.customers AS c
    WHERE app_private.customer_name_key(c.name) = app_private.customer_name_key(d.customer)
  )
ORDER BY app_private.customer_name_key(d.customer), pg_catalog.btrim(d.customer);

CREATE OR REPLACE FUNCTION app_private.ensure_document_customer_master()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.doc_type NOT IN ('請求書', '領収書')
    OR pg_catalog.btrim(COALESCE(NEW.customer, '')) = '' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です';
  END IF;

  INSERT INTO public.customers (name, code)
  VALUES (pg_catalog.btrim(NEW.customer), NULL)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.ensure_document_customer_master() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_document_customer_master ON public.documents;
CREATE TRIGGER ensure_document_customer_master
  AFTER INSERT OR UPDATE OF doc_type, customer ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION app_private.ensure_document_customer_master();

NOTIFY pgrst, 'reload schema';
