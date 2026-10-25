# Ad gate engine (Free users: create 2nd+ group / export)

Rule: Free needs **1 credit or a rewarded ad** per gated action. Pro never. Personal expenses never.
The 3rd-5th group-expense interstitial (`adPacingPure.ts`) is unchanged. Logic is pure and unit-tested in
`adGateEngine.ts` (decisions, ledger), `adGateCoordinator.ts` (one sheet at a time), `adGateRunner.ts` (SDK).

## Decision table (`decideGate`)

| Situation                                              | Decision                                   | Logged                         |
| ------------------------------------------------------ | ------------------------------------------ | ------------------------------ |
| Paid, or gate not required (first group)               | allow                                      | -                              |
| Online, our status RPC failed (any point, incl. Watch) | allow, no debt                             | `offline_allowed` (`status`)   |
| Online, credit >= 1                                    | consume it, toast "Used 1 free credit"     | `credit_used`                  |
| Online, no credit                                      | sheet: Watch ad (ad pays for this action)  | `shown` / `completed`          |
| Offline, first group (0 local groups)                  | allow, never uses a pass                   | -                              |
| Offline, < 2 passes in rolling 7 days                  | allow (free "offline pass")                | `offline_allowed` (`pass`)     |
| Offline, pass cap reached                              | sheet "Connect to the internet to ..." OK  | `offline_capped`               |
| Ad fails, no-fill x3                                   | allow, no debt                             | -                              |
| Ad fails, strong blocker evidence                      | "The ad seems blocked" + Retry + Pro link  | `blocked_adblock`              |
| Ad fails otherwise                                     | "Check your internet" + Retry              | `failed`                       |

## Ledger (AsyncStorage `waves.adLedger.<profileId>`, best-effort)

`{ credits (cap 1), passes[], hw, declines[], offerPlacement }`. Storage errors never block an action.
Clock safety: `hw` is the highest time ever seen; effective now = max(now, hw), so a backwards jump grants
nothing and future-dated passes count as used. Residual: a forward jump while offline can free expired passes
(max 2 free actions; no server clock available).

## Earning credits

After an offline pass, once the phone is online, **once per session per profile**: "Get a free group or
export / Watch a short ad to earn 1 credit." (Watch ad, X, Pro link). Completed ad = +1 credit (`credit_earned`).
Dismiss = nothing (`owed_declined`); offers stop after 3 declines in 7 days. Never shown over another sheet.

## Blocker evidence

"Blocked" only when online, our backend answered, **and** the SDK text shows a sinkhole (`0.0.0.0`, `127.0.0.1`,
`::`) or "unable to resolve host" for a Google ad host, and the `pagead2` probe does not reach it. Timeouts or
fetch failures alone are "Check your internet".

## Safety

- Watchdog: 90 s after show with no terminal SDK event, or 5 s after returning to foreground, settles as
  failed (completed if the reward was earned); Close is never stuck.
- Coordinator: one lease at a time across all hooks (export, new group, credit offer); account switch
  invalidates in-flight checks and drops the sheet. Entitlement is re-checked before showing.

## Schema

Migration `20261028120000_ad_credits_outcomes` adds `credit_used`, `credit_earned`, `offline_capped` to the
`ad_events` CHECK and admin counts (**written, not applied**). Until applied the server answers `23514` and
the client drops those rows.
