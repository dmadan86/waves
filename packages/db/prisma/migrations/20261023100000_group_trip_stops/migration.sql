-- A trip can cross several countries: Bali, then Singapore, then Vietnam, each
-- with its own currency. The group keeps settling in one currency — the home
-- country's; `country_code` still means where the money squares up and which
-- rails are offered — and this adds the itinerary beside it.
--
-- `groups.trip_stops` is a JSON list `[{ "country", "start", "end" }]`: an
-- ISO-3166 alpha-2 code and two inclusive `YYYY-MM-DD` days. The same shape of
-- thing as `fx_rates` and `category_budgets` — group-visible, admin-set, a
-- handful of entries, always read and written whole — so it lives on the group
-- row and rides the existing group pull rather than growing a table of its own
-- (which would need its own sync cursor, RLS and mirror for at most fifteen
-- rows). NULL is "no itinerary", which is what every existing group has.
--
-- Written only through `waves_set_trip_stops`, which replaces the whole list:
-- ordering and overlap are properties of the list, not of one stop. The
-- column guard refuses a direct write because it is not in its allowlist, so
-- an ordinary member cannot route around the admin check. The client's
-- `validateStops` (@waves/core, trip/stops.ts) runs the same rules first so a
-- sheet can refuse an overlap before anything is queued; the two are kept in
-- step by name (the error codes match).
--
-- Deploy order: this migration, then the `sync` edge function (the
-- `trip_stops.set` mutation), then the app. Old clients never read or write
-- the column, so they keep working unchanged.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS trip_stops jsonb;

DO $do$
BEGIN
  ALTER TABLE public.groups
    ADD CONSTRAINT groups_trip_stops_shape
    CHECK (trip_stops IS NULL OR jsonb_typeof(trip_stops) = 'array');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$do$;

COMMENT ON COLUMN public.groups.trip_stops IS
  'The itinerary: [{country (ISO-3166 alpha-2), start, end (YYYY-MM-DD, inclusive)}], sorted by start, no overlaps, at most 15. NULL is no itinerary. Admin-set via waves_set_trip_stops; a stop''s currency comes from the country.';

-- Replace the itinerary. Admin-only, like every other group-visible-admin-set
-- field on this row. An empty list clears the column to NULL.
CREATE OR REPLACE FUNCTION public.waves_set_trip_stops(
  p_group_id uuid,
  p_stops    jsonb
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_trip_start date;
  v_trip_end   date;
  v_count      integer;
  v_entry      jsonb;
  v_country    text;
  v_start      date;
  v_end        date;
  v_prev_end   date;
  v_sorted     jsonb := '[]'::jsonb;
  v_row        record;
BEGIN
  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin sets the itinerary'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT start_date, end_date INTO v_trip_start, v_trip_end
    FROM public.groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SUCH_GROUP' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_stops IS NULL OR jsonb_typeof(p_stops) <> 'array' THEN
    RAISE EXCEPTION 'BAD_STOPS: the itinerary is a list'
      USING ERRCODE = 'check_violation';
  END IF;

  v_count := jsonb_array_length(p_stops);
  IF v_count > 15 THEN
    RAISE EXCEPTION 'TOO_MANY: an itinerary holds at most 15 stops'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Each stop on its own: the shape, the country, the two days and their order,
  -- and that it lies inside the trip when the trip has dates.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_stops) LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'BAD_STOPS: each stop is an object'
        USING ERRCODE = 'check_violation';
    END IF;

    v_country := upper(btrim(COALESCE(v_entry ->> 'country', '')));
    IF v_country !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION 'BAD_COUNTRY: a stop needs an ISO-3166 alpha-2 country'
        USING ERRCODE = 'check_violation';
    END IF;

    BEGIN
      IF COALESCE(v_entry ->> 'start', '') !~ '^\d{4}-\d{2}-\d{2}$'
         OR COALESCE(v_entry ->> 'end', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'shape';
      END IF;
      v_start := (v_entry ->> 'start')::date;
      v_end   := (v_entry ->> 'end')::date;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'BAD_DATE: a stop''s days are YYYY-MM-DD'
          USING ERRCODE = 'check_violation';
    END;

    IF v_end < v_start THEN
      RAISE EXCEPTION 'END_BEFORE_START: a stop ends on or after the day it starts'
        USING ERRCODE = 'check_violation';
    END IF;

    IF (v_trip_start IS NOT NULL AND v_start < v_trip_start)
       OR (v_trip_end IS NOT NULL AND v_end > v_trip_end) THEN
      RAISE EXCEPTION 'OUTSIDE_TRIP: every stop lies within the trip dates'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Then the list as a whole: sorted by start, and no two stops on one day.
  v_prev_end := NULL;
  FOR v_row IN
    SELECT upper(btrim(value ->> 'country')) AS country,
           (value ->> 'start')::date AS start_day,
           (value ->> 'end')::date   AS end_day
      FROM jsonb_array_elements(p_stops)
     ORDER BY (value ->> 'start')::date, (value ->> 'end')::date
  LOOP
    IF v_prev_end IS NOT NULL AND v_row.start_day <= v_prev_end THEN
      RAISE EXCEPTION 'OVERLAP: two stops cannot share a day'
        USING ERRCODE = 'check_violation';
    END IF;
    v_prev_end := v_row.end_day;
    v_sorted := v_sorted || jsonb_build_array(jsonb_build_object(
      'country', v_row.country,
      'start',   to_char(v_row.start_day, 'YYYY-MM-DD'),
      'end',     to_char(v_row.end_day, 'YYYY-MM-DD')
    ));
  END LOOP;

  UPDATE public.groups SET
    trip_stops = CASE WHEN v_count = 0 THEN NULL ELSE v_sorted END,
    updated_at = now()
  WHERE id = p_group_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_set_trip_stops(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_set_trip_stops(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_set_trip_stops(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_set_trip_stops(uuid, jsonb) TO service_role;
