# Plus price test (49 / 79 / 99)

Pro is unchanged. Only the Plus monthly price is tried at three levels.

## How it works

- Flag `plus_price`, arms `p49`, `p79`, `p99`. The migration (`20261015160000_plus_price_test`) inserts it
  **disabled at 0%**, so shipping changes nothing.
- A person's arm is hashed from the flag key and their profile id (same rule in app and database).
- The paywall asks RevenueCat for the offering `plus_<arm>`. Outside the test, or if that offering is
  missing, it falls back to the current offering, then `default` (`selectOffering` in `lib/pricing.ts`).
  The app never hardcodes a price; it shows the store's `priceString`.
- `premium_viewed` carries `variant` (the arm). Admin, Experiments page, `plus_price` card shows per arm:
  people, plans-screen installs, Plus subscriptions started, and Plus per viewer.

## Steps before enabling (RevenueCat and the stores)

1. Create a Plus monthly product at each price in Play Console (and App Store Connect for iOS), in INR.
   Existing Plus/Pro products stay as they are.
2. In RevenueCat create offerings `plus_p49`, `plus_p79`, `plus_p99`. Each contains the Plus monthly package
   at that price plus the normal Pro packages (monthly/yearly, and Plus yearly if sold), attached to the same
   entitlements.
3. Check that the webhook maps the new product ids to the Plus tier (`tierFromProductId`).
4. In the admin Experiments page, enable `plus_price` and set the rollout (for example 30%, about 10% per arm).

## Reading the result

Compare `Plus per viewer` per arm. Revenue per viewer (price times rate) is the number to decide on, not the
rate alone. A cheaper arm must convert about 1.6x (79 vs 49) or 2x (99 vs 49) better to break even.
Wait for a few hundred viewers per arm before reading anything into it.

Caveats: people see their arm only from the first paywall visit after the flag loads (flags are cached for an
hour). `variant` is the assigned arm, even if its offering was missing and the fallback was shown, so check
the offerings exist before enabling.

## Alternative: RevenueCat Experiments

RevenueCat can split offerings itself and report revenue, trials and renewals per arm. Pros: store-level
proceeds and renewal tracking, no code. Cons: it assigns on RevenueCat's side, so Waves cannot join arms to
its own funnel (`app_events`, retention), it is a paid-plan feature, and it needs the same three offerings.
Use this flag if you want one dashboard with Waves' own data; use Experiments if renewals and proceeds
matter more.
