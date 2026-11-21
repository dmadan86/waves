# Breach runbook

Use this when personal data may have been seen, copied or changed by someone who should not have it: a leaked key, a compromised dashboard or laptop, a bad RLS policy, a lost device with a signed-in session.

## Who does what

| Role                    | Does                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Incident lead (founder) | Declares the incident, decides notification, signs off every step below, keeps the timeline. |
| Engineer on call        | Contains it: rotates keys, revokes sessions, closes the hole, preserves logs.                |
| Comms owner             | Drafts the user, regulator and store messages; sends only what the lead approves.            |

One person can hold all three roles. Write the timeline as you go (what was seen, when, what was done, by whom). Do not delete logs.

## First hour

1. Write down what is known: what data, whose, since when, still open or closed.
2. Contain. Rotate the key or close the access path (sections below). Contain first, investigate after.
3. Preserve evidence: export Supabase logs, Vercel logs and the auth audit log before they roll off.
4. Start the notification clock. The deadline runs from when Waves became aware, not from when the breach started.

## Rotate the service-role key

The service-role key bypasses RLS. Treat any suspected exposure as a full compromise.

1. Supabase dashboard, Project Settings, API Keys: create a new secret key, then revoke the old one.
2. Update every place that holds it:
   - Edge function secrets (`SUPABASE_SERVICE_ROLE_KEY`) for every function in `supabase/functions`.
   - The pg_cron vault secret `service_role_key` (see `docs/notify-fanout-scheduling.md`).
   - CI secrets in GitHub Actions and any Vercel environment variables.
3. Redeploy the edge functions so they pick it up, then confirm one cron-driven function (`notify-fanout`) still runs.

## Rotate the JWT secret

Rotating it signs out every user and invalidates the anon and service keys derived from it.

1. Read `docs/developer-api.md` (the JWT keys section) first: it explains the legacy-secret state to check before touching it.
2. Supabase dashboard, Authentication, JWT Keys: rotate the signing key (or the legacy JWT secret).
3. Reissue and redeploy: the anon key in the app build config, the service-role key (previous section), and anything that verifies tokens by hand.
4. Expect every user to sign in again. Ship the app build with the new anon key if it is baked in.

## Revoke sessions

- One user: Authentication, Users, open the user, sign out all sessions. Or in SQL as the service role: `delete from auth.sessions where user_id = '<id>'; delete from auth.refresh_tokens where user_id::text = '<id>';`
- Everyone: rotate the JWT secret (above), or delete all rows in `auth.sessions` and `auth.refresh_tokens`.
- Push tokens: remove the affected user's rows from the device and push-token tables so a stolen phone stops getting notifications.
- Company two-step: if a company is affected, turn on its two-step requirement and remove trusted devices.

## Notification duties

Decide with the incident lead whether personal data was involved and whether harm is likely. When in doubt, notify.

- **India, DPDP Act.** Once the breach provisions are in force (expected around May 2027): tell each affected user without delay, and the Data Protection Board of India within 72 hours of becoming aware, with the detailed report to follow as the Rules require.
- **India, until then (IT Act, SPDI Rules 2011).** Sensitive personal data such as financial information is covered. Report incidents to CERT-In within 6 hours of noticing them (the 2022 CERT-In directions), and be ready to answer the regulator.
- **EU/UK users, GDPR Art. 33 and 34.** Tell the supervisory authority within 72 hours of becoming aware unless the breach is unlikely to risk people. Tell affected people without undue delay when the risk is high.
- **Stores and processors.** If a provider (Supabase, Cloudflare, an AI provider) is the source, get their incident report and keep it with ours.

The user message says: what happened, what data, what we have done, what they should do (for example change their password and review recent activity), and how to reach us. No blame, no jargon.

## Dashboard 2FA and access-log checklist

Run this quarterly and after any incident.

- [ ] Two-factor is on for every member of the Supabase organisation, and the member list has no one who has left.
- [ ] Same for Vercel, GitHub, Cloudflare, Expo/EAS, RevenueCat, Apple App Store Connect, Google Play Console, Resend, OpenRouter and Deepgram.
- [ ] GitHub: branch protection on `main`, no stale deploy keys or personal tokens with write access.
- [ ] Supabase: review Auth logs and API logs for the incident window (unusual IPs, many failed sign-ins, service-role use from unexpected places).
- [ ] Supabase: confirm no table has RLS switched off (run the security advisor) and no function is callable by `anon` that should not be (`node scripts/check-definer-grants.mjs`).
- [ ] Cloudflare R2: review access keys and bucket access logs.
- [ ] Vercel and GitHub audit logs: new tokens, new members, changed environment variables.
- [ ] Revoke any API key or token nobody can explain.
