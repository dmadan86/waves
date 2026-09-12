# Recurring money events: direction, type, and a reminder that asks

A plan, not a build. It covers the request "the transactions screen should have a
recurring button; a recurring thing has a date, a type with an icon, a direction
(you pay or you receive), and an opt-in notification on the day asking whether
the rent came in or whether you paid it".

The short version: **most of this already exists and is not surfaced.** The one
genuinely new thing is the notification, and the honest place to put it is on the
device, not on the server. Everything here ships as JS — no migration, no edge
function, no cron, nothing deploy-gated.

Throughout: the private ledger is **A56** in `waves-tdr.md:561`, not A48. Source
comments across `personal/` say A48 because the number was handed out four times
in a fortnight (`waves-tdr.md:582`); A48 is the mirror's at-rest encryption. New
code should say A56.

---

## 1. What exists today

### 1.1 Recurring rules are a complete feature

`apps/mobile/src/app/personal/recurring.tsx` (615 lines) is a full list + editor.
`PersonalRecurring` (`packages/core/src/personal/types.ts:47-71`) already stores:

| field                              | what it is                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `txnKind`                          | `'expense' \| 'income'` — **this is the direction the request asks for**                   |
| `amount`, `currency`               | minor-unit `bigint`; decimal string on the wire                                            |
| `category`                         | a spend category id (`food`…) **or** an income source id (`inc.salary`…)                   |
| `note`                             | the person's own words for the rule                                                        |
| `cadence`, `interval`, `secondDay` | the schedule (`weekly`/`semimonthly`/`monthly`/`yearly` × N)                               |
| `anchorDate`                       | first occurrence — the walk starts here, so history before the rule was written is visible |
| `nextDate`                         | the next one owed; advanced as occurrences post                                            |
| `endDate`                          | stop after this date, or null                                                              |
| `autoPost`                         | true → mint the txn when due; false → only remind                                          |
| `active`                           | paused or not                                                                              |

The named patterns (monthly, twice a month, fortnightly, quarterly, half-yearly,
yearly, every N months) are `Frequency` / `FREQUENCIES` / `scheduleFor` /
`frequencyOf` in `packages/core/src/personal/frequency.ts`.

Occurrence maths is already deep and already tested
(`packages/core/test/personal.test.ts`, `packages/core/test/personalOccurrences.test.ts`):

- `occurrences(rule, txns, range, today)` — `compute.ts:271` — every period a rule
  ever expected, each one `received` / `due` / `missed` / `future`. Occurrences
  are **derived, never stored**, and a real entry claims one by falling inside
  its window, not by matching its date.
- `isRecurringDue` — `compute.ts:165`.
- `dueInMonth` — `compute.ts:407` — what this month is still waiting for,
  `missed` included.
- `nextRecurring` — `compute.ts:477` — the soonest one ahead.
- `recurringOccurrenceId(ruleId, date)` — `compute.ts:209` — a deterministic
  record id per (rule, date), so the auto-post path, a manual "add now" and a
  hand-confirmed period all collapse to **one** row.
- `unpostedOccurrences` — `compute.ts:448` — what an auto rule still owes,
  filtered by id rather than by date so a hand-entered figure is never
  overwritten.

`postDueRecurring` (`apps/mobile/src/data/personal.ts:191-239`) runs the auto
catch-up; it is called once from the Me tab on open
(`apps/mobile/src/app/(tabs)/me.tsx:123-140`).

`apps/mobile/src/app/personal/source/[id].tsx` is the per-rule timeline: every
period, newest first, with a `RecordSheet` (line 311) that prefills the rule's
amount and that period's date, is editable, and writes under the deterministic
occurrence id. **This is already the "did the rent come in?" answer screen.**
It just has nothing that points a person at it at the right moment.

### 1.2 Type and icon are mostly built

- Income sources: `packages/core/src/personal/sources.ts` — fifteen, each with an
  Ionicons glyph and a tint. `inc.salary` (briefcase), `inc.rent` "Rent received"
  (home), `inc.dividends` (pie-chart), `inc.interest`, `inc.pension`,
  `inc.business`, `inc.royalties`… **Salary, rent and dividends are all there.
  Agriculture is not.**
- `SourceGlyph` (`apps/mobile/src/components/IncomeSource.tsx:143`) draws the
  tinted circle; `useSourceLabel` (line 32) translates it, falling back to the
  person's own custom tag label.
- Spend categories: ten built-ins (`packages/core/src/category/categories.ts:25`),
  plus per-user custom tags (`category_tags`, A42) and installable packs (A66,
  `packs` / `pack_installs`). `CategoryBadge` + `resolveCategory(key, meta)`
  render them.

### 1.3 The personal store: one opaque table, server as pure relay

- `personal_records` — `packages/db/prisma/schema.prisma:1013-1039`. Columns:
  `id`, `owner_user_id`, `record_kind` (`'txn' | 'recurring' | 'loan' | 'budget'`),
  `data Json @default("{}")`, `updated_seq`, timestamps, `deleted_at`. The schema
  comment says outright: _"The server only relays this data … it never reads the
  shape of a row."_
- Writes go through the offline queue: `MutationKind.PersonalUpsert` /
  `PersonalDelete` under `personalScope(ownerId)` = `` `${profileId}:personal` ``
  (ADR-005's personal scope; `waves-tdr.md:278`).
- The edge validates **nothing** inside `data`:
  `supabase/functions/sync/index.ts:1146-1177` checks `recordId` is a string and
  `recordKind` is one of four, then stores `data` verbatim as jsonb.
- Reads are local-first from the mirror with the queue replayed on top
  (`usePersonalRecords` → `materialisePersonalRecords`,
  `apps/mobile/src/data/personal.ts:74-82`).
- The mirror's json columns are sealed at rest on the device (A48); sign-out is
  a crypto-erase.

### 1.4 The notification path that exists

**Server side.** `notifications` (`schema.prisma:771-805`): `profile_id`,
`group_id`, `kind` (free text, no CHECK), `title`, `body`, `deep_link`,
`payload`, `channels`, `push_status` / `email_status`, `push_attempts`,
`push_next_retry_at`, `dedupe_key UNIQUE`. Rows are written by
`waves_notify(profile, group, kind, title, body, deep_link, payload, dedupe_key)`
(`packages/db/prisma/migrations/20260904000000_waves_baseline/migration.sql:4600`),
which is `SECURITY DEFINER`, service-role only, and `ON CONFLICT (dedupe_key) DO
NOTHING`.

`notify-fanout` (edge, `supabase/functions/notify-fanout/handler.ts`) claims rows
with `waves_claim_push_notifications` (limit 200), renders each through
`buildPushBatch`, POSTs to `https://exp.host/--/api/v2/push/send` in chunks of
100, and closes out with `waves_finish_push` — whose backoff is 3 minutes, then
9 minutes, then terminal at the third failure (baseline migration:3141-3175).
Email runs after, and only for seven whitelisted kinds.

It is driven two ways (`docs/notify-fanout-scheduling.md`): an AFTER INSERT
trigger (`waves_notify_fanout_trigger`, migration-tracked; latest body in
`20260904180000_fanout_trigger_url/migration.sql:21-73`, reads the Vault secrets
`service_role_key` and `functions_base_url`) and a `pg_cron` job
`waves-notify-fanout` every 5 minutes for retries. **Cron jobs in this repo are
deliberately not migration-tracked** — `waves-auto-archive` (18-month stale-group
archive, `waves_auto_archive_stale_groups`, default `p_age = '1 year 6 mons'`,
baseline:1486), `waves-auto-confirm`, `waves-trip-nudges`,
`waves-storage-expire-pending`, `waves-sweep-rate-limits` and `waves-notify-fanout`
itself are all scheduled directly against the live project, because
`cron.schedule()` plus a Vault secret is environment-specific. The one exception
is `waves-weekly-digest`, scheduled inside a `pg_extension` guard at
`…/20260907090000_device_alert_and_weekly_digest/migration.sql:389-401`.

**Adding a new notification kind means keeping four hand-maintained lists in
lockstep**, none of which fails loudly when they drift:
`NotificationKind` (`packages/core/src/notifications/copy.ts:21-86`, plus copy in
four languages), `waves_pref_key_for_kind`
(`20260908120000_settlement_notices_and_push_prefs/migration.sql:370-394`),
`TEMPLATE_FOR_KIND` (`packages/core/src/notifications/email.ts:83-117`), and the
inline `n.kind IN (…)` whitelist inside `waves_claim_email_notifications`. Push
text is localized by `renderNotification(kind, facts, locale, fallback)`
(`packages/core/src/notifications/render.ts:55-80`) against `profiles.locale` —
_not_ the device's current language.

**Device side.** `apps/mobile/src/lib/push.ts`:

- `pushSupported` (line 45) — iOS/Android only; expo-notifications throws on web.
- `ensureAndroidChannel()` (line 48) — one `default` channel, `DEFAULT` importance.
- `enablePush()` (line 104) — permission, then `getExpoPushTokenAsync`, then
  upsert into `push_tokens`. Needs `expoConfig.extra.eas.projectId` **and** real
  FCM/APNs credentials in the build; without them it returns `NotConfigured`.
- `routeForNotification(response)` (line 192) — reads
  `response.notification.request.content.data.url`, strips `waves://`, returns a
  path. **There is no per-kind switch.** Any notification carrying a `url` routes.
- `_layout.tsx:355-375` wires both the cold-start (`getLastNotificationResponseAsync`)
  and warm (`addNotificationResponseReceivedListener`) taps to `router.push`.
- Permission is never asked at launch; `components/NotificationPrompt.tsx` is the
  soft ask that precedes the OS dialog, shown once.
- Per-user prefs live in `profiles.notification_prefs` jsonb
  (`packages/core/src/notifications/prefs.ts:23-69`): `involvesMe`,
  `groupActivityDigest`, `settlementRequests`, `nudges`, `email`, `weeklyEmail`.
  Screen: `apps/mobile/src/app/settings/notifications.tsx`.

**What must be true for a server push to land on a phone:** a build with FCM/APNs
credentials and an EAS project id; permission granted; a non-revoked `push_tokens`
row; the `service_role_key` Vault secret set on the project; and either the insert
trigger firing or the `waves-notify-fanout` cron scheduled. `push_tokens` has been
empty on this project before — that is five things that all have to hold.

### 1.5 The closest scheduled-reminder precedent

`waves_trip_nudges(p_now)` — baseline migration line 6897 — is the template a
server-side recurring reminder would copy:

```sql
v_local := p_now AT TIME ZONE v_group.time_zone;   -- the GROUP's zone
v_today := v_local::date;
...
CONTINUE WHEN v_local::time < v_group.remind_morning_at;
...
CONTINUE WHEN EXISTS (SELECT 1 FROM public.expenses ... );  -- don't ask about a day already recorded
v_id := public.waves_notify(..., 'trip_nudge:'||group||':'||date||':'||slot||':'||profile);
```

Three things to take from it: the dedupe key is what makes a "run every 5
minutes" job safe; a reminder is suppressed for anybody who already recorded the
thing it would ask about; and the timezone comes from a stored IANA zone.
**`groups.time_zone` exists; `profiles` has no timezone column at all** — only
`locale` and `country_code` (`schema.prisma:143,148`). A per-person daily job has
nowhere to read an hour from.

**The timezone bug this repo already paid for** is in `waves_phone_gate`
(`packages/db/prisma/migrations/20260912090000_phone_otp_gate/migration.sql:180-192`):
a plain cast to `timestamptz` reads the _session's_ zone, so a "try again in N
hours" computed that way could come back negative on a non-UTC connection. The
recorded fix is `(date)::timestamp AT TIME ZONE 'utc'`, never a bare cast. Any
date-boundary arithmetic added to this feature — on either side of the wire —
has to be explicit about whose midnight it means.

---

## 2. The gap

Separated into "genuinely missing" and "built but not surfaced".

**Genuinely missing**

1. **A reminder.** Nothing in the app ever tells anyone a recurring item is due.
   `autoPost: false` is documented as "only remind" (`types.ts:67`) and the
   reminding half was never built. This is the whole of the new work.
2. **The opt-in question.** No stored "notify me about this one" flag, no time of
   day.
3. **Agriculture** as an income source.
4. **A recurring button on the transactions screen.** `transactions.tsx` has back
   / title / `+` and nothing else; recurring is reachable only from the Me tab's
   tools shelf (`me.tsx:470-476`).

**Built, not surfaced**

5. Direction is stored (`txnKind`) and shown as sign + colour, but never **named**
   in words. The request says it out loud: "you need to pay or you need to
   receive".
6. Type + icon: `SourceGlyph` exists and the rule carries a `category`, but the
   recurring card (`recurring.tsx:193-240`) draws **no icon at all**.
7. The answer screen exists — `source/[id].tsx` with its `RecordSheet` — and
   nothing routes to it at the moment it matters.

**Two real bugs found on the way**

8. **Income rows in the full transactions list render as "Other" with no title.**
   `transactions.tsx:43-44` looks the label up in `t.categories`, and line 113
   passes `txn.category` to `CategoryBadge`. An income txn carries `inc.salary`;
   `categoryOf` (`packages/core/src/category/categories.ts:342-345`) does not
   know `inc.*` and falls through to `OTHER`. So a salary shows a grey ellipsis
   badge, and with no note the title is `—`. The Me tab gets this right
   (`useSourceLabel`), the transactions screen does not.
9. **A recurring rule can never be given an end date.** `endDate` is stored,
   honoured by `isRecurringDue` and `occurrences`, and `t.personal.endDate` /
   `noEnd` are translated in all four locales — but the editor never offers it
   (`recurring.tsx:406` writes `rule?.endDate ?? null` and nothing sets it).
   Pausing is the only way to stop a rule.

---

## 3. Data model

**No migration. No Prisma model. No edge change. No drift-check impact.**

Proof, in three lines of existing code:

- `personal_records.data` is `Json @default("{}")` — one column, no per-field
  schema (`schema.prisma:1027`).
- `upsertPersonal` (`supabase/functions/sync/index.ts:1146-1177`) validates
  `recordId` and `recordKind` only; `data` is passed straight to
  `.upsert({ ..., data, ... })`.
- The shape lives entirely in `encodeRecurring` / `decodeRecurring`
  (`packages/core/src/personal/types.ts`), which are client-side codecs over an
  opaque blob.

So the three new fields go on `PersonalRecurring`:

```ts
/** Ask me on the day. Off by default — a reminder nobody chose is a reminder
 *  people mute. */
readonly remind: boolean;
/** Local HH:MM the question is asked at. Null means the app default (09:00). */
readonly remindAt: string | null;
/** Ask this many days before the due date. 0 = on the day. */
readonly remindDaysBefore: number;
```

with matching lines in `encodeRecurring`, and defensive reads in
`decodeRecurring` alongside the existing `bool` / `str` / `int` helpers:

```ts
remind: bool(data.remind),                       // absent → false
remindAt: hhmm(data.remindAt),                   // new helper; anything not /^\d{2}:\d{2}$/ → null
remindDaysBefore: clamp(int(data.remindDaysBefore, 0), 0, 30),
```

Note `int()` at `types.ts:99-100` rejects `0` (it requires `> 0`), so
`remindDaysBefore` needs its own reader or a widened `int`. Do not widen `int` —
its current behaviour is relied on by `interval`.

**The one real hazard.** `decodeRecurring` is lossy by design, and
`apps/mobile/src/data/personal.ts:63-72` says so: _"a field a future build adds
does not survive today's decode"_. An older app build that **edits** a rule will
re-encode it without the new keys and silently clear the reminder. Nothing can
stop that; it is worth knowing it is the failure mode, and it is one-directional
(a reminder is lost, never invented). The cloud backup is safe — it reads raw
rows (`usePersonalRecords`), not decoded shapes.

**What would make this a big deal, and is therefore not proposed.** Any design
where the server decides a reminder is due has to read `personal_records.data`.
That reverses the property A56 was written for — _"the server cannot tell a loan
from a budget, which is the strongest privacy property available without
encrypting it"_ (`waves-tdr.md:561`) — and it is a TDR amendment, not an
implementation detail. See §5.

---

## 4. Direction: pay vs receive

**Storage: nothing changes.** `txnKind: 'expense' | 'income'` already is the
direction, and the editor already asks with a `SegmentedTabs`
(`recurring.tsx:441-450`). "Rent" is income when you are the landlord
(`inc.rent`, "Rent received") and an expense when you are the tenant. That is
exactly the request's point and the model already holds it.

**The UI must carry all three signals, never one.** The reskin that dropped
colour, sign and label together made "you lent" and "you borrowed"
indistinguishable and had to be reverted. So:

- **Sign** — `+` / `−`. Present today (`recurring.tsx:224-225`).
- **Colour** — income `theme.color.positive`; expense stays `theme.color.text`,
  _not_ `negative`. This is deliberate in the personal ledger: every expense row
  drawn red is a wall of red that means nothing. `negative` is reserved for
  `missed` in `OccurrenceStrip` and the timeline.
- **Word** — new, and the thing the request actually asked for. A line under the
  rule's name: `t.personal.youReceive` ("You receive") /
  `t.personal.youPay` ("You pay"). This is also what makes the reminder's
  wording obviously correct rather than a guess.

Accessibility: the card's spoken label should name the direction too — the
`OccurrenceStrip` already follows the rule that colour is never the only signal
(`OccurrenceStrip.tsx:9-12`).

---

## 5. The reminder

### 5.1 The decision: schedule it on the device

Use **expo-notifications local scheduled notifications**
(`Notifications.scheduleNotificationAsync` with a
`SchedulableTriggerInputTypes.DATE` trigger). Not `waves_notify`, not
`notify-fanout`, not pg_cron.

Six reasons, in order of weight:

1. **Privacy.** `notifications.title` and `.body` are plaintext columns read by
   `notify-fanout`, by `waves_claim_email_notifications` (which resolves the
   recipient's email address), and by the operator console. "Rent ₹25,000 due on
   the 5th" sitting in that table is precisely the private ledger content A56
   promises the server never interprets.
2. **The server would have to read the blob.** There is no other way for a
   Postgres job to know a rule is due. §3 explains why that is a spec change.
3. **Timezone.** There is no per-user timezone anywhere
   (`profiles` has `locale` and `country_code`; only `groups.time_zone` exists).
   A server job would fire at the wrong hour or need a new column. On the device
   the local calendar day is already the unit the whole personal ledger uses —
   `localIsoDate` / `todayIso` (`data/personal.ts:41-52`) exist specifically
   because `toISOString().slice(0,10)` shifts the day for anyone off UTC. **Do
   not reintroduce it.** This is the same class of mistake as computing a retry
   window in the session's timezone rather than the user's.
4. **Offline.** Scheduling is a local OS alarm. It works with no signal, which is
   the ADR-005 posture for everything else in this ledger.
5. **It needs no infrastructure.** No FCM/APNs credentials, no EAS project id, no
   `push_tokens` row, no Vault secret, no cron. §1.4 lists five things that must
   all hold for a server push to arrive; a local notification needs one
   (permission).
6. **A new server kind is four lists, not one** (§1.4), and the push payload is
   built with `channelId: 'default'` hardcoded in
   `packages/core/src/notifications/push.ts`, so a reminder could not even have
   its own Android channel without changing the shared fanout.

**If the server path is chosen anyway**, this is the full list, so the decision is
made with its price visible: a new `kind` in all four lists; copy in four
languages in `copy.ts`; a `profiles.time_zone` column plus a way to set it; a
`waves_recurring_reminders(p_now)` function modelled on `waves_trip_nudges`,
reading `personal_records.data` (the A56 amendment); a `cron.schedule` run by
hand against the live project (cron is not migration-tracked here); and a
deployed `notify-fanout` with its Vault secrets set. Migration + cron + edge:
three deploy gates where the local path has none.

What is lost, stated plainly: a reminder only exists on a device that has opened
the app since the rule was written, and a rule created on phone A does not remind
on phone B until phone B is opened. Given that the ledger is device-gated behind
biometrics anyway (A51), this is a small loss.

### 5.2 The path, end to end

**Pure planning, in `@waves/core`** — new
`packages/core/src/personal/reminders.ts`:

```ts
export interface PlannedReminder {
  /** Deterministic: `waves.recurring.<ruleId>.<dueDate>`. The diff key. */
  readonly key: string;
  readonly ruleId: string;
  /** YYYY-MM-DD the money is expected. */
  readonly dueDate: string;
  /** YYYY-MM-DDTHH:MM, local wall clock. Never a UTC instant. */
  readonly fireAtLocal: string;
  readonly txnKind: TxnKind;
  readonly autoPost: boolean;
}

/** Every reminder owed inside the horizon, soonest first, capped.
 *  Pure: no Date.now(), no timezone maths beyond string arithmetic. */
export function plannedReminders(
  rules: readonly PersonalRecurring[],
  txns: readonly PersonalTxn[],
  today: string,
  options: { horizonDays: number; cap: number; defaultTime: string },
): PlannedReminder[];
```

It walks each `remind && active` rule with the existing `occurrences()` over
`[today, today + horizonDays]`, drops anything already `received` (a rule whose
occurrence is claimed must not ask), subtracts `remindDaysBefore`, and sorts by
`fireAtLocal`. Cap defaults to **48**, below iOS's limit of 64 pending local
notification requests per app (a platform limit of `UNUserNotificationCenter`;
the Expo docs do not restate it — treat it as hard and verify on a device).
Horizon 90 days.

**Device scheduling, in `apps/mobile/src/lib/recurringReminders.ts`** — the thin
RN-touching half:

```ts
/** What to cancel and what to add, given what the OS already holds. */
export function diffSchedule(
  planned: readonly PlannedReminder[],
  existing: readonly { identifier: string; key: string }[],
): { toCancel: string[]; toSchedule: PlannedReminder[] };

export async function syncReminders(...): Promise<void>;
```

`syncReminders` reads `Notifications.getAllScheduledNotificationsAsync()`, matches
on `content.data.key`, cancels the stale ones with
`cancelScheduledNotificationAsync`, and schedules the new ones. Diffing rather
than cancel-all-reschedule keeps a foregrounding from churning 48 OS alarms.

**When it runs — a headless component**, modelled line for line on
`apps/mobile/src/lib/backup/AutoBackup.tsx` (which already documents the
"foreground + mount, never a background task" stance): a new
`apps/mobile/src/lib/recurringReminders/RecurringReminders.tsx` mounted beside
`<AutoBackup />` at `apps/mobile/src/app/_layout.tsx:265`, inside the auth and
lock gates. Same 5-minute throttle, same `recordsRef` pattern so the effect does
not re-subscribe to `AppState` on every ledger change. Trigger points: mount,
`AppState` → `active`, and a ledger change (debounced) so turning the toggle on
schedules immediately.

**Permission.** `enablePush()` is the wrong door — it wants an EAS project id and
a push token that a local notification does not use. Add to `lib/push.ts`:

```ts
/** Permission for notifications this device raises itself. No token, no
 *  project id, no FCM — a local alarm needs none of that. */
export async function ensureLocalNotificationPermission(): Promise<boolean>;
```

It calls `getPermissionsAsync` → `requestPermissionsAsync` → `ensureAndroidChannel()`,
and returns false on web / simulator (`pushSupported`, `Device.isDevice`). Asked
**at the moment the person turns the toggle on**, never at launch — the doctrine
in `components/NotificationPrompt.tsx:1-14`. A refusal turns the toggle back off
and shows a line explaining where to change it.

Add a second Android channel while there:
`Notifications.setNotificationChannelAsync('recurring', { importance: HIGH, ... })`.
The existing `default` channel is `DEFAULT` importance, which on Android means no
heads-up banner — for a "did you pay the rent?" that is the wrong silence.

**Content.** Rendered at schedule time in the app's current language via
`activeStrings()` (the same helper `data/api.ts` uses). Because the text is baked
into the OS alarm, **a language change must invalidate the schedule** — include
the locale in the diff key (`waves.recurring.<ruleId>.<dueDate>.<locale>`) so a
switch naturally cancels and re-schedules everything.

| case               | title                                                     | body                     |
| ------------------ | --------------------------------------------------------- | ------------------------ |
| income, manual     | _Did the rent come in?_ (`{name}` = note or source label) | _It was expected today._ |
| expense, manual    | _Did you pay the rent?_                                   | _It was due today._      |
| either, `autoPost` | _Rent was recorded_                                       | _Added to your ledger._  |

**The amount is deliberately not in the notification.** A lock screen is the one
place this ledger is visible without the biometric gate (A51). Recommended
default: no figure in the text. Flagged as an open question in §11 — it is the
person's own phone and some people will want the number.

**Payload and routing.**

```ts
content: {
  title, body,
  data: {
    url: `waves://personal/source/${rule.id}?occurrence=${dueDate}`,
    key,
  },
},
trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
```

`date` is built as `new Date(\`${dueDate}T${hh}:${mm}:00\`)`— local wall clock,
no`Z`, no `toISOString`. `routeForNotification` (`lib/push.ts:192`) already
strips `waves://`and hands`/personal/source/<id>?occurrence=<date>`to`router.push`— **no change to the tap handler is needed**, because it routes on`data.url` rather than on a notification kind.

**Sign-out must cancel everything.** Sign-out is a crypto-erase of the mirror
(A48); leaving "Did the rent come in?" scheduled on a phone nobody is signed in
on leaks the ledger it just erased. Add
`Notifications.cancelAllScheduledNotificationsAsync()` — or a key-prefixed sweep
— to the sign-out path beside `revokePushToken()`.

---

## 6. Answering it

Tapping the notification lands on `/personal/source/<ruleId>?occurrence=<dueDate>`:

1. `PersonalGuard` runs the biometric gate first (A51) — correct; the figures
   must not be on show behind the OS prompt.
2. `SourceTimelineScreenBody` reads the new `occurrence` param and, if it names a
   period whose status is not `received`, opens `RecordSheet` for it immediately
   (`setRecording(found)`). This is ~6 lines: the sheet, the prefill, the
   amount/date editing and the deterministic id all already exist
   (`source/[id].tsx:311-411`).

**Yes** → the existing `RecordSheet.onSave` writes a `txn` under
`recurringOccurrenceId(rule.id, occurrence.dueDate)` through
`useUpsertPersonalRecord`. That is `MutationKind.PersonalUpsert` on the offline
queue — **fully offline**, and on the mirror side of ADR-005, not the direct-RPC
side. Answering twice, or racing `postDueRecurring`, collapses to one row because
the id is derived, not minted.

**No / not yet** → dismiss. Write nothing. The occurrence stays `due` and becomes
`missed` once its window closes (`compute.ts:228-243`), which the timeline, the
`OccurrenceStrip` and the Me tab's "due this month" list already show. Do **not**
invent a "snoozed" or "declined" record: occurrences are derived, never stored,
and a stored dismissal would be the first exception to that rule.

**Auto-posting rules.** The txn is already written by the time the reminder
fires, so the question is dishonest. Recommendation: still remind, worded as a
statement, and route the tap to the entry (`/personal/entry?id=<occurrenceId>`)
rather than the sheet. Alternative — suppress reminders for `autoPost` rules
entirely — is in §11.

**Offline, precisely.** Scheduling: local, works offline. Firing: local, works
offline and works with the app closed. Answering: queued mutation, works offline.
The only online part is the eventual sync of the answer, which is the normal
posture for everything in this tab.

---

## 7. The screens

No new visual idiom. Everything below is `Card` / `Row` / `Toggle` /
`SegmentedTabs` / `Sheet` / `IconButton` from `@waves/ui`, `useBottomClearance`,
and the glyph components that already exist.

### `apps/mobile/src/app/personal/transactions.tsx`

1. **The recurring button.** A `repeat` `IconButton` in the header row, left of
   the `+` (line 63-70), pushing `/personal/recurring`. Label `t.personal.recurring`.
2. **A due strip** as `ListHeaderComponent`, shown only when
   `dueInMonth(txns, recurrings, monthKey(today), dc, today)` is non-empty: one
   flat `Card` reading "2 due this month" (`t.personal.dueThisMonth`, already
   translated), tapping through to `/personal/recurring`. The Me tab already
   renders the full list of due rows (`me.tsx:297-343`); this screen wants the
   count, not a second copy of the list.
3. **Fix the income badge and label** (§2, bug 8): branch on `txn.kind === 'income'`
   → `<SourceGlyph id={txn.category} size={32} />` and `useSourceLabel()`, exactly
   as `source/[id].tsx:126` and `me.tsx` already do. This is the single change
   that delivers "show some icon if it is rental or salary or dividends".

### `apps/mobile/src/app/personal/recurring.tsx`

4. **A leading glyph on each card** (line 193-240): `SourceGlyph` for
   `txnKind === 'income'`, `CategoryBadge` for an expense. Today the card is text
   only.
5. **The direction in words** in the sub-line beside the cadence:
   `You receive · Monthly · Next 2026-10-05`.
6. **A bell glyph** on the card when `remind` is on, so the list says which rules
   will speak up.
7. **Editor: the reminder question.** Directly under the existing "Add
   automatically" `Row` (lines 553-570), same shape — label, hint, `Toggle`:
   - `t.personal.remind` / `t.personal.remindHint` + `Toggle`.
   - When on, a pressable row showing the time, opening `DateTimePicker`
     `mode="time"` (the screen already imports it for the start date).
   - When on and `remindDaysBefore` is exposed, a `DayStepper` (already defined
     at line 260) for "days before".
     Turning it on calls `ensureLocalNotificationPermission()`; a refusal flips it
     back and shows `t.personal.remindBlocked`.

**Pre-existing deviation, noted not fixed:** `recurring.tsx` renders its list as
`ScrollView` + `.map` (line 148-256), against the FlashList standard that
`source/[id].tsx` follows. Worth a separate PR; folding it into this work would
bury the feature diff.

---

## 8. i18n

All four locales (`en`, `ta`, `hi`, `ar`) live in one file,
`apps/mobile/src/i18n/index.ts` — `UiStrings` (interface, line 182) then
`const en` (3132), `ta` (5709), `hi` (8398), `ar` (10990). There is no `...en`
spread, so a missing key is a **compile error** in every language. `fill()`
(line 14073) interpolates `{name}`.

**New keys, all under `personal`:**

| key                   | en                                                                        |
| --------------------- | ------------------------------------------------------------------------- |
| `sources.agriculture` | `Agriculture`                                                             |
| `youPay`              | `You pay`                                                                 |
| `youReceive`          | `You receive`                                                             |
| `remind`              | `Remind me`                                                               |
| `remindHint`          | `Ask on the day whether it came in.`                                      |
| `remindAt`            | `Remind at`                                                               |
| `remindDaysBefore`    | `Days before`                                                             |
| `remindBlocked`       | `Notifications are off for Waves. Turn them on in your phone's settings.` |
| `remindIncomeTitle`   | `Did {name} come in?`                                                     |
| `remindIncomeBody`    | `It was expected today.`                                                  |
| `remindExpenseTitle`  | `Did you pay {name}?`                                                     |
| `remindExpenseBody`   | `It was due today.`                                                       |
| `remindPostedTitle`   | `{name} was recorded`                                                     |
| `remindPostedBody`    | `Added to your ledger.`                                                   |

Plus `endDate` / `noEnd` if bug 9 is fixed in the same work — they are already
translated and unused.

**The parity test cannot see any of this.** `apps/mobile/test/strings.test.ts`
checks top-level keys and the `categories` map, and nothing else:

- `'gives every language every key'` — `Object.keys(STRINGS_BY_LANGUAGE.en)`,
  top level.
- `'leaves nothing blank'` — filters `typeof value === 'string'`, so `personal`
  (an object) is skipped entirely.
- `'actually translated every language rather than copying English'` — same
  top-level walk, plus `categories` and `onboarding`.

So the entire `personal` group (87 leaf keys + 15 nested sources) has **no**
blank check and **no** stuck-in-English check. Adding `agriculture` to
`personal.sources` and forgetting Tamil is caught by TypeScript (the key must
exist) but leaving the English word in all four is caught by nothing. Fix it in
this work — see §9.

RTL: no new layout. `directionalIcon` (`packages/ui/src/direction.ts:84`) already
mirrors the chevrons; the new `repeat` and `notifications-outline` glyphs are
direction-neutral. The notification body is plain interpolated text and inherits
the OS's own bidi handling.

---

## 9. Tests

**`packages/core`** — flat files under `packages/core/test/`, domain-named.

- Extend `personal.test.ts`: `encodeRecurring` / `decodeRecurring` round-trip
  `remind` / `remindAt` / `remindDaysBefore`; a blob written by an older build
  (keys absent) decodes to `false` / `null` / `0`; a malformed `remindAt`
  (`"9am"`, `"25:00"`) degrades to `null`; `remindDaysBefore: 0` survives (the
  `int()` trap in §3).
- New `packages/core/test/personalReminders.test.ts` for `plannedReminders`:
  a `received` occurrence produces no reminder; a paused or inactive rule
  produces none; `remind: false` produces none; `remindDaysBefore` shifts the
  fire date across a month boundary correctly (28 Feb / 1 Mar, 31 Jan); the cap
  keeps the **soonest** N, not the first N encountered; an `endDate` past
  truncates; a twice-a-month rule produces two per month with distinct keys.
- New sources: assert `INCOME_SOURCES` ids are unique and all `inc.`-prefixed
  (guards the collision the prefix exists to prevent).

**`apps/mobile/test`** — pure logic only; `vitest.config.ts` states there are no
render tests and anything that renders belongs in Maestro. So the RN half must be
written to be testable without RN:

- New `apps/mobile/test/recurringReminders.test.ts` for `diffSchedule`: nothing
  planned + three scheduled → three cancels; the same set twice → no churn; a
  locale change → full cancel + full re-schedule (the key carries the locale); an
  OS-held notification with no `key` in its data is left alone (it is not ours).
- New `apps/mobile/test/reminderTrigger.test.ts` for the local-wall-clock
  arithmetic: `2026-10-05` + `09:00` is 09:00 local, not 09:00 UTC. Pin it by
  constructing the `Date` and asserting `getHours()`/`getDate()`, which is what
  regresses if anyone reaches for `toISOString`.
- Extend `apps/mobile/test/strings.test.ts` with a **generic deep walk** — every
  nested object in `en`, recursively, compared for key parity, non-blankness, and
  not-identical-to-English across `ta`/`hi`/`ar`. This closes the blind spot for
  `personal` and for every other nested group at once. Expect it to fail on
  existing strings the first time it runs; the honest move is to fix or
  explicitly allow-list them in the same PR.

**`packages/db/test`** — **nothing to add.** No schema change, no new RPC, no new
RLS surface. (Separate finding: `personal_records` has no RLS test file at all —
a grep of `packages/db/test` for `personal_records` matches nothing, and only the
sequence-function grants are covered, in `internal-rpcs.test.ts`. Worth its own
PR, not this one.)

**`supabase/functions`** — nothing. The edge never sees these fields.

**Maestro** — there is no personal-finance flow in `e2e/` today. Out of scope.

---

## 10. Phasing

Every phase is JS. Nothing is deploy-gated: no migration, no `prisma migrate
deploy`, no `supabase functions deploy`, no `cron.schedule`. The whole thing
reaches phones by OTA — with one caveat: it uses no new native module, so OTA is
genuinely sufficient (unlike the Skia and widget work).

**P1 — Say what kind of money it is.** _(independent, ships alone)_
Add `IncomeSourceId.Agriculture = 'inc.agriculture'` (leaf-outline, mint) +
`sources.agriculture` in four locales. Fix the income badge and label on
`transactions.tsx` (bug 8). Add the leading glyph and the direction word to the
recurring card. Value on its own: a salary stops rendering as "Other", and rent /
dividends / agriculture get their icons.
Files: `packages/core/src/personal/sources.ts`, `apps/mobile/src/i18n/index.ts`,
`apps/mobile/src/app/personal/transactions.tsx`,
`apps/mobile/src/app/personal/recurring.tsx`.

**P2 — The recurring button.** _(depends on nothing)_
Header `repeat` button + the due strip on `transactions.tsx`. Value on its own:
recurring is reachable from where a person is looking at their money.
Files: `apps/mobile/src/app/personal/transactions.tsx`.

**P3 — Ask, schedule, and fire.** _(depends on P1 for the glyphs; otherwise
standalone — and **must be one PR**, not two)_
The three fields + codecs (core), `plannedReminders` (core), `diffSchedule` +
`syncReminders` (mobile lib), `ensureLocalNotificationPermission` + the
`recurring` Android channel (`lib/push.ts`), the `RecurringReminders` headless
component mounted in `_layout.tsx`, the editor toggle and time row, the bell on
the card, the sign-out cancel-all, and the new strings.
_Why one PR:_ a stored `remind` flag that schedules nothing is a switch that lies.
Files: `packages/core/src/personal/{types,reminders,index}.ts`,
`apps/mobile/src/lib/recurringReminders*`, `apps/mobile/src/lib/push.ts`,
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/personal/recurring.tsx`,
`apps/mobile/src/i18n/index.ts`, tests.

**P4 — Answering it in one tap.** _(depends on P3)_
`?occurrence=` param on `source/[id].tsx` auto-opening `RecordSheet`; the
`autoPost` variant routing to the entry instead.
Files: `apps/mobile/src/app/personal/source/[id].tsx`.

**P5 — The i18n net.** _(independent; do it early if the deep walk is cheap)_
The generic nested-key walk in `strings.test.ts`, plus whatever it turns up.
Files: `apps/mobile/test/strings.test.ts` (+ fixes in `i18n/index.ts`).

**P6 — Optional, separate.**
Notification action buttons ("Yes" / "Not yet") via
`setNotificationCategoryAsync` and `response.actionIdentifier` — note that acting
from the shade needs the mirror hydrated and the biometric gate considered, which
is why it is not in P3. The `endDate` control (bug 9). FlashList on
`recurring.tsx`. A `packages/db/test/personalRecords.test.ts`. A "recurring
bills" pack (§11, Q4) — a `packs` row, data not code.

---

## 11. Risks and open questions

### Questions for the user — where I am interpreting, not reporting

1. **Local vs server reminders.** I am proposing the reminder is an alarm set by
   the phone, not a push from our server, because the server alternative means
   the server reads your private ledger and writes "Rent ₹25,000 due" into a
   shared notifications table. The cost: the reminder only exists on a phone that
   has opened the app since you made the rule, and a rule made on your phone does
   not remind on your tablet until the tablet is opened. **Acceptable?**
2. **The amount on the lock screen.** A notification is readable without the
   biometric gate. I am proposing the text names the thing ("Did the rent come
   in?") but not the figure. **Do you want the amount in it?**
3. **On the day, or before it?** "Notified on this date that this income is
   coming" reads as on the day. I have included a "days before" field but
   defaulted it to 0 and would not show the control in v1. **Should "remind me 3
   days before the rent is due" be in the first version?**
4. **Expense-side vocabulary.** Income sources cover salary / rent received /
   dividends / interest / pension and (new) agriculture. The _paying_ side has
   only the ten general spend categories — there is no "Rent paid", "EMI",
   "School fees" or "Insurance premium". The designed answer is an installable
   **pack** (A66: data rows, no code, `packs` + `pack_installs`), not new
   built-in categories, because the ten are shared with every group ledger.
   **Ship a "Recurring bills" pack, or add built-ins?**
5. **Auto-posting rules.** A rule set to "add automatically" has already written
   the entry by the time the reminder fires, so "did you pay?" is the wrong
   question. I propose it still speaks, as a statement ("Rent was recorded").
   **Or should auto rules stay silent?**
6. **Agriculture as one source or several.** One `inc.agriculture` covers the
   word. A farmer probably wants crop sale / milk / lease / subsidy separately —
   again a pack. **One source now, a pack later?**
7. **Time of day.** Per rule with a 09:00 default, or one setting for all
   reminders? I propose per rule, because a salary and a rent are asked about at
   different hours.
8. **A second nudge.** If the reminder is ignored, should it ask again the next
   day? I propose no — the occurrence turns `missed` and the Me tab's "due this
   month" list already carries it.

### Risks

- **iOS's 64-request ceiling.** iOS keeps at most 64 pending local notification
  requests per app; beyond that the oldest are dropped without an error. The
  plan caps at 48 and re-syncs on every foreground, which is correct but
  untested on a device. **Verify on hardware** — this is the failure that looks
  like "reminders just stopped".
- **An older build clears the flag.** §3 — a build that predates the new fields
  silently drops `remind` when it edits a rule. Unavoidable with a lossy codec
  over an opaque blob; one-directional, so a reminder is lost rather than
  invented.
- **Android OEM aggressiveness.** Some ROMs kill scheduled alarms for apps the
  user has not opened recently. Same family as the dead-network-speech problem
  this project already hit. Nothing to do about it; worth saying out loud rather
  than promising a reminder that some phones will eat.
- **Notification text is frozen at schedule time.** Editing a rule's note, or
  switching language, must re-schedule. The locale is in the diff key and the
  ledger change triggers a re-sync, which covers both — but it is the thing that
  breaks if the diff key is ever simplified.
- **`recurring.tsx` and `i18n/index.ts` are hot files.** Two other agents are in
  `apps/mobile/src/app/personal/` and `i18n/index.ts` concurrently. P1 and P3
  both touch both. Expect to rebase.
- **The deep i18n walk will fail on existing strings.** P5 is a net, and nets
  catch things. Budget for it, or it turns into a bigger PR than planned.

### Real problems found, unrelated to the request

- Income entries render as "Other" with a `—` title in the full transactions list
  (§2, bug 8). Fixed by P1.
- A recurring rule can never be given an end date, though the field, the logic
  and the translated strings all exist (§2, bug 9).
- Every string under `personal` — 87 keys plus 15 income sources — is outside
  every runtime check in `strings.test.ts` (§8).
- `recurring.tsx` uses `ScrollView` + `.map`, against the FlashList standard.
- **Deep-link convention is split.** Most `waves_notify` call sites write
  `waves://group/<id>`; the three ghost-claim kinds write bare `/group/<id>`
  paths. Both work only because `routeForNotification`'s regex is a no-op on a
  string without the scheme. Nothing enforces which a new writer copies. This
  plan uses `waves://` for the local notifications, matching the majority.
- **Eight notification kinds are fully plumbed with no producer** —
  `expense_added`, `expense_edited`, `expense_deleted`, `you_owe`,
  `ghost_claimed`, `group_invite_accepted`, `digest_daily`,
  `settlement_initiated` all have copy in four languages and a preference
  mapping, and nothing writes them. Useful to know if the server path is ever
  taken; irrelevant to the local one.
- `personal_records` has no RLS test in `packages/db/test` (§9).
- Source comments across the personal ledger cite **A48**; the TDR says the
  personal ledger is **A56** and A48 is the mirror's encryption
  (`waves-tdr.md:582`).
