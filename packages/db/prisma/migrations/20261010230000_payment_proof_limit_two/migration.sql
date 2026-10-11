-- At most two proofs per payment, on every plan.
--
-- 20261010120000 raised the old one-proof rule to five. Two is enough to back a
-- payment (the bank confirmation and the UPI receipt) and keeps proofs from
-- becoming a photo album. Payments that already hold more keep them; they
-- simply cannot take another until they are below two.

CREATE OR REPLACE FUNCTION public.waves_attach_settlement_proof(p_settlement_id uuid, p_storage_path text, p_proof_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id uuid;
  v_member   uuid;
  v_id       uuid;
  v_max      constant integer := 2;
BEGIN
  IF coalesce(btrim(p_storage_path), '') = '' THEN
    RAISE EXCEPTION 'INVALID_PATH: a proof needs a stored image' USING ERRCODE = 'check_violation';
  END IF;

  IF p_storage_path NOT LIKE p_settlement_id::text || '/%' THEN
    RAISE EXCEPTION 'INVALID_PATH: the key must be scoped to its settlement'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT group_id INTO v_group_id FROM public.settlements WHERE id = p_settlement_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such settlement' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.waves_is_settlement_party(p_settlement_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTY: only the payer or payee may attach a proof'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_proof_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.settlement_proofs
    WHERE id = p_proof_id AND settlement_id = p_settlement_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  PERFORM public.waves_require_committed_object('settlement-proofs', btrim(p_storage_path));

  PERFORM pg_advisory_xact_lock(hashtextextended('settlement-proofs:' || p_settlement_id::text, 0));

  IF (
    SELECT count(*) FROM public.settlement_proofs
    WHERE settlement_id = p_settlement_id AND deleted_at IS NULL
  ) >= v_max THEN
    RAISE EXCEPTION 'PROOF_LIMIT: a payment can have at most % proofs; remove one first', v_max
      USING ERRCODE = 'check_violation';
  END IF;

  v_member := public.waves_my_member_id(v_group_id);

  INSERT INTO public.settlement_proofs
    (id, settlement_id, group_id, uploader_member_id, storage_path)
  VALUES
    (COALESCE(p_proof_id, gen_random_uuid()), p_settlement_id, v_group_id, v_member,
     btrim(p_storage_path))
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_attach_settlement_proof(p_settlement_id uuid, p_storage_path text, p_proof_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_attach_settlement_proof(p_settlement_id uuid, p_storage_path text, p_proof_id uuid) TO authenticated, service_role;
