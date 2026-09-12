# Notifications and email: what exists, what should, and where each one runs

A research document, not a build. It answers four questions: what this app can
produce today and which of it reaches a person; what belongs on the device; what
belongs on the server; and what belongs in a mailbox, at what cadence.

Nothing here contradicts `docs/plan-recurring-money-events.md` (merged) or
ADR-010 / TDR §7. Where it goes further than either, it says so.

---

## 0. The three findings that matter

1. **Most of the notification system is written and delivered to nobody.**
   Twenty-two `kind`s have copy in four languages; eleven of them have a
   producer in SQL; and of those eleven, **six can currently reach a person only
   by email, and five reach nobody at all.** Push has never delivered a message
   on this project — `push_tokens` has been empty since the fanout was first
   scheduled, no `apps/mobile/google-services.json` exists in this checkout, and
   the iOS APNs key is recorded as not done (`README.md`, "Turning on push").
   The in-app Inbox screen that used to be the fallback was removed in #565. So
   a `settlement_confirmed`, an `expense_disputed`, a `ghost_claim_approved` or a
   trip nudge is written to `notifications`, marked `push_status = 'failed'`
   terminally by the claim (no live token is a _decision_, not a retry), never
   mailed (not on the email whitelist), and never seen.

2. **The most obvious notification in an expense-splitting app does not exist.**
   `expense_added`, `expense_edited`, `expense_deleted` and `you_owe` have copy,
   a preference switch that governs them (`waves_pref_key_for_kind` →
   `involvesMe`), a renderer and tests — and **no producer anywhere**. Nothing in
   `expense-write`, `sync`, or any SQL function calls `waves_notify` for an
   expense. The same is true of `settlement_initiated` (which has an _email
   template_), `digest_daily` (also with a template), `group_invite_accepted` and
   `ghost_claimed`. The complete producer list is eleven functions and is given
   in §2.3.

3. **Not one local notification is scheduled anywhere.** There is no
   `scheduleNotificationAsync` call in the repo. `expo-notifications` is used
   only to ask permission, fetch a push token, and route a tap
   (`apps/mobile/src/lib/push.ts`). Everything proposed for the private ledger in
   §4 is greenfield on the device — and, unlike the server half, needs no
   credential, no migration and no cron.

---

## 1. The rule that decides local vs server

> **Anything derived from the private personal ledger is scheduled on the
> device. It never becomes a `notifications` row.**

This is the user's instruction and it is also what the architecture already says.
`personal_records` (`packages/db/prisma/schema.prisma`) stores one opaque `data`
jsonb per record; `supabase/functions/sync/index.ts` validates only that
`recordId` is a string and `recordKind` is one of four, then stores the blob
verbatim. The schema comment is explicit: the server relays this data and never
reads the shape of a row. On the device the same columns are sealed at rest (A48)
and sign-out is a crypto-erase.

A server-sent "your rent is due" requires three reversals of that at once:

- a Postgres job must **read inside the blob** to know a rule is due;
- `notifications.title` and `.body` are **plaintext columns**, read by the
  fanout, by `waves_claim_email_notifications` (which resolves the recipient's
  address), and by anyone with operator access — so "Rent ₹25,000 due on the 5th"
  would sit in a shared table;
- `waves_claim_email_notifications` would then be one whitelist entry away from
  mailing it.

So the rule is not a preference. It is the property the Me tab exists to have.

**Applied consistently, it also catches things that are not obviously "personal
finance":**

| data                                           | where it lives                                           | verdict                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| personal txns, recurring rules, loans, budgets | opaque blob, `personal_records`                          | **local only**                                                                                       |
| captures (an expense with no group yet)        | `captures`, plaintext, but scoped to one `owner_user_id` | **local** — it is one person's unfiled spending, and the server has no second party with an interest |
| group expenses, balances, settlements, invites | shared, multi-party by construction                      | **server** — the other party is the reason the notification exists                                   |
| device sign-in, account security               | account-level                                            | **server** — must reach a phone the person may no longer hold                                        |

### The cost of choosing local, stated plainly

A local notification only exists on a device that has opened the app since the
thing was scheduled, and only on **that** device. A rule created on a phone does
not remind on a tablet until the tablet is opened. If the person reinstalls, the
schedule is gone until the app runs again.

That is the trade: **reliability for privacy**. It bites in exactly three places —

- **a new phone.** Sign in, and every local reminder is missing until the app
  syncs and reschedules. Mitigation: reschedule on mount, on foreground, and on
  any ledger change (the `AutoBackup` pattern, §4.0).
- **a person who stops opening the app.** They stop being reminded to open the
  app. There is no server safety net, by design.
- **iOS's ceiling of 64 pending local requests per app.** Beyond it the OS drops
  requests with no error, which looks exactly like "reminders stopped". Cap below
  it and re-sync on every foreground.

None of these apply to the shared ledger, which is why the shared ledger stays on
the server.

---

## 2. Inventory: what exists today

### 2.1 The pipeline, and where each piece lives

```
an RPC or a cron job ──► waves_notify(profile, group, kind, title, body,
                          deep_link, payload, dedupe_key)
                          INSERT into `notifications`, ON CONFLICT (dedupe_key) DO NOTHING
        │
        ├── AFTER INSERT statement trigger ──┐  (latency only; swallows every error)
        └── pg_cron `waves-notify-fanout`, */5 ┴─► notify-fanout edge function
                  1. waves_claim_push_notifications(200)  — UPDATE, FOR UPDATE SKIP LOCKED
                  2. render in the reader's language      — @waves/core
                  3. POST https://exp.host/--/api/v2/push/send in chunks of 100
                  4. waves_finish_push(delivered, failed, revoke)
                  5. dispatchEmail → waves_claim_email_notifications(25) → Resend
                                   → waves_finish_email(results)
```

| piece                        | file                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| write a row                  | `waves_notify`, `packages/db/prisma/migrations/20260904000000_waves_baseline/migration.sql:4600` (SECURITY DEFINER, service_role only)                                   |
| instant poke                 | `waves_notify_fanout_trigger`, `…/20260904180000_fanout_trigger_url/migration.sql:21-73` — reads Vault `service_role_key` + `functions_base_url`, refuses non-`https://` |
| claim for push               | `waves_claim_push_notifications`, baseline `:2120`; replaced in `…/20260908120000_settlement_notices_and_push_prefs/migration.sql` to read the prefs                     |
| claim for email              | `waves_claim_email_notifications`, baseline `:2001`; replaced in `…/20260907090000_device_alert_and_weekly_digest/migration.sql`                                         |
| close out                    | `waves_finish_push`, baseline `:3141` — 3 attempts, +3 min then +9 min, terminal on the third; revokes `DeviceNotRegistered` tokens                                      |
| build the messages           | `packages/core/src/notifications/push.ts`                                                                                                                                |
| the words                    | `packages/core/src/notifications/copy.ts` (en/ta/hi/ar), rendered by `render.ts` against `profiles.locale` — **not** the device's current language                       |
| the facts a message may name | `factsOf`, `supabase/functions/_shared/email.ts:355`                                                                                                                     |
| what may be mailed           | `TEMPLATE_FOR_KIND`, `packages/core/src/notifications/email.ts`                                                                                                          |
| send the mail                | `sendVia` / `sendEmail`, `supabase/functions/_shared/email.ts`                                                                                                           |
| the way out                  | `supabase/functions/email-unsubscribe/index.ts` (signed address, POST only — a GET renders a button, because corporate scanners follow links)                            |
| bounces and complaints       | `email-events` → `email_suppressions`                                                                                                                                    |
| device side                  | `apps/mobile/src/lib/push.ts`; `apps/mobile/src/app/_layout.tsx` (handler ~`:98`, `PushRouting` ~`:350-378`)                                                             |
| the switches                 | `apps/mobile/src/app/settings/notifications.tsx`; `apps/web/src/app/settings/page.tsx:137-146`                                                                           |

Two properties worth keeping when anything is added:

- **`dedupe_key` is what makes every job re-runnable.** Every producer builds one
  from (event, recipient, and a date where the event repeats).
- **`routeForNotification` switches on `data.url`, not on `kind`**
  (`apps/mobile/src/lib/push.ts:192`). It strips `waves://` and hands the rest to
  the router. A new kind therefore costs **nothing** on the tap side, as long as
  its deep link is a route the app already has.

### 2.2 What it costs to add one server kind

Four hand-maintained lists that no test forces into agreement:

1. `NotificationKind` + four copy tables — `packages/core/src/notifications/copy.ts`
2. `waves_pref_key_for_kind` — which switch silences it
3. `TEMPLATE_FOR_KIND` — whether it may be mailed
4. the inline `n.kind IN (…)` inside `waves_claim_email_notifications`

Plus `factsOf` if the copy names a new placeholder. A local notification costs one
copy string.

### 2.3 Every kind: producer, transport, and whether it reaches a person

_Live_ means somebody receives it today. _Written, undelivered_ means a row is
created and nothing carries it. _Designed only_ means no producer exists.

| kind                              | producer                                                                                                            | push pref               | email                                                                | status today                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `expense_added`                   | **none**                                                                                                            | `involvesMe`            | never                                                                | **designed only** — copy + prefs + tests, no writer        |
| `expense_edited`                  | **none**                                                                                                            | `involvesMe`            | never                                                                | designed only                                              |
| `expense_deleted`                 | **none**                                                                                                            | `involvesMe`            | never                                                                | designed only                                              |
| `you_owe`                         | **none**                                                                                                            | `involvesMe`            | never                                                                | designed only                                              |
| `ghost_claimed`                   | **none**                                                                                                            | `involvesMe`            | never                                                                | designed only                                              |
| `group_invite_accepted`           | **none**                                                                                                            | `involvesMe`            | never                                                                | designed only — joining a group tells the inviter nothing  |
| `digest_daily`                    | **none**                                                                                                            | `groupActivityDigest`   | `digest` template **and** on the SQL whitelist                       | **designed only** — a mail template with no producer       |
| `settlement_initiated`            | **none**                                                                                                            | `settlementRequests`    | `settlement-confirm` + whitelisted                                   | **designed only** — ADR-010's flagship email has no writer |
| `settlement_confirm_request`      | `waves_record_settlement` (`20260908120000…:197`)                                                                   | `settlementRequests`    | `settlement-confirm` + whitelisted                                   | **live, by email only**                                    |
| `settlement_confirmed`            | `waves_settlement_notify` trigger (`20260908120000…:260`); `waves_auto_confirm_settlements` (`20260910100000…:728`) | `settlementRequests`    | not whitelisted                                                      | **written, undelivered**                                   |
| `settlement_cancelled`            | `waves_settlement_notify` (`:282`)                                                                                  | `settlementRequests`    | not whitelisted                                                      | written, undelivered                                       |
| `settlement_disputed`             | `waves_settlement_notify` (`:303`)                                                                                  | `settlementRequests`    | not whitelisted                                                      | written, undelivered                                       |
| `nudge`                           | `waves_nudge_to_settle` (baseline `:4780`)                                                                          | `nudges`                | `nudge`, **only when no live token**                                 | **live, by email** (because there are no live tokens)      |
| `trip_nudge_morning` / `_evening` | `waves_trip_nudges` (`20260910100000…:639`), cron `waves-trip-nudges`, twice daily in the **group's** timezone      | `nudges`                | not whitelisted                                                      | written, undelivered                                       |
| `expense_disputed`                | `waves_dispute_expense` (baseline `:2821`)                                                                          | `involvesMe`            | not whitelisted                                                      | written, undelivered                                       |
| `expense_dispute_resolved`        | `waves_resolve_dispute` (baseline `:5916`)                                                                          | `involvesMe`            | not whitelisted                                                      | written, undelivered                                       |
| `ghost_claim_requested`           | `waves_request_member_claim` (baseline `:5790`)                                                                     | `involvesMe`            | not whitelisted                                                      | written, undelivered                                       |
| `ghost_claim_approved`            | `waves_decide_member_claim` (baseline `:2525`)                                                                      | `involvesMe`            | not whitelisted                                                      | written, undelivered                                       |
| `ghost_claim_declined`            | `waves_decide_member_claim` (baseline `:2462`)                                                                      | `involvesMe`            | not whitelisted                                                      | written, undelivered                                       |
| `group_added`                     | `waves_add_ghost_member` (baseline `:413`)                                                                          | `involvesMe`            | `group-added`, only once push is terminal                            | **live, by email**                                         |
| `new_device_login`                | `waves_register_device` (`20260907090000…:96`)                                                                      | none — never suppressed | `new-device`, **always**, ignores the `email` switch, no unsubscribe | **live, by email**                                         |
| `digest_weekly`                   | `waves_enqueue_weekly_digest` (`20260907150000…:100`), cron `waves-weekly-digest`, Mon 03:30 UTC                    | `groupActivityDigest`   | `digest` + whitelisted                                               | **live, by email, opt-in** (`weeklyEmail` defaults false)  |

Beyond `notifications` there are two other mail paths:

| path                                                                                             | what it is                                                       | status                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **auth mail** — GoTrue SMTP via Resend, `[auth.email.smtp]`, templates in `supabase/templates/`  | the sign-in code, sign-up confirmation, address change           | live. Configured in a _completely different place_ from product mail: `config push`, not `supabase secrets set`.      |
| **campaign mail** — `campaign-broadcast` + `waves_claim_campaign_emails` + `renderCampaignEmail` | admin-composed marketing to a cohort, holdout excluded (TDR A21) | built; sends only when an admin runs a campaign. Carries the `promoReason` footer and the same one-click unsubscribe. |

### 2.4 Local notifications

None. `grep scheduleNotificationAsync` returns nothing. What exists on the device
is:

- `pushSupported` — iOS/Android only; `expo-notifications` throws on web.
- one Android channel, `default`, at `DEFAULT` importance (`ensureAndroidChannel`)
  — which on Android means **no heads-up banner**.
- `enablePush()` — permission → `getExpoPushTokenAsync({ projectId })` → upsert
  into `push_tokens`. It needs `expoConfig.extra.eas.projectId` **and** real
  FCM/APNs credentials; without them it returns `NotConfigured`, and the settings
  screen says so rather than sending the person to their phone settings over a
  problem that is ours.
- the soft ask, `apps/mobile/src/components/NotificationPrompt.tsx` — shown once,
  only to a signed-in person on a real device whose permission is `undetermined`,
  behind the shared prompt queue at priority 80. "Not now" is remembered forever
  and the OS dialog is never raised.
- `routeForNotification` plus both tap paths (cold start via
  `getLastNotificationResponseAsync`, warm via
  `addNotificationResponseReceivedListener`) in `_layout.tsx`.

The closest things to a scheduled local reminder are **not** notifications:
`lib/backup/AutoBackup.tsx` checks on foreground and on mount with a 5-minute
throttle and explicitly refuses to be a background task; `lib/tips.ts` rotates one
dashboard tip a day; `lib/backup/restorePrompt.ts` is the pattern to copy for
"should this fire at all" — a pure function whose every condition is a reason
_not_ to speak.

### 2.5 So what actually reaches a person today

- **By email, reliably:** a new-device sign-in; a settle-up confirmation request;
  being added to a group; a nudge; the weekly digest for anyone who turned it on.
  All five require `waves_email_for` to return an address — which needs
  `auth.users.email_confirmed_at IS NOT NULL`. **A phone-OTP account has no email
  and therefore receives nothing at all today.**
- **By push:** nothing.
- **In the app:** nothing. There is no inbox screen (#565).

Everything else in §2.3 is a row in a table.

---

## 3. Three constraints that shape every answer below

**a. The email whitelist is deliberately two lists in two files, and they must
agree.** `TEMPLATE_FOR_KIND` in `packages/core/src/notifications/email.ts`, and
the inline `n.kind IN (…)` inside `waves_claim_email_notifications` (current body
in `…/20260907090000_device_alert_and_weekly_digest/migration.sql`). ADR-010 says
the duplication is the point: "widening it is a change somebody has to make in SQL
and mean". The failure mode when they drift is handled but ugly — `dispatchEmail`
logs `no email template for kind X` and marks the row `failed`, permanently
(`supabase/functions/notify-fanout/handler.ts`). **Every email proposed in §5 is
checked against both lists and flagged if it needs them widened.**

**b. `factsOf` is a whitelist too** (`supabase/functions/_shared/email.ts:355`).
It names the placeholders a message may interpolate: `amount`, `currency`,
`counterparty`, `group` (aliasing `group_name`), `description`, `count`, `device`,
`name` (aliasing `ghost_name`). A fact missing from it does not throw —
`interpolate` leaves the placeholder, and somebody receives _"New sign-in on
{device}"_. That shipped once. It used to exist as two identical copies, in
`notify-fanout/handler.ts` and in `_shared/email.ts`; it is now one exported
function imported by both the push half and the email half, and **it must stay
that way** — two whitelists that must agree is a bug waiting for somebody to add a
fact to the half they happened to be reading. Any new copy string that names a new
placeholder needs a line here or it renders the brace.

**c. Everything the fanout carries is rendered from `profiles.locale`**, not the
device language, and amounts are formatted at send time from minor units. A local
notification has the opposite property: the text is baked into the OS alarm at
schedule time, so **a language change must invalidate the schedule** — put the
locale in the diff key.

---

## 4. Candidates

Each entry: what it says · what fires it · local or server and why · worst-case
frequency · what cancels it · whether it is worth building.

### 4.0 The device-side shape everything local shares

Proposed once so the candidates can refer to it:

- a pure planner in `@waves/core` — "given these records and today, what reminders
  are owed inside the horizon" — no `Date.now()`, no timezone maths beyond string
  arithmetic; the `restorePrompt.ts` doctrine;
- a diff (`toCancel` / `toSchedule`) against
  `Notifications.getAllScheduledNotificationsAsync()`, matched on
  `content.data.key`, so foregrounding does not churn dozens of OS alarms;
- a headless component mounted beside `<AutoBackup />` inside the auth and lock
  gates, firing on mount, on `AppState → active`, and on a debounced ledger
  change;
- `ensureLocalNotificationPermission()` in `lib/push.ts` — `getPermissions` →
  `requestPermissions` → `ensureAndroidChannel`, **no project id and no token**,
  asked at the moment a toggle is turned on, never at launch;
- a second Android channel at `HIGH` importance for money reminders, because
  `default` produces no heads-up banner;
- **sign-out cancels every scheduled local notification.** Sign-out is already a
  crypto-erase of the mirror; leaving "Did the rent come in?" on the lock screen
  of a phone nobody is signed in on leaks the ledger that was just erased;
- a global cap (**48**, under iOS's 64) applied across _all_ local kinds together,
  not per feature — two features each capping at 48 is 96.

### 4.1 LOCAL — personal recurring money due

**Says:** "Did the rent come in?" / "Did you pay the rent?" — the thing named, the
**amount deliberately omitted** (a lock screen is the one place this ledger is
readable without the biometric gate).
**Fires:** a `PersonalRecurring` rule with its reminder on, at its own time of day,
on the occurrence date.
**Local, because** it is §1 in its purest form. Designed in detail in
`docs/plan-recurring-money-events.md` §5; that plan is merged and this document
does not change it.
**Worst case:** one per due occurrence per rule. Twelve monthly rules is twelve a
month.
**Cancelled by:** the occurrence being recorded (a claimed occurrence must not
ask), the rule being paused, deleted or past `endDate`, the toggle going off,
sign-out.
**Worth it:** **yes — the highest-value thing on the list**, because it is the only
candidate where the notification _is_ the feature. Everything else notifies about
something the app already did.

### 4.2 LOCAL — budget nearly spent

**Says:** "You have spent 90% of your Food budget this month." No figure unless the
user opts in.
**Fires:** a device check when a personal txn is written, throttled to at most one
per budget per month per threshold.
**Local, because** `PersonalBudget` and the txns it is measured against are both in
the opaque blob. `personalBudgetProgress` in
`packages/core/src/personal/compute.ts` already computes it; nothing surfaces it
outside the screen.
**Worst case:** thresholds at 80% and 100% → two per budget per month.
**Cancelled by:** the month rolling over (the key carries the month), the budget
being deleted or raised past the threshold, the toggle.
**Worth it:** yes, **after 4.1** — it fires on save rather than on a schedule, which
makes it cheap once the permission and channel plumbing exists.

### 4.3 LOCAL — unassigned captures waiting

**Says:** "3 captures are still waiting for a group."
**Fires:** a device check that N `captures` rows have `status = 'open'` and the
oldest is older than a day.
**Local, because** a capture belongs to exactly one `owner_user_id` and no second
party has an interest in it — the same privacy claim as the ledger, even though
the bytes are not opaque. There is an in-flight branch, `feat/captures-local-nudge`;
at the time of writing it has no commits ahead of `main`, so treat it as intent
rather than code.
**Worst case:** cap at **one a week**. This is tidying, not money.
**Cancelled by:** the captures being assigned or deleted; the count reaching zero.
**Worth it:** yes, but low — it is the first candidate a person would mute if it
spoke often.

### 4.4 LOCAL — backup has not run in a long time

**Says:** "Your last backup was 6 weeks ago."
**Fires:** `AutoBackup`'s existing foreground check already computes `isDue`
(`lib/backup/schedule.ts`); this is the case where it is due, has been due for a
long time, and the run keeps failing.
**Local, because** the backup is of the private ledger and its timestamp lives in
AsyncStorage under the owner's id. The server does not know a backup exists.
**Worst case:** once a month. More is nagging about a setting the person chose.
**Cancelled by:** a successful backup; the person turning the schedule off
deliberately — _off_ is an answer, not a fault.
**Worth it:** **marginal.** It is a notification about the app's own housekeeping.
Prefer a dashboard strip; revisit only if people actually lose data.

### 4.5 SERVER — someone added an expense to your group

**Says:** "{actor} added an expense · {description} · {amount} in {group}".
**Fires:** a successful expense write.
**Server, because** the other members are the point; it is not one person's data,
and the whole ledger is already on the server.
**Worst case:** this is the dangerous one. Five people adding on a trip evening is
five buzzes each. ADR-010 already asks for collapse keys — "5 rapid expenses in one
group become one updated notification, not five" — and nothing implements it.
Proposal: a **per (recipient, group) coalescing window** implemented as a
`dedupe_key` carrying the group and a rounded time bucket (15 minutes), with the
body counting the expenses in it. Cheaper alternative: notify only when **you are
on the expense** (payer or share), which is what `involvesMe` literally means and
is exactly the discriminator the weekly digest was narrowed to in
`…/20260907150000_weekly_digest_involved_people/migration.sql`.
**Cancelled by:** the `involvesMe` switch. Note that nothing today withdraws a
notification for an expense deleted before the fanout claims it.
**Worth it:** **yes, and it is the biggest product gap** — but only in the
"involves me" form, and only with coalescing. Shipping the naive form is how the
app becomes the thing ADR-010 was written against.

### 4.6 SERVER — someone settled up with you (already built, undelivered)

`settlement_confirm_request` (live by email), `settlement_confirmed`,
`settlement_cancelled`, `settlement_disputed`. All four have producers; three of
them reach nobody.
**Worst case:** bounded by human action — one per settlement transition.
**Cancelled by:** the `settlementRequests` switch.
**Worth it:** **yes, and it needs no new code** — it needs push to work (§7). The
single highest value-per-effort item in this document: four notifications already
written, tested and translated, waiting on a Firebase key.

### 4.7 SERVER — someone owes you and has not paid

Two different things, and only one exists:

- **a person-initiated nudge** — `waves_nudge_to_settle`, live, rate-limited to one
  per pair per day by a trigger (`waves_nudge_rate_limit`) _and_ by a
  per-pair-per-day `dedupe_key`, and refusing to send when the balance is not
  actually owed. Nothing to build.
- **an automatic reminder** — the `reminders` table carries `due_date` and `auto`
  and **nothing fires them** (ADR-010 says so outright). This would be a new cron
  job shaped like `waves_trip_nudges`.
  **Worth it:** **no, not yet.** Automatic dunning is the most mutable thing an
  expense app can send, and it needs a per-user quiet hour (§7) that does not
  exist. Revisit once push works.

### 4.8 SERVER — a group invite accepted

`group_added` exists and is live by email. What does **not** exist is
`group_invite_accepted` — the person who sent the invite learns nothing when it is
accepted — and `ghost_claimed` is likewise unproduced.
**Worst case:** one per join.
**Cancelled by:** the `involvesMe` switch.
**Worth it:** **yes, cheap.** One `waves_notify` call in the invite-accept path,
reusing copy that is already translated in four languages. It is the notification
an inviter actually waits for.

### 4.9 SERVER — trip starting / ending

Today `waves_trip_nudges` covers _during_ a trip (morning about yesterday, evening
about today, in the **group's** timezone, skipping anyone who already recorded that
day). Missing: the two ends.

- **starting tomorrow** — "Goa trip starts tomorrow. Set a budget?" Once per group
  per trip.
- **ended, settle up** — "Goa trip ended. You are owed ₹3,400 across 4 people."
  Once, the morning after `end_date`. This is the moment a splitting app is most
  useful and the one it currently stays silent through.

**Server, because** `groups.start_date`, `end_date` and `time_zone` are shared
server data.
**Worst case:** two per trip. Naturally capped.
**Cancelled by:** the `nudges` switch; the group being archived or deleted — the
trip-nudge job already learned that lesson the hard way (a deleted trip went on
pushing twice a day until `…/20260910100000…` fixed it).
**Worth it:** **yes for "trip ended", strongly.** "Trip starting" is pleasant and
optional.

### 4.10 SERVER — month-end summary

A monthly counterpart to `digest_weekly`. Discussed as email in §5; as a _push_ it
is redundant with the mail. **Not worth building as a notification.**

### 4.11 SERVER — new device sign-in

Exists, live, correctly carved out of every switch, correctly mailed without an
unsubscribe link. Nothing to do. Worth naming only because it is the one kind that
must never be folded into a "notifications off" setting.

### 4.12 Ranked

A shorter list people keep switched on is worth more than a complete one they mute.

| #   | candidate                                      | where     | why here                                                      |
| --- | ---------------------------------------------- | --------- | ------------------------------------------------------------- |
| 1   | settlement transitions (4.6)                   | server    | already built; only the transport is missing                  |
| 2   | personal recurring due (4.1)                   | **local** | the only candidate where the notification _is_ the feature    |
| 3   | trip ended → settle up (4.9)                   | server    | the highest-intent moment in the product, currently silent    |
| 4   | expense added, _involving me_, coalesced (4.5) | server    | biggest gap, biggest spam risk — with the window, not without |
| 5   | invite accepted (4.8)                          | server    | one call, copy already translated                             |
| 6   | budget threshold (4.2)                         | **local** | cheap once 4.1's plumbing exists                              |
| 7   | trip starting (4.9)                            | server    | pleasant, optional                                            |
| 8   | unassigned captures (4.3)                      | **local** | weekly at most, or it is the first one muted                  |
| 9   | backup stale (4.4)                             | **local** | prefer an in-app strip                                        |
| —   | automatic dunning (4.7)                        | server    | **do not build yet** — needs quiet hours                      |
| —   | month-end push (4.10)                          | —         | **do not build** — it is an email                             |

---

## 5. Email, and the cadence question

Email is for two populations and two moments: **people who are not holding the
phone** (or have push off, or have no push at all — which today is everybody), and
**things that are worth reading when you are not in the app.** ADR-010's constraint
stands: routine ledger activity is never mailed; that is the mistake that trains
people to filter the sender.

### 5.1 The direct answer to "daily, weekly or monthly?"

**There is no single answer, and a blanket cadence is the wrong shape.** The rule
that produces the right answer per type is:

> Cadence should match **the rhythm of the thing being reported**, not a schedule
> chosen for the sender. A ledger that is squared up monthly should not be
> summarised daily; a trip that lasts four days cannot be summarised weekly.

Concretely: **weekly is the right default for the recurring summary, monthly should
be offered, and daily should not exist.** Daily digest mail is the Splitwise
failure mode — and note that `digest_daily` already exists with a template and has
deliberately never been given a producer. That omission should stay.

### 5.2 Per type

| #   | email                                                     | contains                                                | cadence                                                                        | reasoning                                                                                                                                                                                                                                                                                                                       | whitelist                                                                    |
| --- | --------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| E1  | **settle-up confirmation request** (`settlement-confirm`) | who says they paid you, how much, one Confirm button    | **immediate**, event-driven                                                    | A question addressed to one person; the ledger is wrong until it is answered. Batching it would be a bug.                                                                                                                                                                                                                       | already on both lists                                                        |
| E2  | **what you owe and are owed**                             | net per currency, top per-person lines, a Settle button | **weekly by default; monthly as an option; never daily**                       | This is the open question. Weekly matches how people square up (a weekend, a payday) and matches the existing `digest_weekly` producer and its Monday 03:30 UTC / 09:00 IST cron. Monthly is right for flatmates on a monthly rhythm and costs one enum value plus one cron line. Daily on a quiet week is six identical mails. | reuse `digest_weekly` — **a monthly variant needs a new kind on both lists** |
| E3  | **group activity digest**                                 | per-group deltas since last time                        | **fold into E2; do not send separately**                                       | Two digests a week is one too many, and the existing digest already nets across groups. If per-group detail is wanted it is a _section_ of E2. `digest_daily`'s template exists for this and should stay producerless.                                                                                                          | none                                                                         |
| E4  | **settle-up reminder / nudge** (`nudge`)                  | who, how much, in which group, friendly tone            | **event-driven, hard-capped at one per pair per day** (already enforced twice) | A reminder is a person's action, not a schedule. The _automatic_ variant (4.7) stays unbuilt until quiet hours exist.                                                                                                                                                                                                           | already on both lists                                                        |
| E5  | **added to a group** (`group-added`)                      | who added you, which group, Open button                 | **event-driven, only once push is terminal**                                   | Already correct. It exists precisely because there is no in-app inbox; the one routine event with no "check the app later" left in it. Do not generalise the fallback to other kinds without deciding case by case.                                                                                                             | already on both lists                                                        |
| E6  | **new-device sign-in** (`new-device`)                     | device label, Review devices button, **no unsubscribe** | **immediate, always, unconditional**                                           | Transactional security mail. Correctly ignores the `email` switch and the push outcome. Leave alone.                                                                                                                                                                                                                            | already on both lists                                                        |
| E7  | **trip recap**                                            | what the trip cost, who owes whom, one Settle link      | **once, the morning after `end_date`**                                         | The only cadence a trip has. A weekly digest that happens to land three days later has lost the moment.                                                                                                                                                                                                                         | **needs both lists widened** — new kind, a `digest`-shaped template          |
| E8  | **month-end personal summary**                            | spend by category, budgets hit, income                  | **never from the server**                                                      | It is the private ledger — §1 with no exception. If wanted at all it is a **local** notification opening an in-app month view, or a file the person exports.                                                                                                                                                                    | n/a — must not be added                                                      |

### 5.3 Checks against the constraints

- **E2-monthly and E7** need a new `kind` in `TEMPLATE_FOR_KIND` **and** in the
  `n.kind IN (…)` list inside `waves_claim_email_notifications`. Adding one and not
  the other produces a permanently `failed` row and a `no email template for kind`
  line in a log nobody reads.
- **E7** wants to name a group and an amount. `factsOf` already carries `group`,
  `amount`, `currency` and `count`. If the recap wants "4 people" it must reuse
  `count`, or `factsOf` gains a key — **it cannot simply be added to the copy
  string.**
- Every non-security mail already carries `List-Unsubscribe` +
  `List-Unsubscribe-Post: One-Click` and a signed unsubscribe URL, built by
  `buildEmail`. A new mail that bypassed `buildEmail` would not, and Gmail/Yahoo
  would junk it.
- The footer reason is chosen per shape — group mail names the group, a digest says
  "you turned on the summary", a security mail says why and offers no way out, a
  campaign says "you use Waves". A new mail that is not about one group must pick
  one of these or it interpolates `{group}` with the app's own name.
- **Deliverability floor:** Resend allows two requests a second, so the fanout
  claims **25** email rows per run and spaces sends by **600 ms** (`EMAIL_BATCH`,
  `SEND_SPACING_MS`) — 300/hour. A monthly digest to a large base needs the batch
  raised or the enqueue spread over hours. Worth knowing before it is a surprise.
- **No email at all reaches a phone-OTP account.** `waves_email_for` requires a
  confirmed address. Any plan that leans on email as the fallback for broken push
  has a hole exactly the size of the phone-signup cohort.

---

## 6. Settings and consent

Today (`apps/mobile/src/app/settings/notifications.tsx`): a device-permission card,
four push switches (`involvesMe`, `settlementRequests`, `nudges`,
`groupActivityDigest`), two email switches (`email`, `weeklyEmail`). The web client
shows the same six as a flat list (`apps/web/src/app/settings/page.tsx:137-146`).
Prefs live as one jsonb blob on `profiles.notification_prefs`; per-group
granularity was considered and not built.

Three problems as the list grows:

1. It mixes three different kinds of switch — _an OS permission_, _a server-side
   delivery preference_, _a device-local schedule_ — under two headings.
2. **"Somebody who wants only _someone paid me_" cannot quite get it.** They can
   turn off `involvesMe`, `nudges` and `groupActivityDigest`, leaving
   `settlementRequests` — but that one bundles the confirm request, the
   confirmation, the cancellation and the dispute together
   (`waves_pref_key_for_kind`). That bundling is defensible; it should be _stated_
   on the screen rather than discovered.
3. The local notifications proposed here have **nowhere to live**: they are not
   server prefs, they must not be written to the profile blob (a server-readable
   record of which private rules you want reminders about is a small leak of the
   same kind §1 forbids), and they need the local-permission door, not
   `enablePush()`.

### Proposed shape — three sections, nine switches, one of them per-rule

```
Notifications on this phone             [permission card, unchanged]

ON THIS PHONE  (never leaves the device)
  Money reminders          — recurring rules you asked to be reminded about
  Budget warnings          — when a monthly budget is nearly spent
  Unfiled captures         — a weekly reminder if captures are waiting
     └ "These are set by your phone. Nothing about your private ledger is
        sent to a server."                                   ← the load-bearing line

FROM WAVES  (push)
  Expenses that involve me
  Settle-ups               — "asked to confirm, confirmed, cancelled, disputed"
  Reminders and nudges
  Group and trip summaries

EMAIL
  Email me at all          [master switch]
  Regular summary          [Off · Weekly · Monthly]          ← replaces weeklyEmail
     └ "Security emails about new sign-ins are always sent."
```

Decisions embedded in that:

- **The local section is first and is labelled with where it runs.** The privacy
  property is the reason those reminders are less reliable; saying so makes the
  trade legible instead of looking like a bug.
- **`weeklyEmail: boolean` becomes a three-way** (`off | weekly | monthly`). That
  changes `NotificationPrefs` and the `COALESCE((… ->> 'weeklyEmail')::boolean,
FALSE)` read in `waves_enqueue_weekly_digest`: a boolean cast of the string
  `'weekly'` errors, and of an absent key is null → false. **It must be written as
  read-both-shapes, then migrate**, or everyone who opted in is silently opted out.
- **The subtitle under "Settle-ups" enumerates the four events**, so the bundling is
  a stated bargain.
- The per-rule "remind me about this one" toggle stays on the rule editor; this
  screen holds only the master for that class.
- **Nothing here can turn off `new_device_login`**, and the screen says so.
- Web parity: the web client cannot schedule local notifications, so the first
  section must be **absent** there rather than shown and inert.

---

## 7. Quiet hours, timezone and frequency caps

### 7.1 There is no per-user timezone, and that decides a lot

`profiles` has `locale`, `country_code`, `default_currency` — **and no
`time_zone`**. The only IANA zone in the schema is `groups.time_zone` (default
`Asia/Kolkata`), commented "a trip has a place; breakfast means breakfast there".

Consequences, stated so they are chosen rather than discovered:

- **`waves_trip_nudges` is correct today** precisely because a trip has a place.
- **`waves_enqueue_weekly_digest` is a fixed 03:30 UTC**, chosen because it is 09:00
  in Asia/Kolkata "which is where the people are". For a user in São Paulo that is
  00:30. Acceptable for mail; **not acceptable for a push.**
- **Therefore: no server-side push may be scheduled at a wall-clock hour until
  `profiles.time_zone` exists.** Event-driven pushes are unaffected — they fire
  when a human acted.
- **Local notifications sidestep this entirely.** The device knows its own wall
  clock; `localIsoDate` / `todayIso` in `apps/mobile/src/data/personal.ts` exist
  precisely because `toISOString().slice(0,10)` shifts the day for anyone off UTC.

### 7.2 The timezone bug this repo has already paid for, and how not to repeat it

`waves_phone_gate`
(`packages/db/prisma/migrations/20260912090000_phone_otp_gate/migration.sql:186-192`)
carries the finding in its own comment:

> a plain cast to timestamptz reads the _session's_ time zone, so on a connection
> that is not UTC this points at midnight somewhere else and can come back
> negative — a "try again in -3 hours" on the one screen somebody is stuck on.

The recorded fix is `(date)::timestamp AT TIME ZONE 'utc'`, never a bare cast.

**The design rule that makes it unrepeatable:** any date-boundary arithmetic in a
notification job must name whose midnight it means, _in the expression itself_ —
`AT TIME ZONE <a zone read from a column>` for a user-facing hour, or
`AT TIME ZONE 'utc'` for a quantity that is not in a timezone. A bare cast to
`timestamptz`, or `now()::date`, is the bug. Reviewers should treat a zone-less
cast inside any `waves_*_nudges` / `_digest` / `_reminders` function as a blocking
finding. On the device the equivalent rule is: build a `Date` from
`YYYY-MM-DDTHH:MM:00` with no `Z`, and never round-trip a local reminder date
through `toISOString()`.

### 7.3 Quiet hours

None exist. Proposal, in the order that keeps each step honest:

1. **Local notifications get quiet hours nearly for free** — the device schedules
   them, so a rule's own time of day (default 09:00) is already the answer. Clamp
   any computed fire time into a per-person window held in AsyncStorage.
2. **Server pushes get a coarse guard first, a real one later.** The coarse guard:
   hold any _non-urgent_ kind (digest, trip nudge, dunning) written during a
   person's night hours until morning — which needs 7.1's column. Until it exists
   the honest position is **event-driven pushes only**, which is what the current
   kinds are apart from the trip nudges, and those are already in the group's zone.
3. **Never quiet-hour a settlement confirm request or a security notice.** The first
   is a question the ledger is waiting on; the second is an alarm.

### 7.4 Frequency caps — what exists and what is missing

Already enforced:

| cap                                                                             | where                                                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| one nudge per pair per day                                                      | `waves_nudge_rate_limit` trigger **and** a date-bearing `dedupe_key` |
| one trip nudge per group per day per slot per person                            | `dedupe_key` in `waves_trip_nudges`                                  |
| one weekly digest per person per ISO week, and **none at all with no activity** | `dedupe_key` + `CONTINUE WHEN expense_count = 0`                     |
| one device alert per device per day                                             | `dedupe_key` carries `current_date`                                  |
| push: 3 attempts, +3 min, +9 min, terminal                                      | `waves_finish_push`                                                  |
| nothing older than 2 days is ever sent                                          | both claim functions                                                 |
| email: 25 rows per run, 600 ms apart                                            | `EMAIL_BATCH`, `SEND_SPACING_MS`                                     |

Missing, and needed before 4.5 ships:

- **a per-recipient ceiling across all kinds.** Nothing counts how many
  notifications one person received this hour. A twelve-person trip evening is
  currently unbounded.
- **a coalescing window for expense activity** — the time-bucketed `dedupe_key` in
  4.5. ADR-010 asks for exactly this and nothing implements it.
- **a single local cap across every local kind**, under iOS's 64 (§4.0).

---

## 8. What it would take to make push actually work

Everything between the inbox row and the phone is built and tested. What is
missing is credentials and one console step each. In dependency order:

1. **Android FCM.** A Firebase project with an Android app whose package name is
   exactly `app.waves.mobile`; `google-services.json` at
   `apps/mobile/google-services.json` (gitignored; **absent in this checkout**) and
   uploaded to EAS as `GOOGLE_SERVICES_JSON` for _every_ environment; a
   service-account private key handed to Expo via `eas credentials`. The `.json` is
   compiled in, so this needs a **rebuild** — it cannot ship OTA.
2. **iOS APNs.** An APNs key from the Apple Developer portal, uploaded via
   `eas credentials`. Needs a paid membership; does **not** need a Mac. Recorded as
   not done.
3. **`expoConfig.extra.eas.projectId`** must be present, or `refreshPushToken`
   returns `NotConfigured` before it ever asks the OS.
4. **A device must actually register.** `push_tokens` was empty at the last recorded
   check. A row is written only by `enablePush()` (the settings screen or the soft
   ask) or `refreshPushToken()` on sign-in. Until one exists with
   `revoked_at IS NULL`, `waves_claim_push_notifications` closes every row out as
   terminally failed and the pipeline is a no-op returning a healthy 200.
5. **The Vault secrets on the live project** — `service_role_key` (the **new-style**
   `sb_secret_…` value, not the legacy JWT) and `functions_base_url` (must start
   `https://`, or the trigger refuses and says nothing).
6. **The cron job.** `waves-notify-fanout` every 5 minutes, sending the secret in
   **both** `apikey` and `Authorization` headers on a project that issues `sb_…`
   keys — the gateway authenticates on `apikey`, the function compares the bearer.
   Recipe: `docs/notify-fanout-scheduling.md`.
7. **Verify before believing any of it.** The fanout's own reply reports `problems`
   by Expo error code and `misconfigured: true` when those codes are
   `MismatchSenderId` or `InvalidCredentials` — the two that mean the credentials
   are wrong rather than the phones. Without reading that, a wrong FCM key looks
   exactly like a country with its phones switched off.

**Two things to check on the live project that nobody has confirmed in writing:**

- `select jobname from cron.job` — does it include **`waves-weekly-digest`**? That
  job schedules itself from inside `…/20260907090000_device_alert_and_weekly_digest`,
  guarded on `pg_cron` already existing. `pg_cron` is **not installed by default** on
  a new Supabase project and the current project is a rebuild; if the migration ran
  before `CREATE EXTENSION pg_cron`, the guard silently skipped and the weekly
  digest has never been enqueued.
- `select count(*) from push_tokens where revoked_at is null`. Everything in §4's
  server column is theatre until this is non-zero.

**Local notifications need none of steps 1-7.** One permission, granted at the
moment a toggle is turned on. That asymmetry is the strongest practical argument
for building the local half first: it is the half that can be true this week.

---

## 9. Phasing

Each phase ships something true on its own. **JS** = reaches phones by OTA.
**Deploy-gated** = a migration, an edge deploy, or a `cron.schedule` run by hand.

| phase  | what                                                                                                                                                                                                                                                              | gate                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **P0** | **Turn push on** (§8 steps 1-7) and verify a real device receives a `settlement_confirm_request`. No code. Instantly un-silences nine kinds that are already written and translated.                                                                              | console + **native rebuild** (not OTA)                   |
| **P1** | **Local personal reminders** — the pure planner, the diff/sync lib, `ensureLocalNotificationPermission`, the high-importance Android channel, the headless component, the per-rule toggle, sign-out cancel-all. Exactly `docs/plan-recurring-money-events.md` P3. | **JS only**                                              |
| **P2** | **Settings screen reshape** (§6) — three sections, the local section, `weeklyEmail` → `off/weekly/monthly` read-both-shapes.                                                                                                                                      | JS for the screen; **migration** for the monthly enqueue |
| **P3** | **Trip ended → settle up.** New kind, copy ×4, pref mapping, a `waves_trip_recap` job shaped like `waves_trip_nudges`, plus the E7 mail if wanted (both whitelists).                                                                                              | **migration + cron**                                     |
| **P4** | **Expense activity, coalesced.** An `involvesMe`-scoped producer with a bucketed `dedupe_key`, plus the per-recipient hourly ceiling from §7.4. Do not ship the producer without the ceiling.                                                                     | **migration + edge**                                     |
| **P5** | **Invite-accepted / ghost-claimed producers.** One `waves_notify` call each; copy already exists.                                                                                                                                                                 | **migration**                                            |
| **P6** | **Budget thresholds (local)**, then **captures (local)**, then the shared local cap of 48.                                                                                                                                                                        | **JS only**                                              |
| **P7** | **`profiles.time_zone` + quiet hours.** Blocks automatic dunning (4.7) and any wall-clock server push.                                                                                                                                                            | **migration** + a settings row                           |

P0 and P1 are independent and should run in parallel — one is console work, the
other is code.

---

## 10. Open questions

1. **Regular summary cadence.** The recommendation is a three-way _Off / Weekly /
   Monthly_, with **weekly** as the offered default and **daily not offered at
   all**. Accept?
2. **Existing `weeklyEmail` users.** Turning the boolean into a three-way needs a
   read-both-shapes step or everyone who opted in is silently opted out. Is that
   migration worth it, or keep the boolean and add a separate monthly toggle?
3. **Amounts on the lock screen.** Proposal: local money reminders name the thing
   ("Did the rent come in?") and **not the figure**, because a lock screen is the
   one place the private ledger is readable without the biometric gate. Should
   there be an opt-in "show amounts"?
4. **Expense notifications — everyone in the group, or only people the expense
   involves?** Recommendation is _involves me_ (payer or share), matching what the
   switch is called and what the weekly digest was narrowed to.
5. **Coalescing window for expense activity.** 15 minutes per recipient per group,
   body counting the expenses? Or none, relying on "involves me" alone to keep the
   volume down?
6. **Trip recap: push, email, or both?** Recommendation: both when money is
   outstanding, push only when everything is already settled.
7. **Automatic dunning** (`reminders.auto`, built and unfired). Leave unbuilt until
   quiet hours exist, or is a fixed "09:00 in the group's timezone" good enough to
   ship it sooner?
8. **Phone-only accounts receive no email at all** (`waves_email_for` requires a
   confirmed address). Acceptable, or should the phone-signup flow ask for an
   address specifically so the fallbacks work?
9. **`digest_daily` and `settlement_initiated`.** Both are half-built — copy,
   templates, whitelist entries, no producer. Delete them, or finish them? Two dead
   kinds on a whitelist is a trap for whoever adds the third.
10. **Does the settings screen need per-group granularity?** ADR-010 says it was
    considered and not built. A noisy twelve-person trip is the case that would want
    it; deciding now avoids designing the screen twice.
