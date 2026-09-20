-- Feedback gains topics: what the message is *about*, chosen from cards.
--
-- The screen used to offer three chips (general / bug / idea) and a box. A
-- message with no subject is a message somebody has to read in full before
-- they can even file it, and "the scanner is slow" and "the scanner is wrong"
-- arrive looking identical in the console. Topics are the subject line people
-- will actually fill in: taps, not typing.
--
-- `kind` stays exactly as it was. It is still NOT NULL, still carries
-- 'deletion' for the account-erasure path, and the app now derives it from the
-- topics rather than asking twice. Nothing that reads `kind` needs to change.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.feedback.topics IS
  'What the message is about, from a fixed card set. Empty is allowed: a topic is offered, never demanded.';

-- A closed set, checked in the database as well as filtered in the RPC. The
-- filter is what keeps a stale build from ever raising an error at somebody
-- mid-complaint; the constraint is what keeps a future writer honest.
ALTER TABLE public.feedback
  DROP CONSTRAINT IF EXISTS feedback_topics_known;

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_topics_known CHECK (
    topics <@ ARRAY[
      'splitting', 'receipts', 'voice', 'groups',
      'speed', 'design', 'bug', 'idea'
    ]::text[]
    AND cardinality(topics) <= 8
  );

-- ── the writer ──────────────────────────────────────────────────────────────
-- Dropped and recreated rather than replaced: appending a parameter would
-- leave the old five-argument function in place beside the new one, and
-- PostgREST answers an overloaded name with an ambiguity error rather than a
-- call. The two-argument positional call inside the account-delete path keeps
-- resolving, because every added parameter carries a default.

DROP FUNCTION IF EXISTS public.waves_submit_feedback(text, text, integer, text, text);

CREATE FUNCTION public.waves_submit_feedback(
  p_message text,
  p_kind text DEFAULT 'general'::text,
  p_rating integer DEFAULT NULL::integer,
  p_app_version text DEFAULT NULL::text,
  p_platform text DEFAULT NULL::text,
  p_topics text[] DEFAULT '{}'::text[]
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_id uuid;
  v_topics text[];
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  IF length(trim(COALESCE(p_message, ''))) = 0 THEN
    RAISE EXCEPTION 'EMPTY_MESSAGE';
  END IF;

  -- Whatever the client sent, reduced to known slugs, de-duplicated, ordered,
  -- and capped. A build shipped before a card was retired keeps working: its
  -- unknown slug is dropped, and the message still lands.
  SELECT COALESCE(array_agg(DISTINCT topic ORDER BY topic), '{}'::text[])
    INTO v_topics
    FROM unnest(COALESCE(p_topics, '{}'::text[])) AS topic
   WHERE topic = ANY (ARRAY[
           'splitting', 'receipts', 'voice', 'groups',
           'speed', 'design', 'bug', 'idea'
         ]::text[]);

  INSERT INTO public.feedback
    (profile_id, kind, message, rating, app_version, platform, locale, country_code, topics)
  SELECT
    v_profile,
    COALESCE(p_kind, 'general'),
    left(trim(p_message), 4000),
    p_rating,
    p_app_version,
    p_platform,
    p.locale,
    p.country_code,
    v_topics
  FROM public.profiles p
  WHERE p.id = v_profile
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_submit_feedback(text, text, integer, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_submit_feedback(text, text, integer, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_submit_feedback(text, text, integer, text, text, text[]) TO service_role;

-- ── the console's reader ────────────────────────────────────────────────────
-- A RETURNS TABLE cannot gain a column in place, so this one is dropped too.

DROP FUNCTION IF EXISTS public.waves_admin_feedback(integer);

CREATE FUNCTION public.waves_admin_feedback(p_limit integer DEFAULT 100)
  RETURNS TABLE(
    id uuid, kind text, message text, rating integer, app_version text,
    platform text, locale text, country_code text, topics text[],
    from_deleted_account boolean, created_at timestamp with time zone
  )
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    f.id, f.kind, f.message, f.rating, f.app_version, f.platform,
    f.locale, f.country_code, f.topics, f.profile_id IS NULL, f.created_at
  FROM public.feedback f
  ORDER BY f.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
$$;

REVOKE ALL ON FUNCTION public.waves_admin_feedback(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_admin_feedback(integer) TO service_role;
