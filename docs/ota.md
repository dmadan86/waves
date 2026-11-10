# Over-the-air updates (self-hosted)

JavaScript-only changes reach phones without a store release. This replaces
EAS Update: same client (`expo-updates`), our own server and storage.

## How it works

1. `apps/mobile/scripts/ota-publish.mjs` uploads an `expo export` to Cloudflare
   R2: the files under `ota/<runtime>/<folder>/`, then, per platform and
   channel, a **manifest built and signed at publish time**
   (`ota/<runtime>/<channel>/<platform>/<updateId>/manifest.json` + `manifest.sig`,
   plus `directive.sig`), and the pointer `.../latest.json` **last** (the atomic
   switch).
2. The `ota` Supabase edge function (`supabase/functions/ota`, public,
   `verify_jwt = false`) implements the expo-updates protocol. It reads the
   pointer for the device's `expo-runtime-version`, `expo-platform` and
   `expo-channel-name` and serves the stored manifest bytes **verbatim** in a
   multipart/mixed response, with the stored signature when the device sends
   `expo-expect-signature`. If the device already runs that update, or nothing is
   published, it answers `noUpdateAvailable`.
3. Asset URLs inside the manifest are `OTA_ASSET_BASE_URL/<key>`: the bucket must
   have a public custom domain (or `r2.dev` URL). Assets are public by design;
   devices verify each one against the SHA-256 in the signed manifest.
4. Signing: the app embeds `apps/mobile/certs/certificate.pem`. The private key
   (`OTA_PRIVATE_KEY`) exists only in the `publish` job of the GitHub workflow
   (and on the owner's machine for rollbacks). The edge function never holds it,
   so stolen R2 credentials, or a compromised function, cannot get code signed:
   devices reject anything not signed with that key.

**Runtime version** is `appVersion` (`app.json`): updates only reach binaries
with the same `version`. Bump `version` whenever native code, a native
dependency or a config plugin changes. **Channel** comes from the build:
EAS profile `production` / `preview` (or `OTA_CHANNEL`); a preview build never
sees a production update.

## One-time setup

1. **Bucket.** Create an R2 bucket (e.g. `waves-ota`) and attach a public custom
   domain (e.g. `https://ota.example.com`); this is `OTA_ASSET_BASE_URL`.
2. **R2 token.** Create an R2 API token with Object Read & Write on that bucket
   only.
3. **GitHub environments** (Settings > Environments): create `ota-production`
   and `ota-preview`. On `ota-production` add **required reviewers**, so every
   production publish waits for approval. Put these as **environment secrets**
   on both (so the approval gates them): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `OTA_R2_BUCKET`, `OTA_ASSET_BASE_URL`,
   `OTA_PRIVATE_KEY` (the full PEM from `~/.waves-keys/updates/private-key.pem`).
   Optional repo secret `OTA_PUBLIC_ENV`: the `EXPO_PUBLIC_*` values the store
   build gets from the EAS environment (ad unit ids, RevenueCat keys, ...) as
   dotenv lines, so the OTA bundle is built with the same values.
4. **Signing key.** The committed certificate already pairs with that key;
   confirm with `node apps/mobile/scripts/ota-keys.mjs check`. (Only if the key
   is lost: `node apps/mobile/scripts/ota-keys.mjs generate`, which refuses to
   overwrite, then ship a new store build, because installed apps trust the old
   certificate.)
5. **Supabase function secrets** (`supabase secrets set ...`): `OTA_R2_BUCKET`,
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The function only
   _reads_; use a read-only token for it if you can. **Do not set
   `OTA_PRIVATE_KEY` there.**
6. **Deploy** the function: `supabase functions deploy ota`. Do not run
   `supabase config push` (prod auth config drifts from the repo); the
   `[functions.ota] verify_jwt = false` entry is picked up by the deploy.
7. **Ship one store build** (Play / App Store). `app.json` now points
   `updates.url` at `https://ywojpnfyxxltvihqmcni.supabase.co/functions/v1/ota`
   and enables code signing. Installed builds keep asking EAS until they are
   replaced by this build, so OTA starts working only for users who install it.

## Publish

GitHub > Actions > "OTA update" > Run workflow: pick platform, channel, and a
message. The `build` job (no secrets) exports the bundles; the `publish` job
(secrets, behind the environment approval for production) signs and uploads. It
is manual only; the push trigger in `.github/workflows/ota.yml` is commented out.

Locally, from `apps/mobile` (needs the env vars listed in the script header):

```
npx expo export --platform android --platform ios --output-dir dist
node scripts/ota-publish.mjs --dry-run          # list what would upload
node scripts/ota-publish.mjs --channel production --message "fix X"
```

The script prints the update's **folder id**; keep it for rollbacks. Devices
fetch the update on next launch and apply it on the launch after (or on
"Settings > App updates > Check for updates").

## Roll back

Run on a machine that has the signing key (the workflow has no rollback input):

```
OTA_PRIVATE_KEY="$(cat ~/.waves-keys/updates/private-key.pem)" \
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
OTA_R2_BUCKET=... OTA_ASSET_BASE_URL=... \
node scripts/ota-publish.mjs --rollback <folderId> --channel production
```

This signs a new manifest (fresh update id and date, old files) and then moves
`latest.json`, so devices see a newer update and move back on their next check.

## Check on a phone

Settings > App updates shows "Built-in" or "Over-the-air", the update id and
date, the channel and the runtime version.
