-- Supabase auth.users.email is varchar; the public interface returns text.
CREATE OR REPLACE FUNCTION public.list_app_users()
RETURNS TABLE(user_id uuid,email text,role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION '管理者権限が必要です';
  END IF;
  RETURN QUERY SELECT u.id, u.email::text,
    coalesce(r.role, CASE WHEN u.id=auth.uid() AND public.is_admin() THEN 'admin' ELSE 'employee' END)
    FROM auth.users u LEFT JOIN app_private.user_roles r ON r.user_id=u.id ORDER BY u.email;
END $$;
REVOKE ALL ON FUNCTION public.list_app_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_app_users() TO authenticated;
