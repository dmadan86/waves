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

| Kind                                                       | Effect on "company owes employee" |
| ---------------------------------------------------------- | --------------------------------- |
| Expense (fuel, transport, travel, food, office, other)     | + amount                          |
| Allowance / Bata (days x daily rate, rounded half up once) | + amount                          |
| Advance (company gave cash)                                | - amount                          |
| Reimbursement, company to employee (recorded settlement)   | - amount                          |
| Reimbursement, employee to company (cash returned)         | + amount                          |
| Wages paid (typed, fixed weekly, or days x rate)           | none; shown in totals only        |

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
shows that card until their first entry. Phase 2 adds a company-wide default bata rate and a
currency row on the create screen (optional, one row open at a time; the rate is sent behind the
create as `company.settings_set`), and employees opening the invite link land straight in Add
entry with a one-line privacy explainer (Back goes to the company home).

## Phase 2 (server)

Migration `20261105090000_company_expenses_2` adds company defaults, optional approvals,
private entry photos and independent company storage accounting. Approvals default off:
new entries are approved; when on, every new entry is submitted, including admin entries.
Ledger/evidence edits resubmit and clear review metadata. Reviews require the current
entry version; rejection also requires a nonblank note (500 characters maximum).
Existing approved history survives a settings toggle. Member rate overrides the company
rate; zero is valid. Existing approved/reimbursed balance math is unchanged.

`company_entry_attachments` is pull-only, including tombstones, under caller RLS:
the entry's employee and active company admins can read. Only its uploader/admin can
remove a photo. Attach/remove RPCs lock the entry and increment its version. Void,
group deletion and privileged entry deletion release originals and thumbnails through
the durable R2 deletion queue. Up to ten live originals; previews are protected image
data URIs up to 4 KB. Keys are immutable and permanently retired after use.

R2 bucket `company-entry-images` accepts `<entryId>/<attachmentId>/<randomUUID>.jpg`
and `<original>.thumb.jpg`. All signing actions require `subjectId: entryId`; reads
resolve the attachment as caller, require a live entry/attachment and committed object,
and use 60-second URLs. PUT uses `if-none-match: *` (send all returned headers).
No Supabase fallback, public sharing, generic image normalization or receipt-parse path.
Company receipts/album uploads through the shared buckets are refused.

Company bytes (including pending uploads/thumbnails) never consume personal quota or
pending slots. `company_plans` is service-only, backfilled/provisioned on company creation;
a null quota is unbounded. Plan reads require membership; usage reads require admin.
Recount retains company attribution. Unattached committed uploads expire after a day;
queued deletions wait beyond PUT expiry. Account deletion retains company evidence.

Mobile/server contract (amounts and rates are decimal strings in mutation payloads):

- `company.settings_set`: `{defaultDailyRateMinor: string | null, approvalsEnabled: boolean}`.
  Both fields are required; null clears the rate.
- `company_entry.transition`: `{entryId, to: 'approved' | 'rejected', note?: string | null,
  expectedVersion: number}`. Version is mandatory for review.
- `group.create`: optional `companyDefaultDailyRateMinor: string | null`, passed atomically
  to the trailing `p_company_default_daily_rate_minor bigint DEFAULT NULL` argument.
- Direct RPCs: `waves_attach_company_entry_image(p_entry_id uuid, p_storage_path text,
  p_attachment_id uuid, p_preview text DEFAULT NULL) RETURNS uuid`;
  `waves_remove_company_entry_image(p_attachment_id uuid) RETURNS void`;
  `waves_company_settings_set(p_group_id uuid, p_default_daily_rate_minor bigint,
  p_approvals_enabled boolean) RETURNS void`;
  `waves_company_entry_transition(p_entry_id uuid, p_to text, p_note text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL) RETURNS void` (null version is refused).
- Readers: `waves_can_read_company_entry(p_entry_id uuid) RETURNS boolean`,
  `waves_company_plan(p_group_id uuid) RETURNS TABLE(plan text, storage_quota_bytes bigint)`,
  `waves_company_storage_usage(p_group_id uuid) RETURNS TABLE(used_bytes bigint,
  reserved_bytes bigint, quota_bytes bigint)`.
- Sync groups add `company_default_daily_rate_minor`, `company_approvals_enabled`; entries
  add `review_note`, `reviewed_by`, `reviewed_at`. Attachments sync `id`, `entry_id`,
  `group_id`, `uploader_member_id`, `storage_path`, `preview`, `created_at`, `updated_at`,
  `deleted_at`, `updated_seq`. `company_plans` never syncs.

`export-data` JSON adds caller-visible `companyEntries`; CSV adds company ledger rows
and category/direction/review-note columns. Neither format includes attachment keys,
previews, bytes or signed URLs. Failed reads fail the export. Company PDF rendering and
mobile authorization-cache purging remain owned by the mobile implementation.

## Phase 2 (mobile)

- Photos: add-entry stages photos (camera or library, EXIF-stripped re-encode), then after the
  entry syncs uploads each to `company-entry-images` and attaches it. The entry screen
  (`company-entry-view`) shows, adds and removes photos; URLs are signed on demand (60 s).
- Approvals: admin switch on the company home; submitted entries are listed for the admin,
  who approves or rejects (note required) on the entry screen. Statements list unapproved
  entries apart with their status and review note; only approved ones reach the balance.
- Export: the group export screen shows a company export for Company groups. An employee
  exports their own statement; an admin the summary with every employee and entry. PDF and
  Excel are built from the same model (`data/companyExport.ts`); no photo, key or URL is in
  either, and Excel text cells that start with `= + - @` are stored as text.
- Strings: `company.*` in English, Tamil, Hindi and Arabic.

## Deferred (not in Phase 1)

- Approval notifications and claim-to-payment allocation (`reimbursed` is never set yet).
- Admin-only invitations and identity-bound invites for company groups (today any member
  can mint an invite; an invitee still sees only their own entries).
- Realtime for entries (sync polling and manual refresh only), push for entries.
- A server-side "revoke on role change" purge of cached company rows on a phone; until the
  next pull a demoted admin's phone still holds what it downloaded.
- Web authoring, the public API / agent tools for company groups, receipt OCR,
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
