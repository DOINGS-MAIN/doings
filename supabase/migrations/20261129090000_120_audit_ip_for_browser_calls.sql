-- 120: audit rows written from inside the database carry the admin's IP address.
-- Most admin actions go through the admin edge function, which passes the caller's address. A few
-- (ads, the gifting and fee settings, dance-floor settings) are SQL functions the admin's browser
-- calls directly; they write their audit row themselves and had no address to give, so those rows
-- showed none (go-live test G2/G9, retest 2026-11-28).
--
-- A trigger now fills the address in when a row arrives without one AND the request came straight
-- from a signed-in browser. Rows written by the edge function (service role) are left alone: there
-- the request headers describe the function's own server, not the admin.
--
-- It must never stop an audit row being written (a failed audit write fails the admin action), so
-- every step swallows its own errors and falls back to "no address".

CREATE OR REPLACE FUNCTION public._admin_audit_fill_ip()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_headers jsonb;
  v_raw text;
BEGIN
  IF NEW.ip_address IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    IF COALESCE(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;
  IF v_headers IS NULL THEN RETURN NEW; END IF;
  -- The edge network's own header first; x-forwarded-for is a list the caller can start themselves.
  FOREACH v_raw IN ARRAY ARRAY[
    v_headers->>'cf-connecting-ip',
    v_headers->>'x-real-ip',
    split_part(COALESCE(v_headers->>'x-forwarded-for', ''), ',', 1)
  ] LOOP
    BEGIN
      IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
        NEW.ip_address := btrim(v_raw)::inet;
        RETURN NEW;
      END IF;
    EXCEPTION WHEN others THEN
      NULL; -- not an address: try the next header
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._admin_audit_fill_ip() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_admin_audit_fill_ip ON public.admin_audit_log;
CREATE TRIGGER tr_admin_audit_fill_ip BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public._admin_audit_fill_ip();
