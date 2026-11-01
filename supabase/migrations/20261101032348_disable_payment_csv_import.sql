-- CSV payment intake is no longer part of the product; preserve any existing rows.
REVOKE ALL ON FUNCTION public.import_payments(jsonb) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
