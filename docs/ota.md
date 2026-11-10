# Over-the-air updates (self-hosted)

JavaScript-only changes reach phones without a store release. This replaces
EAS Update: same client (`expo-updates`), our own server and storage.

## How it works

1. `apps/mobile/scripts/ota-publish.mjs` uploads an `expo export` to Cloudflare
   R2: every file under `ota/<runtime>/<folder>/`, then a pointer
   `ota/<runtime>/<channel>/<platform>/latest.json` **last** (the atomic switch).
2. The `ota` Supabase edge function (`supabase/functions/ota`, public,
   `verify_jwt = false`) implements the expo-updates protocol. For a request it
   reads the pointer for the device's `expo-runtime-version`, `expo-platform`
   and `expo-channel-name`, builds the manifest (multipart/mixed, base64url
   SHA-256 asset hashes, asset URLs), signs it, and answers. If the device
   already runs that update, or nothing is published, it answers
   `noUpdateAvailable`.
3. Asset URLs are `OTA_ASSET_BASE_URL/<key>` when a public domain is set on the
   bucket, else one-hour presigned R2 GETs.
4. Signing: the app embeds `apps/mobile/certs/certificate.pem`; the function
   signs with `OTA_PRIVATE_KEY` (RSA-SHA256). A device runs only updates we
   signed, so a leaked bucket key cannot push code.

**Runtime version** is `appVersion` (`app.json`): updates only reach binaries
with the same `version`. Bump `version` whenever native code, a native
dependency or a config plugin changes. **Channel** comes from the build:
EAS profile `production` / `preview` (or `OTA_CHANNEL`); a preview build never
sees a production update.

## One-time setup

1. **Bucket.** Create an R2 bucket (e.g. `waves-ota`). Optional but recommended:
   attach a public custom domain (e.g. `ota.example.com`) so assets are plain
   cacheable URLs.
2. **R2 token.** Create an R2 API token with Object Read & Write on that bucket.
3. **GitHub secrets** (repo > Settings > Secrets > Actions): `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `OTA_R2_BUCKET`. Optional
   `OTA_PUBLIC_ENV`: the `EXPO_PUBLIC_*` values the store build gets from the
   EAS environment (ad unit ids, RevenueCat keys, ...) as dotenv lines, so the
   OTA bundle is built with the same values. The four Supabase/R2/Clarity values
   from `eas.json` are already in the workflow.
4. **Signing key.** The committed certificate already pairs with the private key
   in `~/.waves-keys/updates/private-key.pem`; confirm with
   `node apps/mobile/scripts/ota-keys.mjs check`. (Only if that key is lost:
   `node apps/mobile/scripts/ota-keys.mjs generate`, which refuses to overwrite,
   then ship a new store build, because installed apps trust the old
   certificate.)
5. **Supabase function secrets** (`supabase secrets set ...`):
   `OTA_PRIVATE_KEY` (the PEM, as is), `OTA_R2_BUCKET`, `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (already set for photos; the token
   must be able to read the OTA bucket), and optionally `OTA_ASSET_BASE_URL`.
6. **Deploy** the function: `supabase functions deploy ota`. Do not run
   `supabase config push` (prod auth config drifts from the repo); the
   `[functions.ota] verify_jwt = false` entry is picked up by the deploy.
7. **Ship one store build** (Play / App Store). `app.json` now points
   `updates.url` at `https://ywojpnfyxxltvihqmcni.supabase.co/functions/v1/ota`
   and enables code signing. Installed builds keep asking EAS until they are
   replaced by this build, so OTA starts working only for users who install it.

## Publish

GitHub > Actions > "OTA update" > Run workflow: pick platform, channel, and a
message. It exports the bundles and runs `ota-publish.mjs`. It is manual only;
the push trigger in `.github/workflows/ota.yml` is commented out.

Locally, from `apps/mobile`:

```
npx expo export --platform android --platform ios --output-dir dist
node scripts/ota-publish.mjs --dry-run          # list what would upload
node scripts/ota-publish.mjs --channel production --message "fix X"
```

The script prints the update's **folder id**; keep it for rollbacks. Devices
fetch the update on next launch and apply it on the launch after (or on
"Settings > App updates > Check for updates").

## Roll back

```
node scripts/ota-publish.mjs --rollback <folderId> --channel production
```

This rewrites only `latest.json` to a fresh update id pointing at the old
files, so devices see it as a newer update and move back on their next check.

## Check on a phone

Settings > App updates shows "Built-in" or "Over-the-air", the update id and
date, the channel and the runtime version.
