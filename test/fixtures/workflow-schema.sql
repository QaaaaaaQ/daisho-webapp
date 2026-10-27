-- Synthetic fixture only. No production users, customer records or secrets.
CREATE ROLE authenticated; CREATE ROLE anon;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('email','test@example.invalid');
$$;
CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,
 code text,origin text,unit text,stock numeric DEFAULT 0,created_at timestamptz DEFAULT now());
CREATE TABLE public.documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),doc_type text NOT NULL,
 doc_no text UNIQUE,date date,customer text,subject text,due_date date,bank text,note text,amount numeric,
 description text,to_addr text,to_contact text,items jsonb DEFAULT '[]',expiry_date date,conditions text,
 stock_managed boolean,created_by uuid REFERENCES auth.users(id),created_by_name text,created_by_email text,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
 voided_at timestamptz,void_reason text,converted_to_document_id uuid REFERENCES public.documents(id),converted_at timestamptz);
CREATE TABLE public.stock_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid REFERENCES public.products(id),
 change numeric NOT NULL,reason text,doc_id uuid,created_by uuid REFERENCES auth.users(id),created_at timestamptz DEFAULT now());
CREATE TABLE public.document_sequences (doc_type text PRIMARY KEY,next_number bigint DEFAULT 1);
CREATE TABLE public.document_audit_log (id bigint GENERATED ALWAYS AS IDENTITY,document_id uuid,event_type text,
 old_document jsonb,new_document jsonb,actor_id uuid);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false; $$;
CREATE FUNCTION public.next_document_no(p_doc_type text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
 INSERT INTO public.document_sequences(doc_type,next_number)VALUES(p_doc_type,1)ON CONFLICT DO NOTHING;
 UPDATE public.document_sequences SET next_number=next_number+1 WHERE doc_type=p_doc_type RETURNING next_number-1 INTO n;
 RETURN p_doc_type||'-'||lpad(n::text,6,'0');
END $$;
CREATE FUNCTION public.create_document(p_doc jsonb) RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE doc public.documents;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login required'; END IF;
 INSERT INTO public.documents(doc_type,doc_no,date,customer,subject,due_date,bank,note,amount,description,to_addr,to_contact,
  items,expiry_date,conditions,stock_managed,created_by,created_by_name,created_by_email)
 VALUES(p_doc->>'docType',public.next_document_no(p_doc->>'docType'),nullif(p_doc->>'date','')::date,p_doc->>'customer',
 p_doc->>'subject',nullif(p_doc->>'dueDate','')::date,p_doc->>'bank',p_doc->>'note',nullif(p_doc->>'amount','')::numeric,
 p_doc->>'description',p_doc->>'toAddr',p_doc->>'toContact',p_doc->'items',nullif(p_doc->>'expiryDate','')::date,p_doc->>'conditions',
 coalesce((p_doc->>'stockManaged')::boolean,true),auth.uid(),'test','test@example.invalid') RETURNING * INTO doc;
 RETURN doc;
END $$;
CREATE FUNCTION public.test_updated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER test_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.test_updated();
CREATE FUNCTION public.test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.document_audit_log(document_id,event_type,old_document,new_document,actor_id)
 VALUES(NEW.id,TG_OP,to_jsonb(OLD),to_jsonb(NEW),auth.uid()); RETURN NEW;
END $$;
CREATE TRIGGER test_audit AFTER INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.test_audit();
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_logs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
