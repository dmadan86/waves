# Waves pricing: Free and Pro

What the paywall (`apps/mobile/src/app/paywall.tsx`, behind the `paywall`
flag) sells, how a purchase reaches the server, and the setup checklist for
RevenueCat, App Store Connect, Play Console and Supabase.

## The tiers

| Tier | India price              | What it adds                                                                                                                       |
| ---- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Free | ₹0                       | The whole ledger, forever (ADR-011): groups, expenses, splits, settle, export. AI voice: 10 commands/month. Optional reward ads.   |
| Pro  | ₹79 / month, ₹699 / year | 300 scans/month, 100 screenshot imports/month, more devices, bigger transfers, and advanced AI voice (100 commands/month). No ads. |

Plus was retired (October 2026). Every existing Plus subscriber is Pro for free:
`subscriptions.tier = 'plus'` rows were rewritten to `'pro'`, a trigger writes `'pro'` for
any later `'plus'` insert, and `waves_my_plan().plan` is `'pro'` for every paid row. The
string `plus` is still accepted on the wire (an old app, an old RevenueCat entitlement or
product id) and read as Pro; nothing grants it. `waves_my_plan().tier` stays `'plus'` for a
paid row because older apps and the device-cap SQL read it as "paid".

New accounts get 15 days of Pro free, no card needed (see "Pro trial" below).

### Display prices by market

The stores hold the real price for every country; these are the figures to configure,
scaled down from the previous Pro prices (₹99 / ₹849 in India, $1.99 / $16.99 in the US;
about -20% monthly and -18% yearly) and rounded to store price points. Those two are the
only Pro prices the repo records; every other storefront follows the US price (below).

| Market | Monthly | Yearly | Yearly saving vs 12 months |
| ------ | ------- | ------ | -------------------------- |
| India  | ₹79     | ₹699   | 26%                        |
| US     | $1.49   | $13.99 | 22%                        |

Other storefronts: equalize from the US price in App Store Connect (Apple's equalization
already keeps each country's previous Pro ratio); in Play Console apply the same
-20% / -18% step to each country's current Pro price and round to the nearest local price point.

### Reward ads (Free only)

Free is the only plan with ads, and they are optional rewarded videos the person
chooses to watch; nothing is forced. Pro (including legacy Plus) and the 15-day trial have no ads;
`waves_ads_eligibility` refuses them with reason `paid` or `trial`.
Full design, setup and economics are in [ads.md](ads.md).

| Rule        | Value                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Reward      | 1 completed ad = 2 AI voice commands or 2 receipt scans                                |
| Daily cap   | 3 rewarded ads per day                                                                 |
| Validity    | The calendar month (UTC) it is earned in; used after the monthly Free allowance        |
| Where shown | Only on the AI voice limit screen and the receipt-scan limit screen                    |
| Who         | Free plan, signed in, account at least 7 days old, flag `ads_rewarded` on for them     |
| Ad type     | Google AdMob rewarded video, non-personalized only; no banners, interstitials or other |

The yearly plan is ₹699 (26% off ₹948). Every other market's price is set **in the stores**.
The app never hardcodes a charged price: the paywall shows RevenueCat's
`priceString`, which is the store's own localized price. Yearly cards and a
Monthly/Yearly switch appear by themselves once the offering has yearly
packages.

How the server reads the tiers (migration `20261008120000_revenuecat_webhook`):

- `waves_profile_is_paid(profile)`: an `active` or `grace`, unexpired
  `subscriptions` row with tier `plus` or `pro` (a legacy `plus` row is Pro).
- `waves_my_plan()`: `tier` is `'plus'` for any paid row (the device cap and
  older apps read it as "paid"); the `plan` key is `'pro'` (or `'free'`).
- `waves_voice_agent_enabled`: an active or grace, unexpired `plus` or `pro` row
  turns advanced voice on, and so does any signed-in (non-guest) account: Free gets
  10 commands a month; guests stay off.
- `waves_voice_agent_quota` / `waves_voice_stream_mint`: an active paid row gets
  100 commands (300 streams) a month, free 10 (30). Migration
  `20261016120000_two_tiers_free_and_pro`.

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
`entitlement_ids`, else from the product id; a retired `plus` entitlement or product is stored as `pro`.

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
waves_pro_monthly    ₹79
waves_pro_yearly    ₹699
```

`waves_plus_monthly` / `waves_plus_yearly` are retired: stop selling them (archive or
remove from the offering) but **keep them in RevenueCat and the stores** while any
subscriber is still on them, and keep them attached to an entitlement the app reads
(`plus` is read as Pro). Existing Plus subscribers stay on their Plus product at the Plus
price, and are Pro from the moment the migration runs.

**App Store Connect** → app → Monetization → Subscriptions:

1. One subscription group, e.g. "Waves", holding the Pro products. Keep the retired Plus
   products in the group at a lower level so nobody ends up with two.
2. Set `waves_pro_monthly` and `waves_pro_yearly` to ₹79 / ₹699 (India) and the US price
   $1.49 / $13.99; equalize the other storefronts from the USA price (see the table above).
   An existing subscriber is not moved to a new price without their consent; for a price
   decrease Apple applies it automatically.
3. Remove the Plus products from sale (Remove from Sale), do not delete them.

**Play Console** → app → Monetize → Products → Subscriptions:

1. `waves_pro_monthly` base plan `monthly`: ₹79; base plan `yearly` on `waves_pro_yearly`: ₹699.
   Other countries from the table above.
2. Deactivate the Plus base plans for new purchases; existing subscriptions continue.

### 3. Entitlements and offering (RevenueCat)

1. **Entitlements**: `pro` ← `waves_pro_monthly`, `waves_pro_yearly`. Keep `plus` attached
   to the Plus products so current subscribers still resolve (the app and server read it
   as Pro).
2. **Offerings**: `default` (current) contains only `pro_monthly` and `pro_annual`
   (custom identifiers containing `monthly` / `annual`, or `$rc_monthly` / `$rc_annual`).
   Remove the Plus packages and the price-test offerings `plus_p49`, `plus_p79`, `plus_p99`.

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
- Walk: buy Pro → `pro active`; cancel in the store
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
| Pro  | ₹79    | ₹56.65       |

A planning model, not accounting: settlement also moves with exchange rates
and each subscriber's commission tier.

## Pro trial

New accounts get **15 days of Pro free, no card needed**, granted by the server.

- **Who:** a non-guest account with a confirmed phone or email that became a real
  account after the trial launched (`pro_trial_settings.launched_at`, the same
  "joined" moment the referral window uses). No backfill. Accounts that already
  hold a plan get none.
- **Once per person:** sha256 identity keys (phone and email, as referrals) are kept
  in `pro_trials`, which has no foreign key to `profiles`, so deleting and
  re-creating the account earns nothing.
- **Grant:** `waves_pro_trial_grant(profile)`, fired by the trigger
  `waves_pro_trial_on_auth_user` on `auth.users` (insert, or when `is_anonymous`,
  phone or email change: the moment the account is verified). It writes a
  `subscriptions` row: tier `pro`, store `trial`, `store_txn_id` `trial:<profile>`,
  ending 15 days later. Idempotent.
- **Voice:** the trial's 20 AI voice commands are one pool that lasts **30 days**
  from the grant (`pro_trials.granted_at` + `pro_trial_settings.voice_days`), though
  Pro itself lasts 15. Anyone with no paid plan uses the pool, also after the Pro
  days end; it does not stack with Free's 10. Once the 20 are spent there is nothing
  more until day 30; after day 30 the normal Free rules apply ("first month 20,
  then 10 a month"). A paid plan (or referral Pro days) uses its own monthly allowance.
  After day 30 Free's own 10 commands a month apply (cloud voice is on for every
  non-guest account); a pool spent early gives nothing more until day 30.
- **A purchase wins:** while a store purchase (or another Pro) is active the trial
  row is ignored. Referral Plus days start after the trial ends, as for any coverage.
- **App:** the paywall shows "Pro trial · N days left" and "Keep Pro"; the dashboard
  menu's Upgrade row shows "N days of Pro left"; the voice screen shows the trial
  commands left. When it ends the person falls back to Free (or referral Pro days).
- Migration `20261015220000_pro_trial`.
