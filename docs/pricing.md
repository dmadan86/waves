# Waves pricing: Free, Plus and Pro

What the paywall (`apps/mobile/src/app/paywall.tsx`, behind the `paywall`
flag) sells, how a purchase reaches the server, and the setup checklist for
RevenueCat, App Store Connect, Play Console and Supabase.

## The tiers

| Tier | India price | What it adds                                                                     |
| ---- | ----------- | -------------------------------------------------------------------------------- |
| Free | ₹0          | The whole ledger, forever (ADR-011): groups, expenses, splits, settle, export.   |
| Plus | ₹49 / month | The paid features: 300 scans/month, more devices, bigger transfers. No AI voice. |
| Pro  | ₹99 / month | Everything in Plus, plus the advanced AI voice agent (150 commands/month).       |

Annual plans and every other market's price are set **in the stores** later.
The app never hardcodes a charged price: the paywall shows RevenueCat's
`priceString`, which is the store's own localized price. Yearly cards and a
Monthly/Yearly switch appear by themselves once the offering has yearly
packages.

How the server reads the tiers (migration `20261008120000_revenuecat_webhook`):

- `waves_profile_is_paid(profile)`: an `active` or `grace`, unexpired
  `subscriptions` row with tier `plus` or `pro`. Plus and Pro are both paid.
- `waves_my_plan()`: `tier` is `'plus'` for any paid row (the device cap and
  older apps read it as "paid"); the new `plan` key is `'plus'` or `'pro'`.
- `waves_voice_agent_quota` / `waves_voice_stream_mint`: only an active `pro`
  row gets the Pro allowance. **Plus gets the free voice allowance**, by design.

## How a purchase flows

```
app ── Purchases.purchasePackage ──▶ store ──▶ RevenueCat
                                                  │ webhook (Authorization: <secret>)
                                                  ▼
                              supabase/functions/revenuecat-webhook
                                                  │ waves_revenuecat_apply (one transaction)
                                                  ▼
                               revenuecat_events (dedupe) + subscriptions
```

- **RevenueCat app user id = Waves profile id.** `lib/auth.tsx` calls
  `syncPurchasesUser(session.user.id)`: the SDK is configured with that id at
  sign-in, `Purchases.logIn` on an account switch, `Purchases.logOut` on
  sign-out. No anonymous RevenueCat users are created.
- **The server is the authority.** The app's `useEntitlement()` reads
  RevenueCat's CustomerInfo for display only (badge, "current plan").
- **No key, no billing.** Without `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
  `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` the SDK is never touched, the paywall
  route is not registered and `settings/upgrade` says there is nothing to buy.

### Webhook event mapping

One `subscriptions` row per store subscription, keyed by `store_txn_id` =
RevenueCat's `original_transaction_id`. Tier comes from the event's
`entitlement_ids` (`pro` beats `plus`), else from the product id.

| Event                                                  | Row                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| INITIAL_PURCHASE, RENEWAL, UNCANCELLATION              | `active` until `expiration_at_ms`; price/currency when charged                |
| PRODUCT_CHANGE                                         | `active`; the new tier only if it is an upgrade (downgrades land at renewal)  |
| CANCELLATION                                           | stays `active` until expiry; `refunded` if `cancel_reason = CUSTOMER_SUPPORT` |
| BILLING_ISSUE                                          | `grace` until `grace_period_expiration_at_ms` (still paid)                    |
| EXPIRATION                                             | `expired`                                                                     |
| REFUND                                                 | `refunded`                                                                    |
| TRANSFER                                               | store rows of `transferred_from` move to `transferred_to` (promo rows stay)   |
| SUBSCRIPTION_EXTENDED, REFUND_REVERSED                 | `active`                                                                      |
| TEST, anything else, non-Waves products, Stripe/Amazon | recorded in `revenuecat_events`, nothing written                              |

Every event id is recorded once in `revenuecat_events`; a replay answers 200
`duplicate` and writes nothing. An older event delivered after a newer one
(`subscriptions.store_event_at`) is `stale` and ignored. An `app_user_id` that
is not a profile (e.g. `$RCAnonymousID:…`) answers 200 `unknown_profile`, so
RevenueCat does not retry it forever. Only a database failure answers 5xx
(RevenueCat retries; the write is atomic, so that is safe).

## Setup checklist (owner)

### 1. RevenueCat project and apps

1. app.revenuecat.com → create project **Waves**.
2. Add an **App Store** app: bundle id from `apps/mobile/app.json`
   (`ios.bundleIdentifier`). Upload an **In-App Purchase Key** (App Store
   Connect → Users and Access → Integrations → In-App Purchase) and set the
   App Store Connect API key so RevenueCat can import products.
3. Add a **Play Store** app: package name from `app.json`
   (`android.package`). Upload the Google service-account JSON with the
   "View financial data" and "Manage orders and subscriptions" permissions in
   Play Console (RevenueCat's guide walks through it), and turn on **Real-time
   developer notifications** with the Pub/Sub topic RevenueCat shows.
4. Copy each app's **public SDK key** (`appl_…`, `goog_…`) for step 5.

### 2. Store products

Product ids are the same on both stores (`packages/core/src/billing/revenuecat.ts`):

```
waves_plus_monthly    ₹49
waves_pro_monthly     ₹99
waves_plus_yearly     later
waves_pro_yearly      later
```

**App Store Connect** → app → Monetization → Subscriptions:

1. Create **one subscription group**, e.g. "Waves", holding every Plus and Pro
   product, so a person is on at most one and switching is an upgrade or
   downgrade, not a second subscription.
2. In the group, rank **Pro above Plus** (group level order: Pro monthly/yearly
   at level 1, Plus at level 2), so Plus → Pro is an immediate upgrade.
3. Create `waves_plus_monthly` (1 month) and `waves_pro_monthly` (1 month).
   Set India to ₹49 / ₹99; leave other storefronts to be set later.
4. Fill in display names, descriptions and the review screenshot; submit them
   with the app version that ships this paywall.
5. Agreements, Tax and Banking must be active (Paid Apps agreement).

**Play Console** → app → Monetize → Products → Subscriptions:

1. Create subscription `waves_plus_monthly` with one auto-renewing base plan
   (e.g. `monthly`, 1 month), India ₹49; activate it.
2. Create `waves_pro_monthly` the same way at ₹99.
3. Later: yearly base plans (`yearly`) or separate `*_yearly` products; the app
   picks them up from the offering with no release.
4. Play needs an uploaded build with the billing library (any internal-testing
   build of this branch) before subscriptions can be created.

### 3. Entitlements and offering (RevenueCat)

1. Product catalog → **Products**: import the four store products (both apps).
2. **Entitlements**: create `plus` and `pro`.
   - `plus` ← `waves_plus_monthly` (+ `waves_plus_yearly` later)
   - `pro` ← `waves_pro_monthly` (+ `waves_pro_yearly` later)
   - Attach Pro products to `pro` only; the app and server treat Pro as a
     superset of Plus.
3. **Offerings**: create `default`, mark it **current**, add packages:
   - `plus_monthly` → `waves_plus_monthly` (both stores)
   - `pro_monthly` → `waves_pro_monthly` (both stores)
   - later `plus_annual`, `pro_annual` (custom identifiers containing
     `monthly` / `annual` are how the app tells periods apart; `$rc_monthly` /
     `$rc_annual` also work but only fit one tier each).

### 4. Webhook

1. Pick a long random secret: `openssl rand -hex 32`.
2. Supabase secret:
   `supabase secrets set REVENUECAT_WEBHOOK_SECRET=<secret> --project-ref <ref>`
3. Deploy the function (it has `verify_jwt = false` in `supabase/config.toml`):
   `pnpm edge:build && supabase functions deploy revenuecat-webhook --project-ref <ref>`
4. Apply migration `20261008120000_revenuecat_webhook` (`pnpm db:migrate`
   against the target database) **before** sending events.
5. RevenueCat → Project → Integrations → **Webhooks** → add:
   - URL: `https://<ref>.supabase.co/functions/v1/revenuecat-webhook`
     (production: `https://ywojpnfyxxltvihqmcni.supabase.co/functions/v1/revenuecat-webhook`)
   - Authorization header value: the secret (bare, or `Bearer <secret>`).
   - Environment: both, while testing. To drop sandbox events in production
     later, set `REVENUECAT_IGNORE_SANDBOX=true` on the function.
6. Press **Send test event**: the function answers 200 `{"outcome":"ignored"}`
   and a `TEST` row appears in `revenuecat_events`.

### 5. Env keys

| Where                                       | Key                                  | Value                         |
| ------------------------------------------- | ------------------------------------ | ----------------------------- |
| EAS (`eas env:create`, or `eas.json` `env`) | `EXPO_PUBLIC_REVENUECAT_IOS_KEY`     | `appl_…` (public)             |
| EAS                                         | `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | `goog_…` (public)             |
| Supabase function secrets                   | `REVENUECAT_WEBHOOK_SECRET`          | the webhook secret            |
| Supabase (optional)                         | `REVENUECAT_IGNORE_SANDBOX`          | `true` to drop sandbox events |

The SDK keys are public by design; the webhook secret is not and never goes in
the app. A new native build is required (`react-native-purchases` is native;
no config plugin is needed, autolinking handles it).

### 6. Turn it on

Seed or flip the `paywall` feature flag (it is unseeded, i.e. off). With the
flag on and a key in the build, `settings/upgrade` shows "See plans" and the
paywall route is reachable.

### 7. Sandbox testing

- **iOS:** App Store Connect → Users and Access → Sandbox → add a tester. On
  the device, sign in under Settings → App Store → Sandbox Account. Install a
  dev/TestFlight build with the iOS key. Renewals run fast (1 month = 5
  minutes, 6 renewals max), so RENEWAL and EXPIRATION arrive within the hour.
- **Android:** Play Console → Settings → License testing → add the tester's
  Google account; install from an internal-testing track. Test cards
  ("always approves", "declines", "slow") exercise BILLING_ISSUE; renewals are
  accelerated (1 month = 5 minutes).
- **Check each step:** RevenueCat → Customers → search the profile id → the
  entitlement and the event history; then in SQL:
  `select tier, status, current_period_end, store from subscriptions where profile_id = '<id>';`
  and `select waves_my_plan('<id>');`.
- Walk: buy Plus → `plus active`; upgrade to Pro → `pro`; cancel in the store
  → still `active` until expiry; let it lapse → `expired`; restore on a second
  device signed in to the same Waves account → same tier.

### 8. Apple Small Business Program

Enrol at developer.apple.com/app-store/small-business-program **before** the
first sale: commission drops from 30% to 15% on proceeds under $1M/year, and
it only applies from the enrolment date onward. Google Play is 15% on
subscriptions (and the first $1M) without enrolment.

## Net revenue (India, monthly)

Net = listed ÷ 1.18 (GST) × 0.85 (15% commission, Small Business Program).

| Plan | Listed | Net to Waves |
| ---- | ------ | ------------ |
| Plus | ₹49    | ₹35.30       |
| Pro  | ₹99    | ₹71.31       |

A planning model, not accounting: settlement also moves with exchange rates
and each subscriber's commission tier.
