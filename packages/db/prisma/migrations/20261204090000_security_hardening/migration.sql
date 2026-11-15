-- Security hardening. Every function is patched from its LIVE definition (pg_get_functiondef) so nothing else drifts;
-- each patch asserts it matched, so a changed definition fails the migration loudly instead of silently skipping.

-- 1. Company rates are server-side. A client-supplied rateMinor is honoured only for an admin or the member's manager.
CREATE FUNCTION public.waves_company_rate_trusted(p_member uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT EXISTS (SELECT 1 FROM public.group_members m WHERE m.id = p_member
  AND (public.is_group_admin(m.group_id) OR public.waves_company_team(m.group_id, m.id)));
$$;
REVOKE ALL ON FUNCTION public.waves_company_rate_trusted(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_company_rate_trusted(uuid) TO service_role;

DO $$ DECLARE f regprocedure; d text; o text; BEGIN
 f := 'public.waves_company_entry_values(text,uuid,jsonb)'::regprocedure;
 o := pg_get_functiondef(f);
 d := replace(o, 'v_rate := (p_data->>''rateMinor'')::bigint;',
  'v_rate := CASE WHEN public.waves_company_rate_trusted(p_member) THEN (p_data->>''rateMinor'')::bigint
   ELSE nullif(current_setting(''waves.existing_rate'',true),'''')::bigint END;');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 EXECUTE d;

 f := 'public.waves_company_entry_values_v3(text,uuid,jsonb)'::regprocedure;
 o := pg_get_functiondef(f);
 d := replace(o, 'rate:=(p_data->>''rateMinor'')::bigint;',
  'rate:=coalesce(CASE WHEN public.waves_company_rate_trusted(p_member) THEN (p_data->>''rateMinor'')::bigint END,
   nullif(current_setting(''waves.existing_rate'',true),'''')::bigint,
   (SELECT coalesce(m.mileage_rate_minor,g.company_default_mileage_rate_minor) FROM public.group_members m JOIN public.groups g ON g.id=m.group_id WHERE m.id=p_member));');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 EXECUTE d;

 -- An update keeps the row's existing rate for a caller who may not set one (a note/date fix must not re-price it).
 f := 'public.waves_company_entry_update(uuid,jsonb)'::regprocedure;
 o := pg_get_functiondef(f);
 d := replace(o, ' d := public.waves_company_entry_values_v3(r.entry_kind,r.member_id,',
  E' PERFORM set_config(''waves.existing_rate'', coalesce(r.rate_minor::text,''''), true);\n d := public.waves_company_entry_values_v3(r.entry_kind,r.member_id,');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 o := d;
 d := replace(o, ' UPDATE public.company_entries SET amount=(d->>''amount'')::bigint,', E' PERFORM set_config(''waves.existing_rate'','''', true);\n UPDATE public.company_entries SET amount=(d->>''amount'')::bigint,');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 EXECUTE d;
END $$;

-- 2. Guests (anonymous users) cannot look people up: rotating guest accounts bypassed the per-caller daily cap.
-- 3. Promo redemption: refuse guests and cap attempts at 10 a day per profile. The cap is returned, not raised, so the
--    counted attempt is not rolled back with the transaction.
-- 4. A company's reusable join link is for its admins only.
DO $$ DECLARE f regprocedure; d text; o text; BEGIN
 f := 'public.waves_find_person(text,text)'::regprocedure;
 o := pg_get_functiondef(f);
 d := replace(o, 'IF v_channel NOT IN (', E'IF public.waves_is_guest(v_me) THEN\n    RAISE EXCEPTION ''NOT_ALLOWED: create an account to look somebody up'' USING ERRCODE = ''insufficient_privilege'';\n  END IF;\n\n  IF v_channel NOT IN (');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 EXECUTE d;

 f := 'public.waves_redeem_promo(text)'::regprocedure;
 o := pg_get_functiondef(f);
 d := replace(o, 'SELECT * INTO v_code', E'IF public.waves_is_guest(v_profile) THEN\n    RAISE EXCEPTION ''NOT_ALLOWED'' USING ERRCODE = ''insufficient_privilege'';\n  END IF;\n  IF (public.waves_rate_limit(v_profile::text, ''promo_redeem'', 10, 86400)->>''allowed'')::boolean IS NOT TRUE THEN\n    RETURN jsonb_build_object(''ok'', false, ''reason'', ''RATE_LIMITED'');\n  END IF;\n\n  SELECT * INTO v_code');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 EXECUTE d;

 f := 'public.waves_ensure_group_join_token(uuid)'::regprocedure;
 o := pg_get_functiondef(f);
 d := replace(o, 'SELECT join_token INTO v_token', E'IF public.waves_is_company(p_group_id) AND NOT public.is_group_admin(p_group_id) THEN\n    RAISE EXCEPTION ''NOT_ALLOWED: only an admin can share the company link'' USING ERRCODE = ''insufficient_privilege'';\n  END IF;\n\n  SELECT join_token INTO v_token');
 IF d = o THEN RAISE EXCEPTION 'could not patch %', f; END IF;
 EXECUTE d;
END $$;
