# Waves Pro pricing

What the paywall (`apps/mobile/src/app/paywall.tsx`, behind the `paywall`
route flag — see "Status" below) sells, what it actually charges, and how to
set the products up on both stores so that it can.

## The model

Two plans. Monthly is pay-as-you-go; yearly is paid once a year, at roughly
ten months' worth of the monthly price — "2 months free" — with a 7-day free
trial.

| Market | Currency | Monthly | Yearly | Yearly ≈ monthly × | Free trial |
| --- | --- | --- | --- | --- | --- |
| US | USD | $0.99 | $9.99 | 10.09× | 7 days, yearly only |
| UK | GBP | £0.99 | £9.99 | 10.09× | 7 days, yearly only |
| Australia | AUD | A$1.49 | A$14.99 | 10.06× | 7 days, yearly only |
| UAE / Gulf¹ | AED | 3.99 | 39.99 | 10.02× | 7 days, yearly only |
| India | INR | ₹39 | ₹399 | 10.23× | 7 days, yearly only |

¹ "Gulf" means the AED price is also the fallback shown for Saudi Arabia,
Qatar, Kuwait, Bahrain and Oman (`fallbackRegionForCountry` in
`apps/mobile/src/lib/pricing.ts`), not UAE alone. Each of those storefronts
still needs its own price point entered in its own local currency when the
products are created (see "Store setup" below) — this table is USD-equivalent
intent, not a substitute for setting SAR/QAR/KWD/BHD/OMR prices.

**These are introductory prices, not a permanent commitment.** The owner can
raise them later; existing subscribers typically keep their price under both
stores' price-increase-grandfathering rules unless the increase is explicitly
pushed to them.

**The app never hardcodes a charged price.** `paywall.tsx` fetches the real
product from the store at runtime (`expo-iap`'s `fetchProducts`) and shows
exactly what the store says it will charge, in the buyer's own currency and
locale formatting. The table above exists only as `FALLBACK_PRICES` in
`apps/mobile/src/lib/pricing.ts`, shown — clearly marked "approximate" — when
the store connection isn't available yet (no native IAP build, a simulator, a
dev client, a network blip). It is a display fallback, never a purchase
input: every purchase is requested by product id, and the store, not this
table, decides what it charges.

## Product ids

```
waves_pro_monthly
waves_pro_yearly
```

**Two flat products, on both stores — not one subscription with two Android
base plans.** Google Play's "base plans" (one subscription, several
billing-interval variants under it) have no equivalent on the App Store:
there, every price point is its own product, grouped only by a Subscription
Group. Two top-level product ids keep both stores symmetric and let the app
query both with one call — `fetchProducts({ skus: ['waves_pro_monthly',
'waves_pro_yearly'], type: 'subs' })` — rather than branching the client on
"Android base plan" vs "iOS product". The cost of this choice: on Android, the
two plans don't share a renewal/upgrade-proration relationship the way two
base plans of one subscription would. That is not needed here — the two plans
are alternatives a buyer picks once, not a tier ladder — so it is not a loss
worth avoiding the simpler, symmetric shape for.

## In-app purchase library

[`expo-iap`](https://www.npmjs.com/package/expo-iap) (OpenIAP's Expo Module
implementation). Added at `apps/mobile/package.json` (`^5.8.2`) and
`apps/mobile/app.json`'s `plugins` (`"expo-iap"`, no plugin options — the
Android manifest's billing permission ships inside Play Billing's own AAR, and
iOS needs no Info.plist entry for StoreKit).

Why this one over the alternatives:

- **`react-native-iap`** (by the same maintainers) is the Nitro-Modules
  version of the same OpenIAP client protocol. Either would work; `expo-iap`
  was picked because it is an Expo Module, which fits this app's Expo Modules
  / config-plugin-based native setup (no extra Nitro codegen step in the
  build), and its config plugin is already wired into `app.json` the same way
  every other native dependency here is.
- **RevenueCat** was considered and rejected for this PR. It's a reasonable
  choice once server-side entitlement and cross-platform receipt sync matter
  more than they do today, but it is a paid SaaS dependency (free tier caps at
  $2.5k MTR) for a problem this app doesn't have yet: one backend, one set of
  product ids, no cross-platform entitlement sync requirement, and the receipt
  verification RevenueCat would otherwise own is explicitly out of scope for
  this PR anyway (see "Status" below). Reaching for it now would mean paying
  for and learning a second system before the first one (a verifying backend)
  exists at all. Revisit if/when subscription logic needs to live outside the
  app (web, email receipts, an admin dashboard) rather than just inside it.

**A new native build is required.** `expo-iap` is a native module; it is not
usable from the currently running JS-only / Expo Go-style setup. Run (or have
CI run) `expo prebuild` and a fresh dev client / release build before testing
any purchase flow on a device or simulator.

## Store setup

### Play Console

1. **Create the app's base subscription scaffolding** (once, if not already
   done): Play Console → your app → Monetize → Subscriptions.
2. **Create `waves_pro_monthly`**: "Create subscription" → product ID
   `waves_pro_monthly` → name "Waves Pro (monthly)". Add one base plan:
   - Base plan ID: `monthly` (or any id — the *product* id is what the app
     queries by, the base plan id is Google's internal detail).
   - Billing period: 1 month, auto-renewing.
   - Price: set each market's local price from the table above (plus every
     other market Play requires a price for — Play will suggest conversions;
     override the ones in the table).
   - Activate the base plan.
3. **Create `waves_pro_yearly`** the same way: product ID `waves_pro_yearly`,
   one base plan, billing period 1 year, same price table (yearly column).
   On this base plan, add an **offer**:
   - Offer type: free trial.
   - Duration: 7 days.
   - Eligibility: new subscribers only (standard — prevents a lapsed
     subscriber from re-triggering the trial every time they resubscribe).
   - Activate the offer.
4. The app resolves the offer at runtime: `fetchProducts` returns the
   subscription with its current `subscriptionOffers`, and `paywall.tsx`
   passes the first offer's `offerTokenAndroid` into `requestPurchase` — no
   offer id is hardcoded client-side, so changing the trial length or adding a
   second offer later does not need an app update.

### App Store Connect

1. **Create a Subscription Group** (once): App Store Connect → your app →
   Monetization → Subscriptions → "+" next to Subscription Groups — e.g.
   "Waves Pro". Both plans must live in the *same* group so App Store treats
   them as alternatives (a buyer can be on at most one at a time, and
   switching is an upgrade/downgrade rather than two separate purchases).
2. **Create the monthly subscription**: inside that group, "+" → Reference
   Name "Waves Pro Monthly" → Product ID `waves_pro_monthly` → Subscription
   duration 1 month. Add a price (the US row from the table above; App Store
   Connect auto-generates every other storefront's price from Apple's price
   tiers — review and override the UK/AU/UAE/India rows to match the table,
   since Apple's auto-conversion will not land on the owner's exact numbers).
3. **Create the yearly subscription** the same way: Product ID
   `waves_pro_yearly`, duration 1 year, same price table (yearly column).
4. **Add the free trial** on the yearly subscription only: its subscription
   page → Introductory Offers → "+" → type "Free Trial" → duration 1 week →
   apply to all territories (or the same markets as the price table; Apple
   requires an introductory offer to be configured per-territory the same way
   prices are).
5. Submit both subscriptions' metadata (display name, description) for
   review with the next app version — a new in-app purchase is reviewed
   alongside the binary that uses it, which the StoreKit config plugin's
   native build already requires regardless.

## Net revenue

**Assumptions, stated so the numbers can be redone when they change:**

- **Store commission: 15%** on both stores. This is Apple's and Google's
  small-business / standard-subscriber-retention rate (Apple: enrolled in the
  Small Business Program, or any subscriber retained paid for 12+ months
  regardless of program; Google: the first $1M of a developer's annual
  revenue, which a pricing model this low will not exceed). The standard 30%
  applies to a developer outside those bands — redo the "net" column at 0.70×
  gross-after-tax instead of 0.85× if that ever applies here.
- **VAT/GST is already included in the listed price** in every market except
  the US (this is how Apple and Google price subscriptions everywhere VAT/GST
  applies — the buyer never sees a price that grows at checkout). The
  commission is computed on the *tax-exclusive* amount, because the tax
  portion is collected and remitted to the relevant tax authority by the
  store, not kept by the developer and not commissioned.
- **US sales tax is added on top of the listed price at checkout** (it is
  destination-based and varies by the buyer's state/county, so it cannot be
  baked into one listed price the way a national VAT can). It is not part of
  developer proceeds either way, so it does not change the "net" column — the
  developer's net is 85% of the *listed* price, full stop, for the US row.
- Rates used: India GST 18%, UK VAT 20%, Australia GST 10%, UAE VAT 5%.

**Net = listed price ÷ (1 + VAT/GST rate) × 0.85** (US: **listed price × 0.85**,
no VAT/GST divide).

| Market | Plan | Listed price | Net to Waves |
| --- | --- | --- | --- |
| US | Monthly | $0.99 | $0.84 |
| US | Yearly | $9.99 | $8.49 |
| UK | Monthly | £0.99 | £0.70 |
| UK | Yearly | £9.99 | £7.08 |
| Australia | Monthly | A$1.49 | A$1.15 |
| Australia | Yearly | A$14.99 | A$11.58 |
| UAE | Monthly | AED 3.99 | AED 3.23 |
| UAE | Yearly | AED 39.99 | AED 32.37 |
| India | Monthly | ₹39 | ₹28.09 |
| India | Yearly | ₹399 | ₹287.42 |

(Figures rounded to the nearest minor unit. Real settlement will also move
with exchange rates on non-USD markets and with whichever exact commission
tier a given subscriber's tenure/program status lands on — treat this table
as the planning model, not an accounting source of truth.)

## Status — what this PR does and does not do

**Does:** real store products and prices at runtime; buy, restore, and
pending/cancelled/error handling for both plans; a `useEntitlement()` hook
reading the store's current active subscriptions; the redesigned paywall UI,
in the four shipped languages; this pricing/setup doc.

**Does not — required before this can be trusted or turned on:**

- **Server-side receipt verification.** Nothing in this PR calls a backend to
  verify a purchase. `useEntitlement()` and the paywall's own "already
  subscribed" check both read `expo-iap`'s on-device active-subscriptions
  list, which is exactly as trustworthy as the phone it's running on — fine
  for UI state (show the Pro badge, hide the upgrade button), **not fine**
  for anything a person could profit from faking. Next step: a backend
  endpoint that verifies the App Store / Play receipt (or uses
  [IAPKit](https://kit.openiap.dev/docs) / the stores' own server
  notifications — `App Store Server Notifications V2`, Play's Real-time
  Developer Notifications) and is the *only* thing that ever grants
  anything security-sensitive.
- **The `paywall` route flag stays off.** This PR does not turn it on, and
  does not reconcile the paywall with `settings/upgrade` (which still tells
  people there is nothing to buy) — see both screens' header comments.
  Turning the flag on, and deciding how `settings/upgrade` should change, is
  a product decision for whoever owns that reconciliation.
- **The store products themselves.** Nothing in this repository creates them
  — "Store setup" above is the human checklist for Play Console and App Store
  Connect. The app will show the approximate fallback table until both
  products exist, are active, and have been through each store's review.
