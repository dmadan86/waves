-- Auto-pin a trip rate only if nobody has pinned one.
--
-- A foreign bill saved with a freshly fetched rate pins that rate for the trip
-- (first one wins). The pin is queued, so an offline or lagging admin can replay
-- it long after another admin pinned a deliberate rate; waves_set_group_fx_rate
-- would overwrite that. This variant writes only when the currency has no entry,
-- and reports whether it did. Manual pins keep using waves_set_group_fx_rate and
-- its overwrite behaviour.

CREATE OR REPLACE FUNCTION public.waves_pin_group_fx_rate_if_absent(
  p_group_id uuid,
  p_from     character,
  p_num      bigint,
  p_den      bigint,
  p_source   text DEFAULT 'ecb'
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_default char(3);
  v_from    char(3);
  v_hit     uuid;
BEGIN
  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin sets a trip rate'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_from := upper(p_from);

  SELECT default_currency INTO v_default FROM public.groups WHERE id = p_group_id;
  IF v_default IS NULL THEN
    RAISE EXCEPTION 'NO_SUCH_GROUP' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_from = v_default THEN
    RAISE EXCEPTION 'SAME_CURRENCY: a trip rate converts a foreign currency into %, not itself', v_default
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_num IS NULL OR p_den IS NULL OR p_num <= 0 OR p_den <= 0 THEN
    RAISE EXCEPTION 'INVALID_RATE: a rate is a ratio of two positive integers'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The row lock plus the NOT (fx_rates ? key) test in one statement is what
  -- makes "only if absent" atomic against a concurrent pin.
  UPDATE public.groups SET
    fx_rates = jsonb_set(
      COALESCE(fx_rates, '{}'::jsonb),
      ARRAY[v_from],
      jsonb_build_object(
        'num', p_num::text,
        'den', p_den::text,
        'ts', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'source', COALESCE(NULLIF(btrim(p_source), ''), 'ecb')
      ),
      true
    ),
    updated_at = now()
  WHERE id = p_group_id
    AND NOT (COALESCE(fx_rates, '{}'::jsonb) ? v_from::text)
  RETURNING id INTO v_hit;

  RETURN v_hit IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_pin_group_fx_rate_if_absent(uuid, character, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_pin_group_fx_rate_if_absent(uuid, character, bigint, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_pin_group_fx_rate_if_absent(uuid, character, bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_pin_group_fx_rate_if_absent(uuid, character, bigint, bigint, text) TO service_role;
