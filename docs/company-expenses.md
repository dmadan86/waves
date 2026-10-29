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

## Phase 3: policies, GST and vendor, mileage, bulk reimburse

Designed with Codex (read-only, web search) after Mobbin research. Patterns picked:
Trainline expense receipt (line items then total: the Before GST / GST / total block);
Copilot "Remove duplicates" and GitHub "Select Items" (checkbox rows, one action at the
bottom: bulk payment); Google Health "Optional Information" (a collapsed optional section:
GST and vendor); BitePal / Copilot over-budget cue (one inline warning line, never a modal).
No new tables: the ledger table gains nullable columns, the group gains a policy document.

- **GST and vendor** (`vendor`, `gstin`, `invoice_no`, `gst_rate_bps`, `gst_amount_minor`):
  optional, typed expenses only, shown when the group is India / INR. The entry amount is the
  GST-inclusive total; GST is the typed or rate-suggested amount (half up), never above the
  total. GSTIN is trimmed, upper-cased and checked for shape, state code and check character
  in `validateGstin` (core) and the same rule in SQL. It proves format only, not registration.
  The admin summary and the exports carry a GST total and vendor/GSTIN/invoice/GST columns.
- **Mileage**: an expense with `calc_mode = distance_rate` (fuel / transport): km (two
  decimals) x rate per km, rounded once half up like bata, stored with the rate used so a later
  rate change never moves history. Rate: entry, else the employee's (`mileage_rate_minor`),
  else the company's (`company_default_mileage_rate_minor`); zero is a valid rate. Optional
  from / to text. It counts as the company owing the employee.
- **Policy hints**: `groups.company_policies` (`receipt_above`, `period_limit` by category or
  bata, day or month, effect `warn` or `block`; blocking only for limits). Per employee, by
  the entry's date; submitted, approved and reimbursed count, rejected and voided do not, an
  edited entry does not count twice, and only going over flags. The add-entry form shows the
  warning under the amount (and a likely-duplicate hint); admins see "Over policy" on the
  entry and in the approval queue. Flags are computed on the phone from rows it may read; the
  server only enforces `block` limits (under a per-employee lock) and rechecks on edit.
  A rule edit names the revision it saw so two admins cannot overwrite each other blindly.
- **Bulk reimburse**: an admin selects one employee's approved, unpaid claims (or "all due
  up to a date") and records one reimbursement. Unlinked advances, earlier payouts and cash
  returns up to the cutoff are netted in so money already handed over is not paid twice
  (payout = claims - credits; a negative result is blocked on the phone; zero records a
  clearing entry). `waves_company_reimburse` locks the employee then every row, checks exact
  versions and the expected amount, creates the reimbursement, sets covered claims to
  `reimbursed` and links claims and credits through `reimbursement_id`, in one transaction.
  The client-chosen reimbursement id is the idempotency key: the same payload replays the
  result, a different payload under the same id is refused. Covered rows and the payment are
  frozen against edit, void, review and photo changes. Entries show "Reimbursed on <date>"
  from the payment's date. The balance is unchanged by status alone: claims keep counting,
  the payment counts once against them. Offline, the payment and the paid marks overlay at
  once. Whether the money actually moved is outside Waves.
- Sync: `company.policies_set`, `company.mileage_rate_set`, `company.reimburse`; entry
  create / update gain the GST and mileage fields. All authorised by SECURITY DEFINER RPCs.

### Feature gap review (Codex vs Expensify, Zoho Expense, Fyle, Happay, Concur, Ramp, Brex, field-force apps)

Built in this PR: policy limits and receipt hint (Expensify / Ramp rules), GST and vendor
(Happay / Zoho), mileage (Concur / Happay), advance-aware bulk payment, duplicate hint
(Zoho), "Over policy" flag in the approval queue.

## Phase 4: managers, cash pools, wage run, sites

Designed with Codex (read-only, web search) after Mobbin research: Copilot "Categories" (spent / budget
bar rows) for site budgets, Monzo pots ("cash left" card plus transfer rows) for the manager's cash, checkbox
rows with one bottom action (the Phase 3 bulk payment) for the wage run. Motto: "WhatsApp for finance",
so everything is progressively disclosed: a crew of an owner and a few employees never sees managers,
cash pools, sites or the wage run until an owner makes a manager or adds a site.

**Roles.** Owner = `group_members.role = 'admin'` (several allowed). Manager = new `manager` role (company groups
only) with a team = employees whose `manager_id` is theirs. Employee = `member`; `manager_id` null means
"reports to the owners". A manager also logs their own expense / bata; only an owner reviews those.

**Who sees whom (server side, RLS + RPCs).** An employee's entry, photos, notes, GST, statements and exports are
visible only to that employee, their _current_ manager and the owners. A manager sees only owners (names only,
through `waves_company_people`), themselves and their own team in `group_members`, profiles, contacts, invites,
past-people and the member pickers. Employees see only themselves plus owners and their manager as names.
Reassigning an employee gives the new manager the full history at once and removes the old manager's access;
what a payment was funded from never changes (the old manager keeps their aggregate cash figure, computed on
the server, without any former-team detail). Activity and notifications: no row is ever written for a money
entry, and `activity_log` is owner-only. Export and sync read as the caller, so they follow the same rules.

**People.** Owners create managers (one tap: "Make manager"), create employees under any manager or the owners,
reassign teams and remove anyone. A manager adds or invites employees and they are forced onto that manager's
team (a manager cannot pick a team, promote or reassign); an invite minted by a manager stores
`company_manager_id` and the joiner lands on that team. Reassignment needs no reason.

**Approvals.** With approvals on, the employee's manager or any owner may approve or reject; either suffices.
A manager never reviews their own claim. A second-owner setting is in the add-ons below.

**Cash pool (the "float").** New entry kinds on the manager's own member row: `allocation` (owner gives cash,
optionally per site), `pool_return` and `pool_adjustment` (a trimmed written reason of 1 to 500 characters is
required and shown in history and exports). Advances, reimbursements and wage payments a manager records are
stamped `funding_manager_id = self`. Balance = allocated + adjustments - returned - advances - reimbursements -
wages - own approved spend + cash returned. It may go negative (money may already be spent); it carries over
and is never reset. `waves_company_pool_balance` is authoritative; the phone sums what it can read as the
offline fallback.

**Wage run.** One `company_entries` row per employee, kind `wage_payment`, amount = net. Gross = days x rate
(half up once, two decimals) or a fixed weekly / monthly amount, plus approved unpaid bata / mileage folded in.
Recovery = min(outstanding advance, gross); net = gross - recovery, never negative; the rest carries. Outstanding
advance = advances not netted into a Phase 3 payment minus earlier recoveries. The balance effect of a wage
payment is `-claims + recovery`; base wages show in totals like legacy wages. The run id is the idempotency key
(same payload replays, a changed one is refused), a period overlapping one already paid to the employee is
refused (the phone greys such rows out so the server never has to), and the server recomputes every figure
and compares them with what the phone showed. Statements show gross, advance cut and net.

**Sites.** `company_projects` (name, archived), `company_project_members` (an employee may be on several) and an
owner-only `company_project_budgets`. Entries, allocations and wage lines can carry a `project_id`. Spent =
approved expense + bata + wage base; advances are cash, not spend. The owner sees spent / budget / remaining
bars and `waves_company_project_report` (per site and per manager pool).

**Contract.** Migrations `20261110080000_company_manager_role_enum` (the enum value alone) and
`20261110090000_company_managers_pools`. RPCs: `waves_company_people`, `_member_add`, `_member_assign`,
`_member_projects_set`, `_project_set`, `_pool_post`, `_pool_balance`, `_project_report`, `_wage_pay`; sync
kinds `company_member.add|assign|projects_set`, `company_project.set`, `company_pool.post`, `company_wage.pay`;
pulled tables `company_projects`, `company_project_members`, `company_project_budgets`.

**Built / deferred.** Built: all of the above, the manager and owner screens (cash card, "Pay wages" list, sites
bars, "Make manager" / "Reports to" / site chips on a statement). Deferred: names of the manager / owners on an employee's screen (the RPC exists), wage preview RPC,
settlement-application table (partial advance recovery across wages is handled by the recovery column),
and downloaded-data purge on a role change (as in Phase 2). "Reports to", sites, offline adds, split wages,
the second owner and the reassignment purge are in the add-ons below.

### Phase 4 add-ons (migration `20261111090000_company_addons`)

- **Add employee**: the form also asks "Reports to" (owners, when managers exist) and sites. They ride the
  add as queued `company_member.assign` / `projects_set` with the client-chosen member id, so they land in
  order offline. A manager's hire is forced onto their own team by the server as before. Queued
  assign / site changes and a manager's own offline adds show at once (`materialiseMembers`,
  `materialiseProjectMembers`).
- **Voice**: the employee home has a mic beside the +. In a company, `app/voice.tsx` saves the spoken
  expense as the speaker's own company entry (member id from their own membership), never a split. A
  spoken currency other than the company's is asked about, not converted.
- **Split wages**: a wage line may carry `splits: [{projectId, amountMinor}]` that sum exactly to the wage
  base (gross less folded bata; recovery does not change site cost). Stored in `company_wage_splits` (pulled,
  as private as the payment, re-stamped on reassignment). Then `projectId` must be null. Site spend (phone
  `projectSpend` and `waves_company_project_report`) counts the parts, never the parent too. The wage run
  screen offers site chips per person and divides the base evenly (first sites take the remainder).
- **Second owner**: `groups.company_second_approval` (+ optional threshold). Needs approvals on and two live
  owners (the setting RPC refuses otherwise, and the rule is inert if owners drop to one). A claim raised by
  an owner, or at/over the threshold, can only be approved by an owner other than its creator
  (`SECOND_OWNER_REQUIRED`); managers and the creator do not see Approve. Rejecting is unchanged.
- **Reassignment purge**: the sync response carries `companyVisible` for company groups where the caller is
  a manager: the member ids their RLS lets them read. The phone drops cached entries, photos, split wages,
  sites and member rows of anyone not on it, from memory and disk. A missing or incomplete list drops
  nothing. Still open: a demoted owner's phone, and re-promotion does not restamp history.

### Paid directly by the company (migration `20261112090000_company_paid_direct`)

An expense the company itself pays (materials, repairs, rent, utilities, vendor bills, equipment, office, transport,
fees) has no employee: `company_entries.member_id` is null and `paid_by_company` is true (a CHECK ties the two and
limits the shape to an approved, typed `expense` with no mileage, direction or links). It creates no balance for
anyone, is never reimbursable or a wage claim, and is never sent for approval.

- **Who records**: owners, and managers (the server stamps `funding_manager_id` = the manager, so it comes out of
  their cash pool: `waves_company_pool_balance` subtracts it as `companySpend`). Employees are refused
  server-side. `p_data.paidByCompany = true` with `p_member_id` null is the only accepted shape.
- **Who sees it**: owners see all; a manager only the ones they recorded (`created_by`); employees never.
  `waves_company_paid_visible` backs `waves_can_read_company_entry` and the `company_entries_select` policy, so
  sync pulls, photos (r2-sign), exports and the signed-URL path follow it. Only owners and the recording manager can
  edit, void or attach receipts; payer mode and recorder are immutable (void and record again).
- **Reporting**: site spend and `waves_company_project_report` count it once (it stays kind `expense`); the owner
  dashboard shows "Company spent this month"; exports list it with "Paid by: Company" and a blank employee.
- **Phone**: `CompanyEntry.memberId` is '' for these (so every per-employee lookup naturally skips them);
  `purgeCompanyInvisible` keeps a manager's own via `created_by`. Business tags: materials, repairs, rent,
  utilities, equipment (+ transport, office, other).
- **Open**: a manager demoted to employee keeps their cached company-paid rows on the phone until reinstall (same gap as a demoted owner above); the server stops delivering them at once.
- **Deploy**: the sync edge function changed (null `memberId` + `paidByCompany`); deploy it with the prod rollout.

## Later

- Receipt-required as a hard block (needs an upload that survives offline, then hold the claim
  until the photo lands): warn-only today.
- Pending / unpaid filters and oldest-pending age on the admin home: quick follow-up.
- Admin-only invitations and identity-bound invites: closes the role gap listed above.
- Purge of cached company rows when a role changes: closes downloaded-data exposure.
- Project / site / customer tag per entry: useful field-force cost attribution.
- Copy last expense / bata / mileage: speeds repeated claims.
- Reminders and approval notifications: fewer pending claims.
- Audit history and reimbursement reversal: corrections and disputes.
- OCR, odometer / GPS routes, duty-based bata: less manual entry, privacy choices to make.
- Accounting export / sync, multi-level approval, partial allocation of a payment.
- Out of scope for good: cards, bank feeds, payments, payroll compliance (PF / ESI / TDS).

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
