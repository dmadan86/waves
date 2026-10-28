# Company expenses (Phase 1)

A business creates a **Company** group, invites its employees, and records what each
employee spent, was advanced, earned as bata and was paid in wages. Nothing is split.
Waves never moves money: paying an employee back is a recorded entry.

## Decision: a separate ledger, not the expense ledger

The split ledger (`expenses`, versions, payers, shares, comments, disputes, attachments,
`activity_log`, `group_balances`, `pairwise_balances`, notifications, export, the v1 API,
the agent tools) is readable by every group member. Hiding one employee's entries from
another there would mean gating a dozen tables and every service-role reader. Instead:

- one new table, `company_entries`, with one read policy;
- the existing expense / settlement / recurring writers are refused for company groups by
  triggers, so the shared ledger stays empty for them and nothing can leak through it;
- no `activity_log` row and no notification is written for an entry.

The design came out of a read-only Codex analysis plus a review of the same code; the
trade-offs it raised that Phase 1 does not take are listed under "Deferred".

## Data model

`groups.type = 'company'` (new `GroupType` value; the type cannot be changed into or out of
company). `group_members.daily_rate_minor` is an employee's default daily bata rate; only
the admin RPC can set it.

`company_entries`: `member_id` (the employee the entry belongs to; an admin may record for
anyone), `entry_kind`, `category`, `amount` (minor units), `currency` (the group's), `calc_mode`
(`typed` / `days_rate` / `fixed_weekly`), `days`, `rate_minor`, `occurred_on`, `direction`
(reimbursements only), `status` (`submitted` / `approved` / `rejected` / `reimbursed`),
`note`, soft delete (`deleted_at`, `void_reason`), `version`, `updated_seq`.

| Kind | Effect on "company owes employee" |
| --- | --- |
| Expense (fuel, transport, travel, food, office, other) | + amount |
| Allowance / Bata (days x daily rate, rounded half up once) | + amount |
| Advance (company gave cash) | - amount |
| Reimbursement, company to employee (recorded settlement) | - amount |
| Reimbursement, employee to company (cash returned) | + amount |
| Wages paid (typed, fixed weekly, or days x rate) | none; shown in totals only |

Net due = expenses + bata - advances - payouts + cash returned. Positive: the company owes
the employee; negative: the employee owes the company. Only `approved` / `reimbursed`
entries count; `submitted` / `rejected` are listed apart; voided entries are ignored.

## Privacy: who can read what

Enforced in the database, not in the app:

1. `company_entries` SELECT policy: group admin, or `member_id` is the caller's own member.
   No INSERT / UPDATE / DELETE grant for `authenticated`; every write goes through a
   SECURITY DEFINER RPC that checks who the caller is and what they may write.
2. In a company group, `group_members` is restricted (a RESTRICTIVE policy) to the caller's
   own row for employees, so one employee cannot see another's name, contact, rate or
   payment handle. Profiles shared only through a company group are not visible either.
3. Expense / settlement / recurring inserts into a company group are refused by triggers.
4. The sync pull reads as the caller (RLS), so a phone only ever receives rows it may read.
5. `export-data` returns only the caller's own member row for a company group.

Employees may add only their own Expense and Bata, and edit or withdraw those. Admins may
record any entry for any member (including advances, wages and reimbursements), approve or
reject submitted claims, and set an employee's default rate.

## Sync

New mutation kinds (all group-scoped, authorised by the RPCs): `company_entry.create`,
`.update`, `.void`, `.transition`, and `company_member.rate_set`. New synced table
`company_entries` (`SyncTable.CompanyEntries`), overlaid offline by
`materialiseCompanyEntries` so an entry or a bata appears at once; the server recomputes
bata and is authoritative. The entry id is client-chosen and is the idempotency key.

## Statements and summary

Computed on the phone, in `@waves/core` (`packages/core/src/company`), from the rows the
viewer can read. For an employee that is their own entries; for an admin all of them. So
the same math serves both and cannot show more than the server allowed.

- Statement (employee, date range): opening balance, each entry with a running balance,
  totals by type, expenses by category, pending claims apart, closing net due either way.
  Shared as plain text from the statement screen.
- Company summary (admin, period): gross "company owes" and "employees owe" (never netted
  against each other), totals by type and by category, and each employee with their net.

## Mobile

- New group: a **Company** tile in the new-group form.
- Opening a company group shows `CompanyHome`: an employee sees their own statement; an
  admin sees the summary with each employee one tap from their statement and a link to
  invite employees. The round + adds an entry.
- `company-entry`: a type picker (Expense, Bata; admins also Advance, Wages paid,
  Reimbursement), category chips for expenses, days x rate for bata and variable wages, a
  direction for reimbursements, date and note.
- `company-statement`: one employee's statement; an admin sets that employee's default
  daily rate here and adds entries for them.
- Styling follows `docs/design-standard.md` (ScenicHeader / ScenicBody / StandardCard /
  StatCard / ListRow / SegmentedPills).
- Strings: English, Tamil, Hindi and Arabic (`company.*`, `extras.typeCompany`).

## Onboarding (Phase 1)

Pick **Company** in the new-group form (the creator is admin). The company home opens with
one card: for an admin "Invite your employees..." with an Invite button; for an employee
"Add your fuel, travel and bata here. Only you and the company admin can see your entries."
with an Add entry button. Employees joining by the invite link land on the company home, which
shows that card until their first entry. Not done yet: a company-wide default bata rate and
currency on the create screen (the rate is per employee, set on the employee's statement; the
currency is the group currency chosen in the form), and landing straight in Add entry from the
join link.

## Approvals

Optional per company and OFF by default. Phase 1 ships the `status` column and the admin
transition RPC (`submitted` -> `approved` / `rejected`), but no company setting and no UI:
every entry is created `approved`. Turning approvals on is a Phase 2 setting plus a review
screen.

## Attachments and company plan (designed, NOT built in this PR)

Receipt photos on entries are a follow-up PR, because they need their own table, RPCs and a
`r2-sign` branch. Design, matching the private-attachments model (`docs/private-attachments.md`):

- `company_entry_attachments` (entry_id, group_id, uploader_member_id, storage_path, deleted_at,
  updated_seq), SELECT policy identical to `company_entries` (admin or the entry's employee);
  writes only through SECURITY DEFINER RPCs; synced as a pull-only table read as the caller.
- A restricted `r2-sign` branch that authorises by subject + path (the server confirms a visible
  row references the key), 60 s URLs, no dual-read fallback, no share links, never embedded in
  the text statement or `export-data`.
- Storage used by company entries is counted against the company, not the uploader.
- Company plan hook (no billing now): a service-role-only `company_plans` table (group_id,
  plan, owner_profile_id, storage_quota_bytes) and one `waves_company_plan(group)` reader. One
  purchase per company would cover its members' activity inside that company only. Today no
  paywall or ad gating changes inside company groups; current behaviour is untouched.

## Deferred (not in Phase 1)

- Approvals setting and review UI; approval notifications; claim-to-payment allocation
  (`reimbursed` is never set yet).
- PDF / Excel statement export through the group export screen (Phase 1 shares plain text);
  `export-data` carries no company entries.
- Admin-only invitations and identity-bound invites for company groups (today any member
  can mint an invite; an invitee still sees only their own entries).
- Realtime for entries (sync polling and manual refresh only), push for entries.
- A server-side "revoke on role change" purge of cached company rows on a phone; until the
  next pull a demoted admin's phone still holds what it downloaded.
- Web authoring, the public API / agent tools for company groups, attachments and receipts,
  multi-currency, recurring wages, payroll compliance (PF / ESI / TDS, payslips).
- Business-plan billing.

## Testing

- `packages/core/test/company.test.ts`: bata rounding, statement and summary math, the
  offline overlay.
- `packages/db/test/company-expenses.test.ts`: an employee cannot read another employee's
  entries or member row, cannot write for them, cannot call admin kinds; admins can; direct
  table writes are denied; the split ledger is refused for company groups; normal groups
  are unchanged.
- Manual: create a Company group, invite two people, add an expense as each, confirm each
  sees only their own; as admin set a daily rate, add bata, an advance and wages, open the
  employee's statement and the summary.
