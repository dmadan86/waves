# Waves sales playbook

Positioning: Waves helps you record shared spending and manage team expenses that would otherwise get lost in chats. Friends track splits; businesses track claims, advances and wages. Feature availability depends on platform and rollout. Confirm the current release and store offer before quoting.

Do not say "WhatsApp for finance" to a prospect, or imply a WhatsApp integration or automatic extraction from existing chats. Waves is its own app.

This is a static-repository view: code shows what is implemented, not what is live in production, in the stores, or what customers achieve. Prices below come from `packages/core/src/billing/plans.ts`, `docs/pricing.md` and the website, which disagree in places (prices, ads, credit gates). Agree one approved entitlement matrix before sales treats any of them as authoritative.

Facts to lean on (all subject to the caveat above):

- Free: unlimited people, expenses, currencies, splits and settle-up; ad-supported; your first group is free; 20 receipt scans a month. New accounts get a 15-day Pro trial, no card. Trial voice is 20 commands over 30 days, not the normal monthly allowance.
- Pro (India): Rs 79/month or Rs 699/year; no ads, 100 AI voice commands a month, 100 screenshot imports and 30 statement imports a month, 3 devices. Other markets are priced per country in `plans.ts` and by the stores.
- Companies: first company free. Roles are Owner, Manager and Employee; employees see only their own entries. Android and web today; company features are off on native iOS and there is no release date to quote. Bills and estimates are simple documents, not GST tax invoices.
- Offline: record expenses offline and sync later. Joining, AI features and payments need connectivity.
- Encryption: the ledger saved by the native app is encrypted at rest; the browser copy is not. The shared ledger is on our server and is not end-to-end encrypted. Say so plainly.
- "Never sold" is a policy commitment, not something the code proves.

## Pricing and packaging

|                   | Free           | Pro (individual)                                                         | First company                    | Extra company slot                                                                            |
| ----------------- | -------------- | ------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Buyer             | Anyone         | The individual user (an owner buying Pro does not buy it for staff)      | Owner, at no cost                | Owner                                                                                         |
| Entitlement scope | That account   | That account only; not every employee                                    | That company                     | One additional company per slot                                                               |
| Quota             | 20 scans/month | 100 voice, 100 screenshot imports, 30 statement imports/month; 3 devices | Per Free/Pro limits of each user | Per user limits                                                                               |
| Price source      | None           | `plans.ts` (India Rs 79/mo, Rs 699/yr) and store price                   | None                             | Store price for the one configured slot product; show it before the owner starts an expansion |
| Renewal           | None           | Store subscription                                                       | None                             | Store subscription, monthly                                                                   |
| Cancellation      | n/a            | Through the store                                                        | n/a                              | Through the store                                                                             |
| On lapse          | n/a            | Falls back to Free limits                                                | Stays free                       | Verify end-to-end before selling what happens to the extra company                            |

Rules:

- The first company is free and is the wedge. A 50-person business can stay on it; more staff or another site inside the same company does not itself trigger payment. Do not promise a paid path that the product does not enforce.
- Only one slot product ID is configured and purchase code excludes an already-held product. Do not promise arbitrary additional companies. "Each extra company" is not a repeatable offer today.
- A second site within the same company does not require a paid slot.
- `plans.ts` also lists a Rs 149 Trip Pass and a Rs 1,999 Lifetime plan. Those entries do not prove a purchasable, working offer. Verify end-to-end before selling.
- Pro for the owner is an optional upsell, not a company prerequisite.
- Assisted onboarding is a separately scoped service experiment, not included unlimited support (see Onboarding offer).
- Revenue reality: Pro at Rs 699/year cannot fund repeated demos, migration and WhatsApp support. Treat B2B as a learning motion until the metrics below show contribution that covers founder time.

## 1. Consumers

### Trips (primary consumer test)

- Pain: someone fronts the villa, the fuel and the dinners, then has to follow up for weeks.
- Test: the organiser of an upcoming group trip. Start before the first shared booking, record that expense, and invite the other participants.
- Pitch: "Keep trip spending together, see who owes whom, and open your UPI app to pay."
- Reality: a UPI hand-off and recording a settlement are separate steps. Waves cannot guarantee that anyone pays. Never say "never chase anyone" or "in a minute".
- Invitees can join through a browser after creating or signing into a free account. Anonymous guests cannot join shared groups.
- Offline: record expenses offline and sync later; joining, AI and payments need connectivity.
- Objections
  - "Everyone has to install it." Invitees can join in a browser with a free account, no app download needed.
  - "Splitwise already does this." Waves has UPI hand-off, offline recording, voice and receipt scan. See `/compare`. Confirm current Free limits before comparing.
  - "I do not want ads." Ads are never on the settle-up screen; Pro removes them.
- Channels: organiser-shared invitations; administrator-approved community demonstrations (trekking, college, hostel groups). Use repeat-activation data before buying creator placements.

### Roommates (separate test)

- Test with a recurring monthly expense (rent, power, groceries). The goal is a habit, so measure four-week activity, not one-off use.
- Channels: flatmate-search groups with admin approval.

### Families (separate test)

- Start with one shared event or household cost and one willing coordinator. Adoption and privacy are the concerns, not deadlines.
- Value: a shared group, plus a private personal tab (categories, budgets, loans, repeating bills) not visible to the group. Introduce personal budgets and statement import only after the shared workflow works.
- Objections
  - "Is my spending private from the group?" Yes, the personal ledger is private to you.
  - "My parents will not learn a new app." Start with one coordinator who records for others; add voice only if they want it. Do not promise it works well in every language.
  - "Is Pro worth it?" Free covers the core; Pro is for higher scan and import volume and no ads. Try the 15-day trial first.
- Qualifications: automatic bank-SMS reading needs Android, an enabled build, runtime rollout and a non-guest account; pasted SMS is a separate path. Statement import is a Pro feature.

## 2. Initial B2B ICP hypothesis (small businesses)

An owner-managed contractor or field-service firm with 5 to 25 workers, one owner and 1 to 3 smartphone-using supervisors, recurring out-of-pocket claims, and weekly or monthly advance reconciliation.

- Buyer: owner. Champion: supervisor or bookkeeper.
- Qualify for: repeated re-entry of bills, delayed approvals or disputed advances, and willingness to run a seven-day pilot.
- Defer: buyers whose primary requirement is inventory, GST invoicing, statutory payroll or a Tally integration. Retail shops seeking stock, POS or GST accounting are likely to misread the fit.
- This is a testable starting segment, not market evidence. Start in one geography and a language the founder can support.

Value: employees add expenses with a photo and the owner approves in a tap; daily allowance (bata) and mileage at your rates; attendance feeding a wage calculation; advances netted off wages; tasks with photos; vendors, clients, files, leave. Employees see only their own entries.

Estimates and bills: send estimates; eligible INR bills can include a UPI payment QR when a payee VPA is configured. Estimates do not carry the QR. Documents are not GST tax invoices.

Google Sheets import works only with a link-shared/public CSV export, not authenticated private Sheets. Prefer a file for sensitive staff data.

### Objections

- Staff adoption: "Let one supervisor try a real claim on their own phone. The owner or manager can record entries for staff who cannot use the app." Staff who add their own claims need Android or a browser.
- GST: "If you need GST tax invoices, Waves does not meet that requirement today."
- Tally: "Export PDF/Excel for review and manual accounting work. Validate a sample with your accountant; we are not promising a direct Tally integration."
- Switching: "Try one new trip or one site first. Keep your existing records until you trust the result."
- Data safety: role-based visibility, private photos on expiring links, ledger encryption at rest in the native app (the browser copy is not encrypted at rest), not end-to-end encrypted, and a policy of not selling data.
- Cost: first company free; extra companies are a separate store subscription, so show the current store price. Never quote "each extra company" as repeatable.
- iPhone: company features are off on native iOS; do not give a date.

### Sales motion

1. Find: for the first cohort, warm introductions from three accountants or bookkeepers. Give each a sample export and ask which client repeatedly sends incomplete expense records. The partner introduces; Waves demonstrates and supports. Attribute every introduction.
2. Trial path: owner installs, creates a company (first one free), invites 1 to 3 supervisors by link. No card.
3. Discovery before demo. Ask: "Show me the last fuel claim. Who entered it again? Who approved it? What was disputed last month? Who will own this pilot?"
4. Demo (15 minutes, owner's phone). Show only the highest-priority workflow: a supervisor records a photographed claim, the owner reviews it, then inspect the balance and export. Show employee visibility. Use prepared wage data only if wage reconciliation is the buying trigger (wages need configured rates and usable attendance). Do not tour estimates, tasks and permissions in the same call.
5. Close: "Which supervisor will submit the first real claim, by when, and when will we review the result?"
6. Follow-up (day 2 or 3): "You identified repeated fuel-bill entry as the problem. Has the first claim reached the owner? If blocked, reply with the step where it stopped."
7. Expand: only through what the product actually enforces (see packaging). Pro for the owner is optional.

### Onboarding offer (proposed limits, not a commitment)

The owner has not confirmed any onboarding service. Until they do, the website says only "Write to us and we will help you get started". If approved, the proposal is:

- Assisted pilot onboarding by appointment: one 30-minute setup session, one agreed staff file of up to 25 rows, and one 15-minute review after seven days.
- The customer supplies validated names, roles, rates and opening balances and approves the import.
- Target first response within two business days in published support hours; this is not a resolution guarantee.
- Cap assisted starts at two companies per week (sessions alone use 90 minutes a week before preparation, support and sales).

## 3. Funnel metrics and stop rules

Define each term before running a cohort, and set experimental targets in advance, labelled as hypotheses.

B2B, weekly, by source: introductions, qualified owners, demos held, pilots started, activated pilots, retained companies, paid purchases.

- Activation: a non-owner submits a real claim and the owner reviews it within seven days.
- Retention: four-week usage of the same recurring workflow.
- Record per account: founder minutes, purchase type, net receipts, reason lost.

Consumers, by organiser cohort: group created, first expense, another member joins or contributes, settlement recorded. Measure repeat-trip creation for travellers and four-week activity for roommates. Do not count UPI hand-offs as verified money transferred.

Economics:

- CAC: acquisition spend plus founder acquisition time at an explicit hourly rate.
- Contribution: net receipts less AI, storage, support and partner costs.
- Payback: CAC divided by monthly contribution.

Stop or change the motion if payback is not plausible within the cohort's target window.

## 4. Partners

- Start with unpaid CA introductions. ICAI's Code of Ethics makes a blanket CA commission programme inappropriate without checking the arrangement (https://disc.icai.org/code-of-ethics/). Any compensated arrangement needs confirmation that it is permissible for that practitioner.
- For eligible non-CA partners (associations, suppliers), test a fixed bounty after a collected, non-refunded paid purchase, capped within an agreed share of first-year contribution. No payout for installs or free companies.
- Review activation, retention and founder time per partner before expanding.

## Social proof we do not have yet

Never invent any. Collect real quotes and numbers from:

- A trip organiser after settling a trip (quote, plus how many people, with permission).
- A parent or sibling running a household group.
- A contractor after a two-week pilot: time saved, advance disputes avoided.
- A CA who referred two or more clients (check ICAI rules before asking).
- Aggregate counts only from our own first-party events once real.

## What the owner must supply

- A sales WhatsApp number: set `NEXT_PUBLIC_SALES_WHATSAPP` (digits with country code). Until set, the companies page shows only an email button to `hello@wavs.co.in`.
- A decision on whether to offer assisted onboarding, and on which limits. The website makes no onboarding promise until then.
- An approved entitlement and price matrix, and a check of the Trip Pass, Lifetime and extra-company-slot flows end to end.
- The real quotes above.
