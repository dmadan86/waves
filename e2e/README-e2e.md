# Mobile end-to-end tests (Maestro)

The flows in this directory drive the real app on a device/emulator. They are
the only tests that exercise rendering, navigation and the offline mirror end to
end. They run from their own workflow, `.github/workflows/e2e.yml`.

**Status: on, nightly.** The staging project `emyjuhazbynzwjqcfloh`
(`waves-staging`, ap-south-1) was provisioned on 2026-09-16 — migrations
applied, all 17 edge functions deployed — and `E2E_ENABLED` is set.

Not on every pull request, and that is deliberate. The run builds the Android
app from source and then drives twenty flows one at a time with a reseed between
each: three quarters of an hour, against the two minutes the rest of CI takes.
In front of every review that is a check nobody can wait for, and the only
honest ways to read it are to ignore it or to be slowed by it. So:

| when                                  | what runs                                                     |
| ------------------------------------- | ------------------------------------------------------------- |
| nightly, 19:00 UTC                    | the full suite against `main`                                 |
| **Actions → e2e → Run workflow**      | the full suite against any branch — use this before a release |
| the **`e2e`** label on a pull request | the full suite against that branch                            |

The label fires when it is _applied_, so pushing more commits afterwards does
not re-run it — take the label off and put it back, or dispatch it. Worth
applying to anything that touches navigation, the mirror, or the shape of a
screen, where waiting for the nightly means finding out after it has merged.
This repo is public, so a fork's pull request gets none of the secrets; the
label only works on a branch in this repository.

Deliberately **not** in the branch ruleset's required checks: these flows drive
an emulator and a network, so they can fail for reasons that are not the code's,
and a check that can do that must not be able to hold the repository shut.

The job seeds but does not migrate. When a migration lands, apply it to staging
too, or the seed fails against a schema older than the fixture:

```bash
DIRECT_URL="postgresql://postgres.emyjuhazbynzwjqcfloh:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require"   pnpm --filter @waves/db migrate:deploy
```

Edge functions are the same story — `pnpm edge:deploy` targets whichever project
is linked, so pass `--project-ref emyjuhazbynzwjqcfloh` when staging needs them.

## What the flows expect

Each flow signs into a **known, seeded account** (`e2e/login.yaml`) and then
asserts against a **deterministic fixture** created by `e2e/seed-e2e.mjs`:

- a group named **Goa trip** (a trip, 🏖️),
- one expense **Beach shack dinner** (₹1200), paid by the ghost **Priya**,
  split among the ghosts **Priya / Sam / Dev** — so the login user's balance is
  **zero** (which is why `leave-group` can leave without settling first).

Because the fixture is fixed, the flow assertions are real (`assertVisible: 'Goa
trip'`), not `optional` "screen renders" stubs.

## How it was enabled (and how to redo it elsewhere)

1. **Create a staging Supabase project** (never point this at production — the
   seeder refuses the prod ref and rewrites data freely). Apply the same
   migrations to it (`pnpm --filter @waves/db migrate:deploy` with its
   `DIRECT_URL`), and deploy the edge functions (`pnpm edge:deploy
--project-ref <ref>`) — the app's sync goes through `sync`, so a project with
   tables and no functions gets a signed-in app that never loads anything.

2. **Add the Waves Android build profile.** The flows use `appId:
app.waves.mobile`; the build needs `android/app/google-services.json`
   registered for that package (the Stage-C Firebase step). Base64 it into a
   secret.

3. **Set the repo variable and secrets** (Settings → Secrets and variables →
   Actions):

   | kind     | name                       | value                                   |
   | -------- | -------------------------- | --------------------------------------- |
   | variable | `E2E_ENABLED`              | `true`                                  |
   | secret   | `E2E_SUPABASE_URL`         | staging project URL                     |
   | secret   | `E2E_SUPABASE_ANON_KEY`    | staging anon key (baked into the build) |
   | secret   | `E2E_SERVICE_KEY`          | staging service_role key (seeder only)  |
   | secret   | `E2E_EMAIL`                | e.g. `e2e@waves.test`                   |
   | secret   | `E2E_PASSWORD`             | the login password                      |
   | secret   | `GOOGLE_SERVICES_JSON_B64` | `base64 -w0 google-services.json`       |

Once those are present, the job seeds the fixture, builds the APK against
staging, boots an API-34 emulator, installs Maestro, and runs the flows.

## Running locally

```bash
# 1. Seed a staging (or local-Supabase) project:
export E2E_SUPABASE_URL="https://<ref>.supabase.co"
export E2E_SERVICE_KEY="<service_role key>"
export E2E_EMAIL="e2e@waves.test"
export E2E_PASSWORD="<password>"
node e2e/seed-e2e.mjs

# 2. Build + install the app against the same project (see apps/mobile). Then run
#    each flow on its own, reseeding first, because the flows mutate the backend:
for flow in home-to-add-expense edit-expense delete-restore-expense \
            change-logo capture-assign custom-tags locale-switch \
            rename-archive-group sign-out-privacy local-privacy-audit clone-group \
            group-photo-paid-gate friends-merge-guests leave-group; do
  node e2e/seed-e2e.mjs
  maestro test --env E2E_EMAIL="$E2E_EMAIL" --env E2E_PASSWORD="$E2E_PASSWORD" "e2e/$flow.yaml"
done
```

`login.yaml` is a sub-flow (`runFlow`) — run the flows explicitly (one per
invocation) rather than `maestro test e2e/`, so it is not executed on its own.
In CI this loop lives in `e2e/run-maestro.sh`.

## The flows

| Flow                          | Guards                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `home-to-add-expense.yaml`    | launch → balance → open group → see expense + ghost → add-expense calculator         |
| `edit-expense.yaml`           | edit the seeded expense → the ledger reflects the new value                          |
| `delete-restore-expense.yaml` | delete → gone from the feed → Activity entry → Restore → back                        |
| `rename-archive-group.yaml`   | rename a group (persists) → archive → gone from Home                                 |
| `change-logo.yaml`            | open Group settings → cover-emoji picker → pick a new icon → applies, sheet closes   |
| `capture-assign.yaml`         | capture with no group → find it in the inbox → assign → add-expense prefilled        |
| `custom-tags.yaml`            | make a tag in Settings → tag an expense with it → the tag names the ledger row (A42) |
| `locale-switch.yaml`          | Account → Language → switch to Hindi → strings re-render live (no restart)           |
| `sign-out-privacy.yaml`       | sign out → back at the gateway, the ledger off screen                                |
| `local-privacy-audit.yaml`    | dev-only route checks aggregate local private-data cleanup after sign-out            |
| `clone-group.yaml`            | Duplicate → prefilled New Group → drop a member → Create → copy made, original kept  |
| `group-photo-paid-gate.yaml`  | group photo is paid, cover emoji is free                                             |
| `friends-merge-guests.yaml`   | merge the two seeded "Reeya" ghosts, with the irreversible-warning gate              |
| `leave-group.yaml`            | leave a settled group → gone from Home and stays gone after relaunch                 |

Each flow mutates the shared staging backend, so CI **reseeds the fixture before
every flow** (the seed is idempotent). Locally, run one flow at a time and
reseed between them.

The `.mjs` scripts in this directory are a separate concern: manual integration
checks against a **deployed** stack (see each file's header).
