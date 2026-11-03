-- Staff may edit master attributes; stock is changed only through inventory workflows.
DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin','employee'))
  WITH CHECK ((SELECT public.current_user_role()) IN ('admin','employee'));

DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_delete ON public.products FOR DELETE TO authenticated
  USING ((SELECT public.current_user_role()) = 'admin' AND stock = 0);

REVOKE UPDATE ON public.products FROM authenticated;
GRANT UPDATE (code,name,origin,unit,price,purchase_price,category,tax_rate,case_qty,qty_per_case,note)
  ON public.products TO authenticated;
