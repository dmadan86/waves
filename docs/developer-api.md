# The developer API (A65) — built

Status: **built** (this PR). Verified against a local Postgres and the service's
own suite; **not deployed** — the migration and a new Vercel project are both
outstanding, and the OAuth flow has never run against a real GoTrue. The one
thing that cannot be settled from here is whether the project still accepts the
HS256 sessions this service signs; `GET /health` answers it in one call once
deployed, and §7 says what to do with each answer. See
[Deploying](#deploying) for exactly what is owed.

A public HTTP API third-party software calls on a Waves user's behalf: personal
access tokens for a developer's own account, OAuth 2.1 authorization-code with
PKCE for somebody else's, scopes per endpoint, admin-turnable rate limits, and a
versioned `/v1` surface over groups, expenses, settlements, friends and
categories. The shape is Splitwise's; the vocabulary is this repo's.

---

## 1. The one idea

**A token is an identity plus a ceiling. It is never an authority of its own.**

Resolving a token yields a profile id and a scope list. From that instant every
read and every write happens _as that person_: the API mints a ~60-second
`authenticated` JWT for them and makes the same PostgREST calls, the same
`SECURITY DEFINER` RPCs and the same edge-function calls the phone makes. Scopes
can only subtract.

Two things follow, and they are the whole security argument:

- **A token cannot reach a row its owner could not.** There are no new RLS
  policies over `groups` or `expenses` in the migration, because there was
  nothing to add. `groups_select` is still `USING (is_group_member(id))`, and it
  is evaluating against the token holder's own membership.
- **The API cannot compute money.** An expense write goes to the `expense-write`
  edge function, which recomputes every share from the split parameters with
  `@waves/core` and refuses `SHARE_MISMATCH` if the caller's numbers disagree
  (TDR §4). A third-party integration is held to exactly the rule the app is.

The corollary is that this service holds **no service-role key**. It is not
configured with one; there is no code path that would use one.

## 2. Where it runs, and why there

`apps/api` — a Next.js app whose single route hands every request to a Hono
router. Deployed to Vercel, like `apps/web` and `apps/admin`, with the same
`vercel.json` (`git.deploymentEnabled: false`, an `ignoreCommand` diffing its own
directory, region `bom1`) and the same manual `vercel-deploy.yml` workflow.

The alternative was a Supabase edge function. It was rejected on the hosting,
not the code: a Supabase project gets **one** custom domain and it applies to the
whole project, so `api.wavs.co.in` would have had to become the address of
`/functions/v1/...` for every function — and the custom-domain feature is a paid
add-on this project does not have. A Vercel project takes a hostname for free and
the repo already knows how to operate one. A separate project rather than a route
inside `apps/web` because this is a new public attack surface with its own
secrets, and a blast radius worth keeping separate from the user-facing app.

## 3. Credentials

A credential is a signed statement, not a random string looked up in a table:

```
wavs_pat_<base64url( version(1) ‖ tokenId(16) ‖ profileId(16) ‖ HMAC(secret, kind ‖ body)[0..16] )>
```

`wavs_pat_` personal · `wavs_at_` OAuth access · `wavs_rt_` refresh ·
`wavs_ac_` authorization code. The kind label is inside the HMAC, so swapping a
prefix is not a forgery — an access token cannot be presented as a refresh token.

Verification is ordered so the cheap check comes first:

1. **HMAC**, constant-time. A forgery stops here, with no database work.
2. **Mint** a 60-second `authenticated` JWT for the profile the token names.
3. **`waves_api_authorize_call`, as that person.** It checks the row exists with
   that `sha256(token)`, is unrevoked and unexpired, that its app is not
   disabled, that the scope requested is in the token's scopes **intersected with
   the application's current registration**, and that the rate budget is not
   spent. One round trip, one statement, no gaps between the checks.

Step 3 running as the user is why no service-role key is needed: even a bug that
let a caller choose the token id could only ever reach a row of their own. The
hash is checked as well as the id, so knowing an id is not knowing a token.

The database stores only `sha256(the whole token string)`. There is no endpoint
that can produce a plaintext token a second time.

### Scopes

`identity.read` · `identity.write` · `groups.read` · `groups.write` ·
`expenses.read` · `expenses.write` · `settlements.read` · `settlements.write` ·
`friends.read` · `categories.read` · `categories.write` · `offline_access`

The catalogue lives in **two** places on purpose — `waves_api_known_scopes()` in
SQL and `SCOPES` in `apps/api/src/server/scopes.ts`. A scope list that only
TypeScript validates is a scope list somebody can write directly; the CHECK
constraint is what makes the vocabulary genuinely closed.

**Narrowing an application's scopes takes effect on its next request, not its
next token.** The intersection is computed in `waves_api_authorize_call`, and an
application narrowed to nothing stops authenticating altogether rather than
merely failing every scoped route.

### Rate limiting

Two buckets through the existing `waves_rate_limit`: `api-token`, keyed on the
token, and `api-user`, keyed on the person. The second is the one that matters —
a caller who has spent a token's minute can mint another in a second, so a
per-token limit alone is a speed bump. The per-person subject is derived from the
session inside the function and cannot be aimed at anybody else.

Both limits are `app_config` integers (`api_rate_limit_per_minute`,
`api_rate_limit_per_minute_user`), turned from the operator console's **Limits**
page, and a `rate_limit_rules` row for either bucket still overrides them. A limit
you have to redeploy to change is a limit nobody changes during the incident that
needed it changed.

### Idempotency

`Idempotency-Key` on a write is **derived**, not stored:
`uuidv5(namespace, tokenId ‖ route ‖ key)` becomes the `client_mutation_id` the
ledger already deduplicates on (ADR-005) — the unique column on
`expense_versions`, the `p_client_mutation_id` argument to
`waves_record_settlement`, the client-chosen `p_group_id` and `p_member_id`. So
there is no table of stored responses to keep consistent: the API inherits the
guarantee instead of reimplementing it. The token id is in the derivation, so two
developers who both choose `"1"` do not collide.

## 4. OAuth 2.1

```
GET  /oauth/authorize      → 302 to this deployment's own consent screen
POST /oauth/authorize      the consent screen saying yes, with the user's session
POST /oauth/token          authorization_code | refresh_token
POST /oauth/revoke         RFC 7009
GET  /.well-known/oauth-authorization-server
```

Decisions worth stating:

- **`GET /oauth/authorize` never redirects to a caller-supplied address.** It
  validates shape only — it has no session and therefore no rights, which is also
  why it cannot be used to probe whether a client id exists — and sends the
  browser to the deployment's own consent screen. Whether the client and the
  redirect are real is decided by `waves_api_consent_preview` under the signed-in
  user. A validator that bounced errors back to the redirect would be an open
  redirect wearing an OAuth costume.
- **The consent screen cannot mint a code.** It calls `POST /oauth/authorize`,
  which signs the code where the HMAC key lives and writes it through
  `waves_api_issue_code`, which re-checks the redirect and the scopes against the
  registration. The browser between the two screens is the attacker's ground, so
  nothing it carries is believed twice.
- **S256 only.** A `plain` challenge is a challenge whose answer is in the
  request that carries it.
- **Single use, enforced by the database.** Consuming a code is an `UPDATE`
  guarded on `consumed_at IS NULL`; two clients replaying the same code both run
  it and exactly one row moves.
- **Refresh rotation with reuse detection.** A refresh token is spent when it is
  used. Presenting one that has already been rotated away means two parties hold
  it and one is a thief, so the whole grant for that application is revoked — and
  the function _returns_ that verdict rather than raising, because a `RAISE`
  aborts its own statement and would roll back the disconnection it reports. A
  token that merely expired unused is refused without accusing anybody.
- **Errors use RFC 6749's shape** (`{"error": "invalid_grant", ...}` with `error`
  as a string), unlike `/v1`. Every OAuth client library parses that; being
  internally consistent at the cost of being unusable would be the wrong trade,
  and it is the only place the service deviates from its own envelope.

## 5. The `/v1` surface

Errors are `{"error": {"code", "message", "request_id"}}` — nested so a refusal
can never be mistaken for a resource — with `X-Request-Id` on every response.
Lists page by opaque keyset cursor (`limit`, `cursor` → `next_cursor`), never by
offset: an offset over a ledger being written to shows one expense twice and
skips another. Money is always a **decimal string of minor units** beside its
currency (ADR-003).

```
GET|PATCH  /v1/me
GET|POST   /v1/groups                            GET   /v1/groups/{id}
PATCH|DELETE /v1/groups/{id}
GET|POST   /v1/groups/{id}/members               PATCH|DELETE /v1/groups/{id}/members/{id}
GET        /v1/groups/{id}/balances
GET|POST   /v1/expenses                          GET|PATCH|DELETE /v1/expenses/{id}
POST       /v1/expenses/{id}/restore
GET|POST   /v1/settlements                       GET /v1/settlements/{id}
POST       /v1/settlements/{id}/confirm
GET        /v1/friends
GET|POST   /v1/categories                        PATCH|DELETE /v1/categories/{id}
```

The contract is `apps/api/openapi.yaml`, and it is the contract — the
documentation site reads it.

CORS differs by surface: `/v1` and `/oauth` are open to any origin, because a
token in a header is the entire authentication story and a permissive
`Access-Control-Allow-Origin` grants a hostile page nothing it could not have got
from `curl`. `/developer/*` is session-authenticated — real ambient authority —
so its allowlist comes from `WAVES_API_ALLOWED_ORIGINS` and is **closed when
unset**, the way the admin console's origin check fails closed.

## 6. No domain is written down

The service's own address is derived from the request (`publicBaseUrl` in
`server/env.ts`), so the OAuth issuer and the discovery document are correct on a
fork, a preview deployment and a self-host with no configuration at all.
`WAVES_API_PUBLIC_URL` exists only for a proxy the derivation cannot see through.
Every other address is a variable with **no fallback**: `WAVES_API_WEB_URL` has
no default, and `/oauth/authorize` answers a named `misconfigured` rather than
guessing — a guess would send somebody approving an application to a domain this
deployment does not own.

Full list with reasoning: `apps/api/.env.example`.

## 7. Deploying

1. **Migrate.** `pnpm db:migrate` — `20260908160000_developer_api` adds three
   tables, sixteen functions and five `app_config` rows. Nothing else in the
   schema changes; no existing policy or grant is touched.
2. **Create the Vercel project** (once) from `apps/api`, add the hostname, and
   set `VERCEL_PROJECT_ID_API` in the repository secrets.
3. **Set its environment** from `apps/api/.env.example`. `WAVES_API_JWT_SECRET`
   is the project's JWT secret. Before the first deploy, open **Auth → JWT Keys**
   in the dashboard and read the state of the **legacy JWT secret**:

   | State there                  | What it means here                                                      |
   | ---------------------------- | ----------------------------------------------------------------------- |
   | _In use_ / _Previously used_ | The API works. Tokens signed with the legacy secret are still verified. |
   | _Revoked_                    | **The API cannot work at all** — see below.                             |

   This matters more than it looks and it cannot be answered from the outside.
   The prod project already advertises an `ES256` key at
   `/auth/v1/.well-known/jwks.json`, and that says **nothing** about HS256:
   Supabase excludes symmetric keys from the discovery document by design ("this
   should return the EC public key (the symmetric key is excluded)"). Migrating
   to signing keys also creates the asymmetric key as a _standby_ — advertised,
   but not yet used to sign — so a project that has only clicked _Migrate JWT
   secret_ looks byte-for-byte identical to one that has fully rotated and
   revoked. The same JWKS output is consistent with the API working perfectly
   and with it not working at all.

   **You do not have to take anyone's word for it.** `GET /health` signs a
   session and presents it, and reports the answer:

   ```
   { "status": "ok",
     "signing": { "state": "ok", "published_algorithms": ["ES256"],
                  "detail": "The backend accepts the sessions this service signs." } }
   ```

   `state` is `ok`, `rejected`, `unreachable` or `unconfigured`, and `status`
   goes to `misconfigured` on a rejection. Check it immediately after the first
   deploy, before telling anybody the API exists.

   **If the legacy secret is revoked**, this design cannot be patched into
   working: the private half of an asymmetric signing key never leaves Supabase,
   so nothing outside it can mint a user session at all. The options are to
   un-revoke the legacy secret, or to replace the mint step — a direct Postgres
   connection using `SET LOCAL ROLE authenticated` with `request.jwt.claims`, the
   way `packages/db/test/helpers.ts` already impersonates, which reaches
   PostgREST's rows but not the edge functions. That is a redesign, not a
   configuration change, which is exactly why this step is here rather than in a
   troubleshooting section.

   `GET /health` also names any variable that is missing.

4. **Set `NEXT_PUBLIC_WAVES_API_URL`** on the web project so the developer
   console can reach the API, and add the web origin to
   `WAVES_API_ALLOWED_ORIGINS` on the API project. **Do not skip the second
   half.** A missing origin is invisible from the browser: the response is
   rejected before any script can read it, `fetch` throws a bare `TypeError`
   with no detail, and the web app's own error handling classifies that as being
   offline. The symptom is a developer with a working connection being told
   they have none, on every page of the console, with nothing in any log.
5. **Deploy**: the `Vercel deploy (manual)` workflow, project `api`.

Nothing schedules `waves_api_sweep()`. That is deliberate rather than forgotten:
the rows that actually accumulate are pruned opportunistically by the rotation
path, the CI database has no `pg_cron`, and a migration that assumed the
extension would fail on a plain Postgres. An operator who wants the tail swept
adds one `cron.schedule` line against the hosted project, the way the other cron
jobs here were added.

## 8. What is deliberately not here

- **Webhooks.** An integration polls today. Outbound delivery needs a queue, a
  retry policy and a signing scheme, and none of that is smaller for being bolted
  onto this PR.
- **Comments, notifications, receipts, attachments, the personal ledger.** The
  scope catalogue has no names for them yet, which is the right order — a scope
  is a promise, and adding one after the fact means re-consenting everybody.
- **Anything a person cannot already do in the app.** There is no endpoint that
  adds somebody else's account to a group: joining is something a person does,
  not something done to them.
