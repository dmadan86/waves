-- Validate optional per-member family weights. No data rewrite.
CREATE OR REPLACE FUNCTION public.waves_check_group_units(p_group_id uuid, p_units jsonb)
    RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_weight_key text;
  v_weight jsonb;
  v_key    text;
  v_unit   jsonb;
  v_name   text;
  v_member jsonb;
  v_id     uuid;
  v_seen   uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_units IS NULL THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_units) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_UNITS: families must be an object' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_units)) > 50 THEN
    RAISE EXCEPTION 'INVALID_UNITS: at most 50 families' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_key, v_unit IN SELECT key, value FROM jsonb_each(p_units) LOOP
    IF jsonb_typeof(v_unit) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_UNITS: family % must be an object', v_key
        USING ERRCODE = 'check_violation';
    END IF;
    v_name := btrim(v_unit ->> 'name');
    IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 24 THEN
      RAISE EXCEPTION 'INVALID_UNITS: a family name is 1 to 24 characters'
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(v_unit -> 'members') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_unit -> 'members') = 0 THEN
      RAISE EXCEPTION 'INVALID_UNITS: family % needs at least one member', v_name
        USING ERRCODE = 'check_violation';
    END IF;
    FOR v_member IN SELECT value FROM jsonb_array_elements(v_unit -> 'members') LOOP
      IF jsonb_typeof(v_member) <> 'string' THEN
        RAISE EXCEPTION 'INVALID_UNITS: family % has a member that is not an id', v_name
          USING ERRCODE = 'check_violation';
      END IF;
      BEGIN
        v_id := (v_member #>> '{}')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_UNITS: family % has a member that is not an id', v_name
          USING ERRCODE = 'check_violation';
      END;
      IF NOT EXISTS (
        SELECT 1 FROM public.group_members gm WHERE gm.id = v_id AND gm.group_id = p_group_id
      ) THEN
        RAISE EXCEPTION 'INVALID_UNITS: family % names someone not in this group', v_name
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_id = ANY (v_seen) THEN
        RAISE EXCEPTION 'INVALID_UNITS: % is in two families', v_id
          USING ERRCODE = 'check_violation';
      END IF;
      v_seen := v_seen || v_id;
    END LOOP;
    IF v_unit ? 'weights' THEN
      IF jsonb_typeof(v_unit -> 'weights') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'INVALID_UNITS: weights must be an object' USING ERRCODE = 'check_violation';
      END IF;
      FOR v_weight_key, v_weight IN SELECT key, value FROM jsonb_each(v_unit -> 'weights') LOOP
        IF NOT (v_unit -> 'members') @> to_jsonb(ARRAY[v_weight_key])
           OR jsonb_typeof(v_weight) <> 'number' THEN
          RAISE EXCEPTION 'INVALID_UNITS: invalid member weight' USING ERRCODE = 'check_violation';
        END IF;
        IF (v_weight #>> '{}')::numeric <= 0 OR (v_weight #>> '{}')::numeric > 10 THEN
          RAISE EXCEPTION 'INVALID_UNITS: member weight must be in (0, 10]' USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;
    END IF;
    IF jsonb_typeof(v_unit -> 'head') NOT IN ('null') THEN
      IF jsonb_typeof(v_unit -> 'head') <> 'string'
         OR NOT (v_unit -> 'members') @> to_jsonb(ARRAY[v_unit ->> 'head']) THEN
        RAISE EXCEPTION 'INVALID_UNITS: family % has a head who is not in it', v_name
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END LOOP;
END
$$;

