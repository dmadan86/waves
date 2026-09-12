# Moving the server: the endpoint today, and what leaving Supabase would cost

Two questions, answered separately because they have very different answers.

1. **Today** — can the server address change without a new build in the stores?
2. **Tomorrow** — what would it actually take to run Waves on DigitalOcean, GCP,
   AWS or a box of our own, and what is worth doing now so that stays cheap?

This builds on [`MIGRATION.md`](../MIGRATION.md) and
[`infra/self-host/README.md`](../infra/self-host/README.md) (PR #425) and on the
mobile `Backend` port in
[`apps/mobile/src/lib/backend/index.ts`](../apps/mobile/src/lib/backend/index.ts)
(PR #426). Where those already settle something, this says so and moves on.
Where they are now out of date, it says that too.

A word on vocabulary, because conflating these inflates the problem by an order
of magnitude. **Postgres, RLS, `SECURITY DEFINER` functions and Deno are not
Supabase.** They run anywhere and they are most of this system. **GoTrue,
PostgREST, Supabase Storage, Supabase Realtime and the Edge runtime are open
source products** — they are portable too, just as _software you now have to
host_. What is genuinely Supabase-the-company is a short list: the hosted
`*.supabase.co` hostname, the dashboard, `pg_net` availability, Vault, the
Auth-hook wiring, and the project-scoped OAuth callback URL.

---

## 1. The direct answer

**Mobile: yes, an over-the-air update can change the endpoint. It is a
JavaScript-only change and needs no store release.** But three things about
that answer matter more than the "yes".

**Why it is OTA-able.** `apps/mobile/src/lib/supabase.ts:8-9` reads
`process.env.EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY`. Metro replaces those
expressions with string literals when it bundles — they are compiled constants,
not runtime lookups, and there is no `.env` on the phone. But the artefact they
are compiled into is the JS bundle, and the JS bundle is _exactly_ what
`expo-updates` replaces. `@supabase/supabase-js` is pure JavaScript with no
native module, so pointing it at a different host implies no manifest change, no
new permission and no rebuild of the binary. Ship an update built with a
different value and every phone that fetches it talks to the new host.

The update channel also survives the move: `apps/mobile/app.json` sets
`updates.url` to `https://u.expo.dev/d6e19674-…`, which is Expo's service and
has nothing to do with Supabase. Moving the API does not move the thing that
delivers the fix. That independence is the single most valuable property we
already have.

**Caveat one — the value is currently in a place `eas update` does not read.**
`apps/mobile/eas.json` puts `EXPO_PUBLIC_SUPABASE_URL` and `..._ANON_KEY` in
`build.base.env`. That block is consumed by `eas build`
(`evaluateConfigWithEnvVarsAsync` merges EAS server variables with the build
profile's `env`). `eas update` does not use build profiles; it resolves
server-side EAS _environment variables_ for whatever `--environment` is passed,
plus local `.env` files. There is no `apps/mobile/.env` in this checkout. So
running `eas update` today, on a machine without those variables exported, would
bundle `undefined` for both — `supabaseConfigured` in `lib/supabase.ts:23` goes
false, and `RootLayout` (`apps/mobile/src/app/_layout.tsx:199`) paints the
"Waves is missing the keys it needs" screen for everybody who takes the update.
**Before any of this is relied on, the two values must also exist as EAS
environment variables for the `production` environment, and an update must be
published and verified on a real device.**

**Caveat two — no OTA has ever shipped.** `docs/play-release.md:70` records that
updates were blocked for a long time by an EAS project-slug mismatch, and
nothing in this repository shows a successful publish since. The mechanism is
sound; it is unproven here. A first OTA is not the moment to also move the
server.

**Caveat three — and this is the real one.** Changing the endpoint is easy.
_Surviving_ the change is not, because of what happens to sessions. See §4.

**Web (`apps/web`): rebuild and redeploy — minutes, no store involved.**
`apps/web/src/lib/waves.ts:7-8` reads `NEXT_PUBLIC_SUPABASE_URL` /
`..._ANON_KEY`, which Next.js inlines into the client bundle at build time, and
throws at module load if either is missing. Changing them means a new deployment
— which for a web app is the normal way to ship anything. There is no
`@supabase/ssr`, no middleware and no runtime-config indirection anywhere in the
repo; env reaches the build through `vercel pull` in
`.github/workflows/vercel-deploy.yml:100` and is frozen at `vercel build`
(`:119`). Note that `apps/web` also mounts `@waves/agent-mcp` at `/api/mcp`, so
the web deployment's `NEXT_PUBLIC_*` are that server's Supabase config too.

**Admin (`apps/admin`): env var and a redeploy.**
`apps/admin/src/lib/data.ts:28-29` reads `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` at _runtime_, in server-only code (the file starts
with `import 'server-only'`). No bundle inlining, no browser exposure.

**Developer API (`apps/api`): already designed for this.**
`apps/api/src/server/env.ts` has no domain name anywhere and no fallbacks; every
address is an environment variable. This is the shape the rest of the system
should copy.

**Agent MCP (`apps/agent-mcp`): runtime env.**
`apps/agent-mcp/src/supabase.ts:28-29` reads `WAVES_SUPABASE_URL` (falling back
to `EXPO_PUBLIC_SUPABASE_URL`).

**Is a forced store release ever genuinely required?** Yes, for a specific
class: anything that changes the _native_ side of the app. Concretely — the
Sign in with Apple / Google iOS URL scheme derived from a client id
(`apps/mobile/app.config.ts:83-101`), the Firebase `google-services.json` baked
in for push, the App Links host `app.wavs.co.in` in `app.json`'s
`intentFilters`, the `waves://` scheme, and the EAS `updates.url` itself. None
of those is the API endpoint. **Moving the API endpoint is not in that class.**
Moving the _auth provider_, however, often drags OAuth client ids with it, and
those are in that class.

---

## 2. The inventory

Effort is engineering time for one person who knows this codebase, including
tests and a verified cutover — not calendar time and not a best case.

| #   | Dependency                                          | Where                                                                                                                                                                                                                                                                                                                                                                  | How locked in                                                                                                                                                                                                                                                                                                                                                                             | What replaces it                                                                                                                                                    | Effort                                                      |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | **Postgres schema, RLS, RPCs, triggers**            | `packages/db/prisma/migrations/*` — 89 `CREATE POLICY` (63 on `public`, 19 on `storage.objects`), RLS on 69 tables, ~200 `SECURITY DEFINER` declarations (~155 distinct functions)                                                                                                                                                                                     | **Not locked in.** Plain SQL. The baseline (`20260904000000_waves_baseline:23-37`) creates `anon`/`authenticated`/`service_role` if absent, so a vanilla Postgres takes it. Only `pgcrypto` is genuinely required, at 4 sites (`extensions.digest(…,'sha256')`, baseline:2999/4473/4484 and `20260908160000_developer_api:913`).                                                          | Any Postgres 17.                                                                                                                                                    | Already done                                                |
| 2   | **Caller identity in SQL**                          | `waves_current_profile_id()`, baseline:2398                                                                                                                                                                                                                                                                                                                            | **Not locked in** — and this is better than it looks. It reads `request.jwt.claim.sub`, a PostgREST GUC, _not_ `auth.uid()`. `auth.uid()` appears only 5 times, all in Storage policies.                                                                                                                                                                                                  | Any gateway that sets the same GUC.                                                                                                                                 | Already done                                                |
| 3   | **Money/split logic**                               | `@waves/core`                                                                                                                                                                                                                                                                                                                                                          | Not locked in. Pure TypeScript, no backend.                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                                                   | Already done                                                |
| 4   | **PostgREST reads**                                 | 127 `.from()` sites over 30 tables across `apps/mobile/src/data/api.ts`, `packages/api-client/src/client.ts`                                                                                                                                                                                                                                                           | **Product choice, not vendor lock.** PostgREST is Apache-2 and self-hostable; the escape hatch already runs it. Locked to _PostgREST_ (embed strings, `.select()` shapes), not to Supabase.                                                                                                                                                                                               | Self-hosted PostgREST (zero code change) **or** a hand-written read API behind a `DataPort` (large).                                                                | 0 / 4–8 weeks                                               |
| 5   | **`SECURITY DEFINER` RPC boundary (ADR-013)**       | 77 distinct RPC names called from apps                                                                                                                                                                                                                                                                                                                                 | Not locked in. These are Postgres functions; anything that can call a function can call them.                                                                                                                                                                                                                                                                                             | Same functions, any transport.                                                                                                                                      | Already done                                                |
| 6   | **GoTrue auth — session, refresh, OAuth, OTP**      | `apps/mobile/src/lib/backend/index.ts:36-59` names the exact 15 calls used; `apps/mobile/src/lib/auth.tsx`                                                                                                                                                                                                                                                             | **Deepest lock-in.** See §3.                                                                                                                                                                                                                                                                                                                                                              | Self-hosted GoTrue = no code change. A different product = rewrite + forced re-login for every user.                                                                | 0 / 6–10 weeks                                              |
| 7   | **Anonymous guests + in-place upgrade (ADR-006)**   | `signInAnonymously`, `linkIdentity`, `session.user.is_anonymous` (`auth.tsx:33`), `waves_promote_guest` writing `auth.users.is_anonymous` directly (`20260912150000_…:176`)                                                                                                                                                                                            | **The hardest single item.** There is no `UPDATE auth.users` equivalent outside GoTrue, and no drop-in anonymous-session product.                                                                                                                                                                                                                                                         | Keep GoTrue, or build the guest account model ourselves.                                                                                                            | 3–5 weeks alone                                             |
| 8   | **`auth.admin.*`**                                  | `supabase/functions/account-delete/index.ts:86` (`deleteUser`); `supabase/functions/phone-verify/handler.ts:173,180` (`getUserById`, `updateUserById`)                                                                                                                                                                                                                 | GoTrue Admin API.                                                                                                                                                                                                                                                                                                                                                                         | Equivalent admin API of whatever replaces GoTrue.                                                                                                                   | Days, once #6 is decided                                    |
| 9   | **Phone sign-in via the OTP relay**                 | `supabase/functions/phone-verify/` (531 LOC), `otp-send/` (460 LOC), migrations `20260912120000_otp_relay`, `…150000_phone_assertion_and_guest_upgrade`                                                                                                                                                                                                                | **Deepest GoTrue coupling in the codebase.** Firebase proves the number; `phone-verify` drives GoTrue's own OTP over direct HTTP to `${SUPABASE_URL}/auth/v1` (`handler.ts:343`) and parks the code through the `send_sms` _auth hook_; the app adopts the result with `setSession`.                                                                                                      | A different auth server needs this whole dance re-invented against its API.                                                                                         | 2–3 weeks                                                   |
| 10  | **The `send_sms` auth hook**                        | `supabase/config.toml` `[auth.hook.send_sms]`, `uri` hardcodes the project ref                                                                                                                                                                                                                                                                                         | Supabase-specific wiring (the auth server calls _us_). The function itself is portable Deno.                                                                                                                                                                                                                                                                                              | Self-hosted GoTrue supports the same hook. Another product: its own webhook shape.                                                                                  | Hours / 1 week                                              |
| 11  | **Edge functions (17, Deno)**                       | `supabase/functions/*`                                                                                                                                                                                                                                                                                                                                                 | **Code is portable, the host is a choice.** Supabase-specific surface is concentrated in `_shared/auth.ts` (`asCaller`/`asService`, `SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`) and the platform's `verify_jwt` gate. Three functions opt out: `email-events`, `email-unsubscribe`, `otp-send`.                                                                                         | Deno Deploy / Fly / a container: near-zero change. Node or Lambda: rewrite `Deno.serve`, `Deno.env`, `npm:` specifiers.                                             | 1 week / 2–3 weeks                                          |
| 12  | **`pg_net`**                                        | `20260904140000_pg_net`; `waves_notify_fanout_trigger` (`20260904180000_fanout_trigger_url`); the 5-minute fan-out cron                                                                                                                                                                                                                                                | The documented hard dependency — **but smaller than MIGRATION.md implies.** The trigger already swallows every failure and the cron is the real delivery path; the URL and key already come from Vault, not from schema.                                                                                                                                                                  | An external worker polling `notifications` and POSTing `notify-fanout` — which already authenticates on a plain service-key bearer (`notify-fanout/handler.ts:90`). | 1–2 days                                                    |
| 13  | **`pg_cron` (6 jobs)**                              | `waves-notify-fanout`, `waves-auto-archive`, `waves-auto-confirm`, `waves-storage-expire-pending`, `waves-sweep-rate-limits`, `waves-trip-nudges` — **only one is migration-tracked** (`20260907090000_device_alert_and_weekly_digest:394`); the rest are live SQL (`docs/notify-fanout-scheduling.md:17-28`)                                                          | Not vendor lock; `pg_cron` runs on RDS and Cloud SQL too. The lock-in is **operational**: the jobs are not in the repo, so a rebuilt database silently has none of them.                                                                                                                                                                                                                  | Provider scheduler, systemd timer, or a Cloudflare Cron Trigger hitting each function.                                                                              | Hours — **plus writing them down**, which we owe regardless |
| 14  | **Vault**                                           | `vault.decrypted_secrets` for `service_role_key` and `functions_base_url` (baseline:4644, `…180000_fanout_trigger_url:36-38`)                                                                                                                                                                                                                                          | Supabase extension. Only two secrets, both read only by the fan-out trigger.                                                                                                                                                                                                                                                                                                              | A `pgsodium`/`pgcrypto` table, or drop it with #12 (an external worker reads its own env).                                                                          | Hours                                                       |
| 15  | **Supabase Storage**                                | 4 buckets created in the baseline, ~55 lines of `storage.objects` policy; `lib/storage/index.ts:245`, `_shared/r2.ts:115`, `r2-sign/handler.ts:515`                                                                                                                                                                                                                    | **MIGRATION.md is out of date here.** R2 is built but _off_: `EXPO_PUBLIC_R2_ENABLED` is not set in `eas.json`, and `r2Enabled()` (`lib/storage/index.ts:53`) is therefore false in every shipped build. **All image bytes today are in Supabase Storage.**                                                                                                                               | Turn R2 on (config + 4 secrets, `docs/r2-storage.md`), then `rclone` the pre-cutover objects. The seam is already there.                                            | 1 day to switch on; 2–3 days to backfill                    |
| 16  | **Supabase Realtime**                               | `apps/mobile/src/data/hooks.ts:1252` (group) and `:2509` (receipt), `postgres_changes`                                                                                                                                                                                                                                                                                 | Two call sites. Self-hostable; also _droppable_ — the sync engine already polls every 30s, so losing it degrades latency, not correctness. **But**: there is no `CREATE PUBLICATION supabase_realtime` in any migration — only 4 `REPLICA IDENTITY FULL` statements. Publication membership is not tracked, so a rebuilt database has Realtime only by the platform's default or by hand. | Self-host, or delete and accept polling. Track the publication either way.                                                                                          | Hours to 2 days                                             |
| 17  | **The anon key format**                             | `eas.json` ships `sb_publishable_…` (new-style); `infra/self-host/README.md` expects a legacy JWT anon key signed with `JWT_SECRET`                                                                                                                                                                                                                                    | A real mismatch nobody has hit yet: the escape hatch has not been tested against the key format production actually uses.                                                                                                                                                                                                                                                                 | Self-host GoTrue accepts legacy JWT keys; the apps must then carry a legacy key.                                                                                    | Half a day to reconcile                                     |
| 18  | **The legacy HS256 JWT secret**                     | `apps/api/src/server/session.ts` hand-signs `authenticated` JWTs with `WAVES_API_JWT_SECRET`                                                                                                                                                                                                                                                                           | The developer API **cannot work at all** on a project that has moved to asymmetric signing keys and revoked the legacy secret — the private half never leaves Supabase. `apps/api/.env.example` says so plainly.                                                                                                                                                                          | On a self-host we own `GOTRUE_JWT_SECRET`, so this gets _easier_. On Supabase it is a countdown.                                                                    | — (a reason to move, not a cost of moving)                  |
| 19  | **Project-scoped OAuth callback**                   | `supabase/config.toml` `[auth.external.google]`; the redirect URI registered at Google is `https://<project-ref>.supabase.co/auth/v1/callback`                                                                                                                                                                                                                         | **Console work, not code.** Already bit us once — the Singapore→Mumbai project move broke sign-in everywhere (`config.toml`, the Google block's comment).                                                                                                                                                                                                                                 | Register the new callback at Google and Apple before cutover.                                                                                                       | Hours — but it is a _release-blocking_ hour                 |
| 20  | **Supabase CLI / dashboard**                        | `pnpm edge:deploy`, `supabase config push`, `supabase db query --linked`; `supabase/config.toml` is live settings                                                                                                                                                                                                                                                      | Operational. `config push` _overwrites_ dashboard settings with this file's defaults — it once turned off anonymous sign-ins. Two migrations exist purely to repair Supabase's default grants (`20260904160000_anon_surface_on_hosted`, `20260904200000_authenticated_surface_on_hosted`) and are meaningless off Supabase — harmless, but they are Supabase-shaped scar tissue.          | Off Supabase, this is docker-compose plus `prisma migrate deploy`.                                                                                                  | —                                                           |
| 21  | **Management API**                                  | Only `e2e/guest-ceilings.mjs:123` (`api.supabase.com/v1/projects/…/database/query`). No production code.                                                                                                                                                                                                                                                               | Test-only.                                                                                                                                                                                                                                                                                                                                                                                | Point the test at the DB directly.                                                                                                                                  | Hours                                                       |
| 22  | **Admin console's own auth**                        | `apps/admin/src/lib/session.ts`                                                                                                                                                                                                                                                                                                                                        | **Not Supabase at all** — one password, an HMAC-signed cookie, Web Crypto, plus a Cloudflare Access header gate (`apps/admin/src/proxy.ts`). Deliberate: the console must work when the thing it watches is broken.                                                                                                                                                                       | Nothing to port.                                                                                                                                                    | Already done                                                |
| 23  | **The mobile `Backend` port**                       | `apps/mobile/src/lib/backend/index.ts`, guarded by `apps/mobile/eslint.config.js:43-118`                                                                                                                                                                                                                                                                               | **Genuinely intact.** `no-restricted-imports` bans `@supabase/supabase-js` and `@/lib/supabase`; exactly two files are exempted (`**/lib/supabase.ts`, `**/lib/backend/index.ts`, config:114-118). The one inline `eslint-disable` of that rule in the repo (`apps/mobile/src/lib/navigation.ts:1`) is about expo-router, not Supabase. Nothing reaches around it.                        | —                                                                                                                                                                   | Already done                                                |
| 24  | **Web, admin, api, agent-mcp and e2e have no seam** | `apps/web/src/lib/waves.ts:3`, `apps/web/src/app/api/mcp/route.ts:33`, `apps/admin/src/lib/data.ts:6`, `apps/admin/src/lib/loginThrottle.ts:3`, `apps/agent-mcp/src/{supabase,login}.ts`, `apps/api/src/server/session.ts:23`, plus 12 files under `e2e/`. No guard in `apps/web/eslint.config.mjs` or `apps/admin/eslint.config.mjs`; there is no root eslint config. | The recorded "web pass still owed" — still owed. `packages/api-client` is the partial exception: it injects the client (`createWavesClient({ supabase })`) and never reads env — but the injected type _is_ `SupabaseClient`, so it is dependency injection, not a narrow port.                                                                                                           | A guard costs an afternoon; a real port is #4 + #6 again.                                                                                                           | Half a day (guard)                                          |

### What the earlier decoupling work actually bought

Real and worth having: the schema is plain SQL that a bare Postgres takes; the
identity function reads a PostgREST claim rather than `auth.uid()`; the mobile
app names its vendor in exactly two files and an eslint rule keeps it that way;
the escape-hatch stack exists; the data-move scripts exist; `apps/api` has no
domain name in it.

Not bought, contrary to the record: **storage is not on R2** (built, flagged
off, never switched on); the escape hatch has **never been booted against the
key format production uses**; the data-move script **does not carry sessions**
(§4); web and admin have **no seam**; and the six cron jobs that make half the
product work **are not in the repository at all**.

### The lesson this repo has already learned the hard way

On 2026-09-04 the migration history was squashed into one `pg_dump`-derived
baseline, taken from a plain Postgres. The dump did not carry what lives in
_other_ schemas — so the squash silently dropped the `auth.users` new-user
trigger and 19 `storage.objects` policies. The trigger loss was found only when
new accounts started appearing with no profile row (recovered in
`20260905090000_restore_new_user_profile_trigger`, whose header records it).

That is the failure mode every stage of any move must be tested against, and it
is the reason Realtime's publication (#16) and the six cron jobs (#13) are
flagged here: **the things that are not in `public` are the things that vanish
without an error.** Row counts after a restore do not detect any of them.

The same squash also carried a literal `https://xvjzbpgcmotoahtqcxve.supabase.co`
— the pre-Mumbai project — into `waves_notify_fanout_trigger` at
baseline:4648. `20260904180000_fanout_trigger_url` replaced it with the Vault
lookup, so a full replay ends up correct; but the stale hostname is still in the
tree, and the trigger's `EXCEPTION WHEN OTHERS THEN NULL` means a wrong value
there produces no symptom except latency. Worth knowing before anyone replays a
partial history.

---

## 3. How deep is auth, exactly

Deep enough that it decides the whole shape of any move.

The app uses fifteen GoTrue calls, and they are enumerated — the one genuinely
good piece of prior work here — as a type in
`apps/mobile/src/lib/backend/index.ts:36-59`: `getSession`,
`onAuthStateChange`, `signInAnonymously`, `signInWithOtp`, `verifyOtp`,
`signInWithPassword`, `signUp`, `updateUser`, `signInWithOAuth`,
`linkIdentity`, `signInWithIdToken`, `exchangeCodeForSession`, `setSession`,
`refreshSession`, `signOut`, `resend`.

Most of that list is ordinary and has an equivalent everywhere. Four things do
not:

- **`signInAnonymously` + `linkIdentity`.** ADR-006 is the product: somebody
  opens an invite link, splits a week of a trip, and _then_ decides to have an
  account — keeping everything. Cognito, Clerk and Keycloak have no equivalent
  in-place upgrade. Reproducing it means owning the account model. Note it is
  already asymmetric even inside GoTrue: `signInWithIdToken` has no link form,
  so a guest upgrading via Google or Apple must take the browser path
  (`apps/mobile/src/lib/auth.tsx:588-591, 613-615`).
- **`signOut({ scope: 'others' })`** (`apps/mobile/src/lib/deviceSession.tsx:140`)
  — the remote sign-out behind the device cap. A GoTrue capability with no
  generic equivalent.
- **`auth.users.is_anonymous` written directly from SQL.**
  `waves_promote_guest` (`20260912150000_phone_assertion_and_guest_upgrade:176`)
  does `UPDATE auth.users SET is_anonymous = false`. That is us reaching inside
  another system's table. On self-hosted GoTrue it still works; on anything else
  there is nothing to write to.
- **The phone-verify / otp-send relay.** 991 lines of edge function whose entire
  job is to make GoTrue mint a session for a number Firebase vouched for,
  including a direct HTTP call to `${SUPABASE_URL}/auth/v1` with
  `create_user:false` and a `setSession` handoff. It is coupled to GoTrue's
  wire protocol, not just its SDK.
- **`signInWithIdToken` for native Google/Apple**, with the Apple audience
  ordering in `config.toml` that is load-bearing and silent when wrong.

**So:** self-hosting GoTrue costs _nothing in code_. Replacing GoTrue costs
6–10 weeks and signs every existing user out once, irreversibly. Those are not
close, and the second should not be attempted without a reason that is about
more than independence.

Three mitigations are already in place and are worth knowing before anyone
budgets this as a rewrite:

- **The schema degrades gracefully.** Every function that touches `auth.users`
  is guarded on `to_regclass('auth.users') IS NOT NULL` and on the
  `is_anonymous` column existing (e.g. baseline:2332-2347, and all in plpgsql so
  a missing column is never planned) — CI runs these migrations against a stub
  `auth` schema. A world without GoTrue would not fail to migrate; it would
  return `false` from the guest checks.
- **The decision logic is already vendor-neutral.**
  `packages/core/src/auth/identity.ts:104-134` — `planAuth(viewer, method,
intent)` — is what chooses between `linkIdentity`, `updateUser`,
  `signInWithOAuth`, `signInWithOtp`, `signUp` and `signInWithPassword`. It is
  pure TypeScript in `@waves/core` and is shared by mobile and
  `packages/api-client`. A second adapter inherits the rules for free.
- **Nothing in this repository verifies a Supabase JWT by hand.** No `jose`, no
  `jsonwebtoken`. Every server-side identity check delegates to
  `auth.getUser()` — the most-called auth primitive in the codebase, present in
  every edge function, in `apps/api/src/server/session.ts:123-135` and in
  `apps/web/src/app/api/mcp/route.ts:101`. There is one exception in the other
  direction: `apps/api` _mints_ HS256 tokens by hand (`session.ts:41-75`, item
  #18), and `apps/api/src/server/signing.ts:169-180` already probes whether the
  project still accepts them. The code knows this is on a clock.

---

## 4. The recommended endpoint design

### The shape

Three tiers, most-specific wins:

1. **Compiled fallback** — `EXPO_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` exactly
   as today. Always present, always the last resort, never removed.
2. **Persisted override** — a `{url, anonKey}` pair in device storage, read at
   boot _before_ the client is constructed. This is what an OTA-free change
   writes, and what a support flow ("open this link to repair the app") could
   write.
3. **Discovery** — a small signed JSON document fetched at launch, with a short
   timeout, that can update tier 2.

The endpoint and the key travel together and are versioned together. A pointer
that gives a URL without its key is useless.

### Where the pointer lives, and the bootstrap problem stated honestly

Whatever tells the app where the server is **cannot live behind the server being
moved**. That rules out the obvious candidate: the update gate already in the
app (`apps/mobile/src/lib/update.tsx`) reads `app_releases` through
`fetchReleasePolicy` (`apps/mobile/src/data/api.ts:1771-1779`) — i.e. through
PostgREST, on the host we are trying to leave. Remote config that lives in
`app_config` has the same problem. **Endpoint discovery must not be built into
that machinery; it must sit underneath it.** (The update-gate and
maintenance-notice work on `feat/app-state-messaging` had not landed on `main`
when this was written — `main` already carries the `app_releases` gate. Whatever
that branch adds should read its config _from_ the resolved endpoint, and depend
on this, not the other way round.)

The pointer should be a static file on **a domain we control and can re-point at
any CDN**: we already own `wavs.co.in`, with `app.`, `api.`, `admin.` and
`help.` in use and `app.wavs.co.in` already an Android App Links host. Something
like `https://cfg.wavs.co.in/endpoint.json`, served from static hosting with no
database behind it — Cloudflare Pages, R2 behind a Worker, S3+CloudFront, it
does not matter and should be trivially moveable.

That leaves one irreducible root of trust: **DNS**. Nothing removes it. What
_must_ be done about it: **sign the document**. Ed25519, public key compiled into
the app, signature checked before the value is used, and the app refuses an
unsigned or badly-signed document and keeps its previous endpoint. Without that,
anyone who can take the domain or the CDN can point every installed copy of
Waves at a server of theirs and harvest live sessions — which is a considerably
worse failure than needing a store release. **An unsigned pointer is not
acceptable; do not ship one.**

Two further rules, both cheap and both load-bearing:

- **Never accept an endpoint change while there is unsent work in the queue**
  (or: flush first, and if the flush cannot complete, defer the switch). Moving
  the host under a queue full of writes is the scenario in §4.3.
- **Keep a "last known good"** and revert to it if the new endpoint fails
  authentication or `/health` on first contact. A bad pointer must be
  self-healing, because the thing that would fix it is delivered over the
  channel the pointer just broke.

### Where it hooks into the code

`apps/mobile/src/app/_layout.tsx:199` already gates the whole tree on
`backendConfigured` before mounting `AuthProvider` and `SyncProvider`. That is
the natural place: resolve the endpoint there, render the existing
misconfiguration screen if nothing resolves, and only then mount.

The blocker is that `apps/mobile/src/lib/supabase.ts` constructs the client at
module load, synchronously, which cannot await storage. Two honest options:

- Late-bind `backend` (`lib/backend/index.ts:77`) through a mutable holder set
  once during boot. Every call site already goes through the port, so no screen
  changes — but `getSession`, the `AppState` auto-refresh listener and the
  `Session` type all need care, and a call before resolution must be impossible
  rather than merely unlikely.
- Keep the client synchronous and read the override from a _synchronous_ store.
  Simpler and more robust; costs a new storage dependency on native.

Either way, roughly **3–5 days** including the signed-document verifier, the
revert-on-failure path, and tests. This is the single cheapest piece of
insurance in this document.

### What happens to a queued expense during a cutover

This is the question most likely to be got wrong, and the codebase currently
gets it wrong in a way that loses data.

**The good part.** The offline queue is careful. Mutations carry a
`clientMutationId` and the server is idempotent, so a re-sent write is harmless.
`packages/core/src/sync/queue.ts` states three rules, and rule 2 is "nothing is
ever silently dropped" — a mutation leaves the queue only on a confirmed apply
or a confirmed duplicate. A transport failure (which is what a moved host looks
like) lands in the `catch` at `apps/mobile/src/sync/engine.ts:519` and calls
`markFailed`: attempt count up, exponential backoff to a 5-minute cap. Nothing
is lost. After 8 attempts (`MAX_ATTEMPTS`) it is dead-lettered — still in the
queue, still on screen, now needing a person to retry. So a _silent_ outage of
any length costs latency and one tap, not an expense.

**The part that loses data.** The local wipe is driven by the session going
null, not by a person choosing to sign out.
`apps/mobile/src/sync/provider.tsx:127-143`: when `signedIn` goes false,
`clearLocalPrivateData` runs, which calls `syncEngine.clear()` →
`SqliteStore.reset()` (`apps/mobile/src/sync/driver.ts:499-525`), which deletes
`mirror_rows`, **`pending_mutations`**, `sync_cursors` and `drafts` in one
transaction and then crypto-erases the key. For an intentional sign-out on a
shared phone that is exactly right and should not change.

But `session` also goes null when `onAuthStateChange` reports `SIGNED_OUT`
(`apps/mobile/src/lib/auth.tsx:385-394`), and supabase-js emits that when a
token refresh is **definitively rejected** by the auth server — not on a network
error, but on a real answer saying "I do not know this refresh token".

**A moved auth server is precisely the machine that gives that answer.**
`infra/self-host/scripts/dump-from-supabase.sh` dumps `auth.users` and
`auth.identities` — and nothing else. Not `auth.sessions`, not
`auth.refresh_tokens`. So a cutover performed exactly as `MIGRATION.md` §5
describes hands every installed app a refresh token the new GoTrue has never
seen, which rejects it, which signs everyone out, **which deletes every unsent
expense on every phone.** Not delayed — deleted.

Three fixes, in order of importance:

1. **Decouple the wipe from an involuntary sign-out.** Wipe on an explicit
   `signOut()` action and on an account switch; on an involuntary `SIGNED_OUT`,
   stop syncing and ask the person to sign in again, keeping the mirror and the
   queue. A re-sign-in as the same user should resume; a different user still
   wipes. **This is worth doing whether or not we ever move** — a revoked token
   or a remote sign-out has the same effect today. Roughly 2–3 days, and it
   needs care around the privacy promise the current behaviour is keeping.
2. **Carry sessions in the dump.** Add `auth.sessions`, `auth.refresh_tokens`,
   `auth.mfa_factors` and `auth.flow_state` to `dump-from-supabase.sh`, and keep
   the same `GOTRUE_JWT_SECRET` on the target so access tokens issued before the
   flip remain valid for their remaining hour. Caveat: these tables are
   version-coupled to GoTrue, so the target must run a compatible version, and
   this must be rehearsed. Hours to write, a day to verify.
3. **Announce a write freeze and flush first.** `MIGRATION.md` §7 already asks
   for this. Add: the client should not accept a new endpoint while
   `pendingCount > 0`.

And the honest residue: **if the destination is a different auth product (Path
C), sessions cannot be carried at all.** Everyone signs in again. That makes fix
(1) not optional but load-bearing — it is the difference between "sign in again"
and "sign in again, and your unsent expenses are gone".

### Old builds still pointing at the old endpoint

Anyone who never takes the OTA keeps talking to the old host. Plan for it:

- **Keep the old endpoint answering** — proxying to the new one if possible,
  otherwise read-only — for at least one release cycle. `MIGRATION.md` §7 says
  "keep the Supabase project paused, not deleted"; paused is not answering.
  Prefer a redirect or a thin proxy over a pause.
- The update gate (`app_releases`) **cannot help here**, because it is served by
  the host being left. If old builds must be forced forward, the minimum-version
  row has to be set on the **old** host before the flip, not after.

---

## 5. What to do now, and what to leave alone

### Do now (cheap, and each one is useful even if we never move)

| Action                                                                                                   | Why                                                                                                                                                   | Effort     |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Put the Supabase URL + anon key into **EAS environment variables** for `production`, not only `eas.json` | Otherwise the OTA path that answers question 1 ships a misconfigured build                                                                            | 1 hour     |
| **Publish one OTA and verify it on a device**                                                            | The mechanism is unproven here since the rebrand                                                                                                      | Half a day |
| **Stop wiping the mirror and queue on an involuntary sign-out** (§4.3 fix 1)                             | Today a revoked token destroys unsent expenses. Nothing to do with Supabase                                                                           | 2–3 days   |
| **Add `auth.sessions` / `auth.refresh_tokens` to the dump script**                                       | Makes a cutover survivable rather than a mass sign-out                                                                                                | 1 day      |
| **Write the six cron jobs down** — a checked-in `infra/cron/` script or migration-with-guard             | A rebuilt database silently loses trip nudges, auto-confirm, auto-archive, rate-limit sweeps and the fan-out fallback. This has already happened once | 1 day      |
| **Ship the endpoint resolver** (three tiers, signed pointer, revert on failure)                          | The actual answer to question 1, and it buys a same-day response to an outage                                                                         | 3–5 days   |
| **Stand up `infra/self-host` once and smoke-test it against the production key format**                  | It is insurance that has never been fired. Item #17 is a real unknown                                                                                 | 2 days     |
| **Add the `no-restricted-imports` guard to `apps/web` and `apps/admin`**                                 | Stops the seam rotting in the two apps that never had one                                                                                             | Half a day |
| **Register a second OAuth callback** at Google and Apple for the intended future host, ahead of time     | Item #19 is the thing that breaks sign-in on cutover day, and consoles are slow                                                                       | 2 hours    |
| **Track the Realtime publication in a migration**                                                        | Same silent-loss class as the auth trigger the squash dropped                                                                                         | 2 hours    |
| **Make the 12 `e2e/*.mjs` scripts refuse to run without `SUPABASE_URL`**                                 | They currently default to the production project ref — a test run with no env silently targets prod                                                   | 2 hours    |
| **Add `phone-verify` to the `edge:deploy` list** in the root `package.json`                              | It has two live mobile call sites and is not in the 16-function deploy command                                                                        | 5 minutes  |

Total: roughly **two to three weeks**, and most of it is work we owe anyway.

### Defer, deliberately

- **The `DataPort`** that hides PostgREST. 127 call sites, and PostgREST is
  self-hostable, so this buys nothing until we have actually decided to replace
  it. Building it speculatively is weeks spent on an interface designed against
  no real second implementation — which is how port abstractions come out wrong.
- **An `AuthPort` deeper than the existing `BackendAuth` type.** That type
  already does the useful half: it names exactly which 15 calls exist. A fuller
  abstraction should be written _against a specific replacement_, not in the
  abstract.
- **Any move off GoTrue.** §3.
- **Rewriting edge functions for Node.** They are Deno; keep them Deno and host
  them somewhere that runs Deno.
- **Backfilling storage off Supabase.** Turn R2 on first (it is already built);
  the dual-read means nothing needs moving on a deadline.

---

## 6. A staged migration, in dependency order

Each stage leaves a working app. Stop after any of them.

**Stage 0 — insurance (2–3 weeks).** Everything in "do now". Nothing moves;
after this we _could_ move in a weekend, and several current bugs are fixed.

**Stage 1 — turn R2 on (1 week).** `docs/r2-storage.md` steps 1–4, then let new
uploads land on R2 while old ones dual-read. Removes the largest byte-volume
dependency and is independently useful (cost, and the storage cap becomes real).

**Stage 2 — take the database (1–2 weeks).** Move Postgres to the target
provider (managed or our own). Keep GoTrue, PostgREST, Storage and the Edge
runtime running against it — self-hosted or still Supabase's, depending on the
target. Replace `pg_net` with the external fan-out worker, and `pg_cron` with
the provider's scheduler, if the target lacks them. Data via
`infra/self-host/scripts`, UUIDs and sessions preserved. **App code unchanged.**

One thing to fix on the way: no CI workflow runs `prisma migrate deploy` — the
production schema is applied by hand from a laptop (`pnpm db:migrate`). That is
survivable on Supabase and dangerous on a fresh target, where "did the whole
history apply?" is the question the squash lesson above says nobody can answer
by looking.

**Stage 3 — take the gateway (1–2 weeks).** Self-host GoTrue + PostgREST +
Storage + Realtime behind Kong, exactly as `infra/self-host/docker-compose.yml`
already describes, on the target's compute. Flip the endpoint via the resolver
from Stage 0. Register the new OAuth callbacks first. **App code unchanged.**

At the end of Stage 3 Waves runs on DigitalOcean, GCP or AWS with no Supabase
account, and the app on people's phones never noticed. **This is the realistic
destination**, and it is roughly six weeks of work from here.

**Stage 4 — only with a reason (2–3 months).** Shed GoTrue and/or PostgREST for
native cloud primitives. Auth first or last, never in the middle, and it costs
every user a re-login plus the guest model rebuilt from scratch (§3). Do not
start this without a concrete reason that Stage 3 does not satisfy.

---

## 7. What cannot be made portable

Say it plainly, because a plan that pretends otherwise is a plan that fails on
cutover day.

- **DNS is the root of trust and always will be.** Every scheme for changing the
  endpoint without a store release bottoms out in "the app trusts a name". Code
  signing on the pointer bounds the damage; it does not remove the dependency.
- **OAuth provider consoles.** Google's and Apple's redirect URIs, the Apple
  Services ID and the audience ordering, the Firebase project behind phone auth
  — these live in other companies' dashboards and no amount of abstraction moves
  them. They must be changed by hand, ahead of the flip, or sign-in breaks for
  everyone at once. This has already happened here once.
- **Sessions across an auth-product change.** Refresh tokens are opaque state
  belonging to the issuer. Self-hosting the same GoTrue can carry them; a
  different product cannot. A move to Cognito/Clerk/Keycloak means every user
  signs in again, on the same day, with no way to stagger it.
- **The guest account model (ADR-006).** Anonymous-session-plus-in-place-upgrade
  is a GoTrue feature we have built a product on. It is reproducible, not
  portable.
- **Native-side configuration.** The URL scheme, the App Links host, the Firebase
  config file, the EAS project id. Changing any of them is a store release, full
  stop.
- **The store release itself.** Apple and Google decide when a binary ships. OTA
  moves JavaScript; it never moves that.

---

## 8. Open questions

1. **Is there a real timeline for moving, or is this insurance?** The
   recommendation differs completely. Insurance = Stage 0 and stop (~3 weeks).
   A date = Stages 0–3 (~6 weeks) planned around it.
2. **What is driving it — cost, control, data residency, a customer/regulatory
   requirement, or the legacy-JWT-secret countdown that would kill the developer
   API (#18)?** Each points at a different target.
3. **Can we use a subdomain of `wavs.co.in` for the endpoint pointer, served
   from static hosting entirely separate from the API** (`cfg.wavs.co.in`, say)?
   If the domain and its DNS are ours and stay ours across any provider change,
   the design in §4 works. If not, we need a different stable name first.
4. **Is signing in again acceptable for every user on one day?** If yes, Stage 4
   is on the table eventually. If no, GoTrue is a permanent component and we
   should stop treating it as temporary.
5. **Which provider, if any, is preferred?** DigitalOcean and a plain VM take the
   escape-hatch stack unchanged. AWS/GCP managed Postgres forces the `pg_net`
   change (#12) and their schedulers (#13), both small. Knowing the target makes
   Stage 2 concrete.
6. **Is the guest-without-an-account flow negotiable?** It is the single most
   expensive thing to reproduce off GoTrue (#7). If it is core forever — and it
   reads like it is — that settles §3 and we should say so in ADR-002 rather
   than leaving it as an open cost.
7. **Do we accept keeping the old endpoint answering for a release cycle after a
   flip**, rather than pausing the project? Old builds have no other path home.
8. **Who owns the six cron jobs?** They exist only as live SQL on one project.
   Until they are in the repo, any rebuild is silently missing half the
   product's background behaviour.
