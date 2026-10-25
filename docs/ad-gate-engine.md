# Ad gate engine (Free users: create 2nd+ group / export)

Rule: Free needs **6 server credits or a rewarded ad** per gated action. Pro never. Personal expenses never.
The 3rd-5th group-expense interstitial retains its existing pacing; an optional video unit uses the network, session, country and server-flag guards in `adPacingPure.ts`. Logic is pure and unit-tested in
`adGateEngine.ts` (decisions, ledger), `adGateCoordinator.ts` (one sheet at a time), `adGateRunner.ts` (SDK).

## Decision table (`decideGate`)

| Situation                                              | Decision                                  | Logged                       |
| ------------------------------------------------------ | ----------------------------------------- | ---------------------------- |
| Paid, or gate not required (first group)               | allow                                     | -                            |
| Online, our status RPC failed (any point, incl. Watch) | allow, no debt                            | `offline_allowed` (`status`) |
| Online, server credits >= action cost                  | server spend, toast "Used 6 credits"      | `credit_used`                |
| Online, no credit                                      | sheet: Watch ad (ad pays for this action) | `shown` / `completed`        |
| Offline, first group (0 local groups)                  | allow, never uses a pass                  | -                            |
| Offline, < 2 passes in rolling 7 days                  | allow (free "offline pass")               | `offline_allowed` (`pass`)   |
| Offline, pass cap reached                              | sheet "Connect to the internet to ..." OK | `offline_capped`             |
| Ad fails, no-fill x3                                   | allow, no debt                            | -                            |
| Ad fails, strong blocker evidence                      | "The ad seems blocked" + Retry + Pro link | `blocked_adblock`            |
| Ad fails otherwise                                     | "Check your internet" + Retry             | `failed`                     |

## Ledger (AsyncStorage `waves.adLedger.<profileId>`, best-effort)

`{ credits (legacy, ignored), passes[], hw, declines[], offerPlacement }`. Storage errors never block an action.
Clock safety: `hw` is the highest time ever seen; effective now = max(now, hw), so a backwards jump grants
nothing and future-dated passes count as used. Residual: a forward jump while offline can free expired passes
(max 2 free actions; no server clock available).

## Earning credits

After an offline pass, once the phone is online, **once per session per profile**: "Get a free group or
export / Watch a short ad to earn +6 credits." (Watch ad, X, Pro link). Only a confirmed SSV server grant earns credits (`credit_earned`).
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

## Credits

The server `credit_ledger` is the only spendable wallet: credits never expire,
wallet cap 30. One SSV-confirmed ad earns up to 6 credits; AI voice costs 1,
receipt scan 2, export 6, and an additional group 6. Monthly free allowances
are used first; Pro/trial bypass ads and spending. Statement import stays Pro-only.
A scan spend adds one scan to the current UTC month's allowance; unused scan
allowance bought this way lapses at month end, while unspent wallet credits remain.

Online gates use the server balance and `waves_spend_credits` before offering
an ad. Missing credit APIs/keys keep the legacy ad flow; failed or unknown spend
responses allow the action and log `offline_allowed` with detail `status`.
**Credits are never spent offline.** Existing offline passes remain unchanged;
the old local cap-one credit field is parsed for compatibility but ignored.
On-the-spot group/export rewarded ads still unlock only that action and grant no
wallet credits, avoiding charging and rewarding the same action twice.

The back-online offer has an explicit reward/close intro and uses rewarded
interstitial SSV `credit:offer`. Settings uses plain rewarded `credit:voluntary`;
voice uses `credit:voice`, scans `credit:gate`. The app polls the server wallet
and never grants locally. Server caps control availability (including voluntary
caps); each tap requests just one ad. Missing wallet APIs hide Settings → Credits.
