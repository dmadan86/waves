# Organise an event (research + MVP plan)

Status: **MVP shipped in this PR.** Scope cut deliberately (see "Later"); no
migration applied anywhere (prod `DIRECT_URL` is not reachable from here and
the task forbids it regardless) — `prisma generate` was run locally against a
dummy connection string to validate the schema only, nothing was migrated.

## Who this is for

Two people, not one:

1. **One organiser, one big event with money that comes in waves** — a
   wedding, where Mehendi/Haldi/Sangeet/Wedding/Reception each have their own
   vendors, their own guest list, their own day, and the group's ledger has to
   add them up without losing which occasion a bill was for. Vendors want a
   deposit now and the rest by a date; gifts/shagun arrive as cash that is
   never a "payer" in the Splitwise sense.
2. **One person running several events over the year** — a birthday this
   month, an anniversary next, a friend's engagement after that — who wants
   each to stay its own small ledger with its own budget, not one undifferentiated
   pile of "Event" groups.

## Research findings

- **Splitwise/Tricount log spend after the fact; neither collects a deposit
  or tracks a payment plan.** Both support categories and multi-payer bills,
  but "a vendor still owes a balance by a date" has no home in either app —
  confirmed by multiple 2026 comparison write-ups. That gap is exactly what
  the "vendor deposit" field below fills, and it is the one thing Waves' group
  ledger does not already do for a bill.
- **Zola's budget tool is the closest existing analogue**: category
  breakdown + contract upload + payment reminders + "spent vs estimated" per
  category, fed by real couples' data. The Knot's own tracker regressed to an
  estimate-only "Budget Advisor" and dropped actual-spend logging — a warning
  that a budget tool nobody can log real spend into stops being used.
  WeddingWire's pitch is specifically deposit/balance/pending-payment
  tracking in one dashboard — i.e. the "Upcoming payments" list below is a
  known, demanded shape, not an invented one.
- **An Indian wedding is not one event, it is five or six**, each with its
  own vendor set and budget order of magnitude: Haldi+Mehendi (₹35k–₹2L
  combined), Sangeet (₹2L–₹6L), the wedding ceremony, and the Reception —
  usually the single largest line (reports cite $250–$350/guest). Planners
  and spreadsheets universally budget *by function*, not only by category —
  "Sangeet decor" and "Reception decor" are different envelopes even though
  both are "decor". A flat category list (Food/Decor/Transport) cannot
  represent this; a second, function-shaped axis can.
- **Shagun/gift cash is a real but small budget line (≈1–2% in sampled
  breakdowns), not a payer.** It is money arriving, not a split, so it does
  not belong in `expense_shares` — it is out of scope for this MVP's ledger
  and is better served by the existing personal income ledger (`PersonalRecord`)
  than by inventing a group-level gift table. Recorded under **Later**.
- **A Western wedding's "sub-events" are fewer and front-loaded**:
  engagement, one bachelor/bachelorette night, the rehearsal dinner, the
  ceremony, the reception — the vendor-deposit pattern (a non-refundable
  deposit months out, balance due near the date) is the dominant one, not the
  multi-ceremony pattern.
- **The Gulf/Middle East pattern is family-funded, not peer-split**: an
  Emirati wedding runs well into six figures (AED), overwhelmingly funded by
  the groom's family rather than split among a peer group the way a trip is.
  The Marriage Fund's own existence (a state subsidy against extravagant
  wedding costs) says the "whose side pays for what" question is a first-class
  one in this market — an Event group's existing multi-payer expense (already
  in the schema: `ExpensePayer[]` per version) already answers "which side
  fronted this bill" once each side's members are in the group; no new model
  needed for that half of the ask.
- **Birthday parties are the simplest case and do not have "sub-events" in
  the ceremony sense** — their budget is categorical: venue & decor, catering
  & cake, entertainment, favors. Folding them into the same "sub-event" axis
  (rather than inventing a second, parallel concept) keeps one mechanism for
  both shapes, at the cost of the label "sub-event" doing double duty as "a
  spend area" for a birthday. Documented as a naming compromise, not a bug.
- **The codebase already has most of the hard parts.** `Group.type` already
  has an `event` value sitting unused beside `trip`; `Group.budgetMinor` /
  `categoryBudgets` (an admin-set, group-visible JSON map, synced via
  `waves_set_category_budget`) already does per-category planned-vs-spent
  with a tested `budgetProgress`/`spendByCategory` pair in `@waves/core`;
  `TripPlanItem` already does planned-vs-actual per day. The missing pieces
  were narrower than "build a budgeting feature": a sub-event *tag* on an
  expense, a *template* to seed the UI, and a *deposit/balance-due* reminder.
- **Multi-payer support (already shipped) is what the "two families split
  a vendor bill" and "my side paid the caterer, yours paid the hall" cases
  need** — Waves does not need a new concept for "who from each family paid",
  only for members of both sides to be in one group, which the existing
  invite flow already does.
- **A vendor deposit and a trip's hotel deposit are the same shape.** Nothing
  about "I paid a deposit, a balance is still owed, remind me by this date"
  is specific to weddings — it generalises to any trip vendor (a villa, a
  tour operator). The MVP therefore does **not** gate deposit-tracking on
  `GroupType.Event`; it is a plain optional field on any expense, and
  "Upcoming payments" is shown on any group that has one.

## User problems this MVP addresses

1. "I need to tell which bill was for the Sangeet and which was for the
   Reception" — **sub-event tagging** on an expense.
2. "I set aside ₹4L for the Sangeet; how much of that is actually spent?" —
   **per-sub-event budget**, reusing the existing category-budget machinery.
3. "The decorator wants ₹1.5L now and the rest by January 15 — don't let me
   forget" — **vendor deposit / balance due** on an expense, surfaced as a
   compact **Upcoming payments** list.
4. "I'm not just planning a wedding, I organise a few events a year and want
   to start each one from a sensible checklist instead of a blank group" —
   **event templates** on creation (Wedding Indian / Wedding Western /
   Birthday / Other).

## What shipped (MVP) — and why it reuses what already exists

- **`groups.event_template`** (new nullable column, plain member-writable
  field like `type`/`cover_emoji` — no new RPC, no admin gate): records which
  of the four templates an Event group started from. The template's actual
  sub-event list (ids + emoji) is **client-side data**
  (`@waves/core`'s `EVENT_TEMPLATES`/`subEventsForTemplate`), not stored per
  group — renaming or extending a template later reaches every group that
  picked it, the way a built-in category's label already does.
- **`expense_versions.sub_event_id`** (new nullable column): which sub-event
  (`mehendi`, `sangeet`, …) an expense is tagged with. Rides the *existing*
  expense create/update path exactly the way `category`/`payment_method`
  already do — additive parameters on `waves_apply_expense`, no new mutation
  kind, no new sync plumbing.
- **Event budget**: a sub-event's planned amount lives in the group's
  *existing* `category_budgets` JSON map, keyed by sub-event id instead of a
  category id (the two never collide — an Event group's expenses carry a
  `sub_event_id`, not a spend category, as the budgeted key). "Spent" comes
  from a new, ~15-line `spendBySubEvent` in `@waves/core` (`spendByCategory`'s
  twin) feeding the same tested `budgetProgress`. Zero new synced primitives.
- **Vendor deposit / balance due**: `expense_versions.is_deposit` (default
  `false`), `balance_due_minor`, `balance_due_date` — three more additive
  columns on the same write path. A compact **Upcoming payments** card (new
  pure `lib/upcomingPayments.ts` + `components/UpcomingPayments.tsx`) lists
  every expense still owing a balance, soonest/overdue first, on any group.
- **Templates on Event creation**: `new-group.tsx` offers a compact chip row
  (Wedding Indian / Wedding Western / Birthday / Other) when the picked kind
  is Event; the choice rides behind `group.create` as an ordinary
  `group.update`, the same pattern the trip dates/budget/fx rates already
  use.
- **Multiple events**: covered partially. Each Event group is now a
  first-class small ledger with its own template, sub-event budget and
  upcoming-payments list — "organising several events" means each one is
  easier to run well, today. A dedicated cross-group "all my events" view is
  under Later.

## Later (deliberately cut from this PR)

- **"Events" quick filter on the all-groups list** (`groups.tsx`). The screen
  already has a careful, documented pin/sort/search pipeline; adding a type
  filter is a contained change but touches that pipeline and its header
  component, and this PR did not have a device to verify the result against.
  Lowest-risk follow-up: a boolean filter applied before the existing
  `trimmed` search filter, plus one chip in the header.
- **Custom/editable sub-events.** Today a group's sub-event list is whatever
  its template fixes; an organiser cannot rename "Sangeet" or add a sub-event
  a template does not list. Would need `groups.event_template` to grow into
  (or sit beside) a real synced list — the `waves_set_group_fx_rate`/
  `category_budgets` RPC pattern this PR studied closely is the template to
  follow when that is worth the extra sync surface.
- **Shagun / gift tracking.** Cash coming in, not a split — belongs with the
  personal income ledger (`PersonalRecord`, kind `txn`) tagged to the event,
  or a future "gifts" sub-ledger, not with `expense_shares`.
- **Vendor contact/notes, contract upload, receipt-to-deposit linking.**
  Zola's and WeddingWire's edge over Splitwise/Tricount is exactly this —
  genuinely useful, genuinely a bigger surface (attachments, contacts) than
  this MVP's budget.
- **Push/email reminders for an upcoming/overdue balance.** The data is now
  there (`balance_due_date`); wiring it into the existing notification fan-out
  (`waves_notify`/`notify-fanout`) is a natural follow-up once the field has
  real usage to learn from.
- **A cross-group "all my events" dashboard** (budgets/upcoming payments
  rolled up across every Event group someone is in). Natural once the
  all-groups filter above exists.
- **Family-side split presets** ("groom's side" / "bride's side" as named
  sub-groups with their own running total). The existing multi-payer expense
  covers "who actually paid"; a named-side rollup is a reporting view on top,
  not a ledger change, and was left out for scope.
- **Import from Zola/The Knot/WedMeGood.** Mentioned in research for
  context; no evidence anyone asked for it, and Waves already has a
  Splitwise importer as the one precedent for this class of work.

## What was touched

- `packages/db/prisma/schema.prisma`, migration
  `20261003120000_event_organizer_mvp` (not applied) — `groups.event_template`;
  `expense_versions.sub_event_id` / `is_deposit` / `balance_due_minor` /
  `balance_due_date`; `waves_apply_expense` extended (4 new defaulted params,
  via explicit `DROP FUNCTION` + recreate — Postgres does not let a bare
  `CREATE OR REPLACE` change a function's argument list); `waves_guard_group_columns`
  allowlist gains `event_template`.
- `packages/core`: `sync/protocol.ts`, `sync/expenseWrite.ts`, `sync/mirror.ts`
  (additive fields only, same shape as `payment_method`/`location`);
  `trip/budget.ts` (`spendBySubEvent`); `trip/eventTemplates.ts` (new, pure
  data + lookups) — all covered by `packages/core`'s vitest suite.
- `supabase/functions/expense-write`, `supabase/functions/sync` — the two
  edge paths that both call `buildApplyExpenseArgs`, kept in parity.
- `apps/mobile`: `new-group.tsx` (template picker), `group/[id]/add-expense.tsx`
  (sub-event chips + deposit toggle), `group/[id]/plan.tsx` (wires the two new
  cards in), `components/SubEventBudgets.tsx`, `components/UpcomingPayments.tsx`,
  `lib/upcomingPayments.ts` (+ vitest), `lib/expenseEdit.ts`, `data/types.ts`,
  `i18n/index.ts` (en/ta/hi/ar, including full Arabic plural forms for the
  one countable string, "N overdue").
