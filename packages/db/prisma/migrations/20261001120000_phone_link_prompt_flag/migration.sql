-- The switch for the phone-number ask on the phone (`PhoneLinkPrompt`).
--
-- A number on the account is how friends find each other (`waves_find_person`
-- reads `auth.users.phone`), so the app asks every signed-in account without one
-- to add it — see `apps/mobile/src/lib/phonePrompt.ts` for how firmly. It ships
-- on for everybody; this row is how it is turned off again without a release,
-- should the SMS bill or a carrier outage call for it. Set `enabled = false`, or
-- narrow `rollout_percent`, and the ask stops at the next flag refresh.
--
-- Two arms because `variantFor` treats a single-arm flag as no flag at all; the
-- app only asks whether this account is in the rollout, not which arm.
INSERT INTO public.feature_flags (key, description, enabled, rollout_percent, variants)
VALUES (
  'phone_link_prompt',
  'Ask signed-in accounts with no phone number to add one, so friends can find them. Off stops the ask at the next flag refresh.',
  true,
  100,
  '{control,treatment}'
)
ON CONFLICT (key) DO NOTHING;
