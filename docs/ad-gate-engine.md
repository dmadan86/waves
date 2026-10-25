# Ad gate engine (Free users: create group / export)

Owner's intent: offline users must never be stopped by an ad; real ad blockers must be named;
when the phone comes back online the owed ad is shown by default; never a nuisance.

## Signals (no new native module)

- **Offline** = `expo-network` `getNetworkStateAsync()`: `isConnected === false` or
  `isInternetReachable === false` (Android: `NET_CAPABILITY_VALIDATED`; iOS: equals `isConnected`).
  Airplane mode gives `isConnected: false` on both. Same check the sync engine already uses.
- **Control host** = our own backend: `waves_my_ad_gate_status` answered a moment before the ad load.
- **Ad blocker** (only judged when online and the control succeeded) =
  SDK error code `network-error` **and** either the message names a DNS sinkhole
  (`0.0.0.0`, `127.0.0.1`, `unable to resolve host` — the owner's AdGuard Private DNS case) **or**
  a 3 s `fetch('https://pagead2.googlesyndication.com/pagead/gen_204')` throws (any HTTP status =
  reachable). Covers DNS blockers (AdGuard/NextDNS/Pi-hole), VPN blockers (AdGuard app, Blokada) and
  iOS DNS profiles. iOS content blockers do not affect apps. Known false positive: networks that
  block Google entirely (corporate filters, China) — ads cannot be served there anyway.
- **No fill** = SDK code `no-fill` / `timeout` / `internal-error` with the ad host reachable.

## Decision table (`apps/mobile/src/lib/adGateEngine.ts`, pure, unit-tested)

| Situation                                   | Decision                                                                                    | Logged outcome                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Paid, or gate not required (first group)    | allow                                                                                       | —                                    |
| Free, offline                               | allow now, **owe 1 ad**                                                                     | `offline_allowed` (detail `offline`) |
| Free, online, status RPC failed             | allow now, owe 1 ad (never hard-block on our backend)                                       | `offline_allowed` (detail `status`)  |
| Free, online, ad loads                      | watch, then proceed (as today)                                                              | `shown` / `completed`                |
| Free, online, ad fails: blocked             | stay blocked: "The ad seems blocked — Turn off ad blocking or Private DNS", Retry, Pro link | `blocked_adblock`                    |
| Free, online, ad fails: no fill ×3 in a row | allow now, owe 1 ad (AdMob has no inventory; don't trap the user)                           | `offline_allowed` (detail `nofill`)  |
| Free, online, ad fails otherwise            | "The ad could not load / try again" + Retry (fail-closed, as today)                         | `failed`                             |
| Connectivity lost mid-attempt               | allow now, owe 1 ad                                                                         | `offline_allowed`                    |

## Owed ad ("ad debt")

- Stored in AsyncStorage `waves.adOwed.<profileId>` as `{ placement, createdAt, prompts }`. **Cap 1**:
  a second offline action never adds a second debt.
- Offered in the same ad sheet (illustration → "Watch a short ad" → one line → Watch ad → Pro link),
  body: "You created this offline. A short ad keeps Waves free." Triggered on app launch, app
  foreground and network→online, only when online, Free, no gate running. **Once per session.**
- **Skippable (recommended):** Google's rewarded-ad policy requires an affirmative opt-in and says
  declining "must not impede normal usage"; the group already exists, so there is nothing to lock.
  Closing the sheet counts as a decline. After **3 declines or 7 days** the debt is dropped
  silently. A completed ad clears it. Going Pro clears it. Blocked/no-fill while owed: show the
  same copy as the live gate; debt stays, next prompt is next session (backoff).
- Logged: `owed_offered`, `owed_declined`; the watch itself logs `shown`/`completed`/`skipped` as usual.

## Logging and schema

`ad_events.outcome` has a CHECK of five values. Migration
`packages/db/prisma/migrations/20261027120000_ad_gate_engine_outcomes` widens it with
`offline_allowed`, `owed_offered`, `owed_declined`, `blocked_adblock` and adds those counts to
`waves_admin_ad_events` (**written, not applied**). Until it is applied the server rejects the new
values with `23514`; the client outbox drops such a row instead of stalling behind it.

## Unchanged

The 3rd–5th group-expense interstitial (`adPacingPure.ts`): never offline, never owed.
Pro/paid never see anything. Personal expenses never show ads.
