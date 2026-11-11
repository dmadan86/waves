# Waves sales playbook

Positioning: Waves is WhatsApp for finance. People already coordinate money in chats; Waves makes the chat keep the books. Everything below is true of the shipped app. Prices are quoted from `packages/core/src/billing/plans.ts` and are not changed by this document.

Facts to lean on:
- Free: unlimited people, expenses, currencies, splits and settle-up; ad-supported; your first group is free. New accounts get 15 days of Pro, no card (`docs/pricing.md`).
- Pro: no ads, 100 AI voice commands and 300 receipt scans a month, 3 devices. India: Rs 79/month or Rs 699/year. Other markets are priced per country in the table in `plans.ts` and by the stores.
- Companies: first company free; each extra company is a monthly store subscription. Roles are Owner, Manager and Employee; employees see only their own entries. Android and web today, iPhone coming soon. Bills and estimates are simple documents, not GST tax invoices.
- Works offline; the shared ledger is on our server and is not end-to-end encrypted (say so plainly, it builds trust).

## 1. Friend groups, roommates and trips

- Pain: someone fronts the villa, the fuel and the dinners, then chases people for weeks. Spreadsheets die by day two.
- Value: add the bill, split any way, see who owes whom, settle via UPI hand-off. Guests join from a link, even in a browser. Works with no signal on the trail.
- Pitch line: "Split the trip in a minute, settle by UPI, never chase anyone."
- Objections
  - "Everyone has to install it." No: a link or QR joins them in a browser with a free account.
  - "Splitwise already does this." Waves has UPI hand-off, offline, voice and receipt scan, and unlimited splits on Free. See `/compare`.
  - "I do not want ads." Ads are never on the settle-up screen; Pro removes them (Rs 79/month).
- Channels: the trip's own WhatsApp group (the organiser posts the join link), college and hostel groups, travel and trekking communities, flatmate-search groups. Ask: "paste the link in the group before you book."

## 2. Families

- Pain: shared household costs, a parent paying for everything, siblings splitting a family event, and nobody wants their own spending seen.
- Value: a shared group for the household plus a private personal tab (spending by category, budgets, loans, repeating bills) that is not visible to the group. Bank SMS and statements become entries you review.
- Pitch line: "One place for the household's money, and a private one for yours."
- Objections
  - "Is my own spending private from the group?" Yes, the personal ledger is private to you.
  - "My parents will not learn a new app." One screen per job; voice entry means they can say it.
  - "Is Pro worth it?" Free covers the core; Pro is for scan volume, statement import and no ads. Try the 15 free Pro days first.
- Channels: family WhatsApp groups (one member sets it up and shares the link), festival and wedding planning groups, personal-finance creators and newsletters.

## 3. Indian small businesses, 5 to 50 staff (contractors, shops, site-based firms)

- Pain: staff send fuel and travel bills on WhatsApp, the owner re-types them into a notebook or Excel, wages and advances are argued at month end, attendance lives on paper.
- Value: employees add expenses with a photo, the owner approves in a tap; daily allowance (bata) and mileage at your rates; attendance in one tap feeding the wage run; advances netted off wages; tasks with photos; estimates and bills with a UPI QR; vendors, clients, files, leave. Employees see only their own entries.
- Pitch line: "Your team's money, as simple as a chat."
- Objections (answers also live in the companies page FAQ)
  - "Is my data safe?" Role-based visibility, private photos on expiring links, on-device encryption at rest, never sold. Not end-to-end encrypted; the server is what lets phones agree.
  - "My staff do not have smartphones." Owners and managers can mark attendance and record advances and wages for the team; staff who add their own claims need Android or a browser. Be honest about this and size the pilot to the people who do have phones (usually site supervisors).
  - "We use Tally/Excel." Waves is not a replacement for GST accounting; it is the daily layer before it. Export PDF/Excel for the CA.
  - "Do I need GST invoices?" Not today. Bills here are simple documents. Do not promise GST.
  - "What does it cost?" First company free. Extra companies are a monthly store subscription.
  - "iPhone?" Coming soon; Android and web today.
- Channels: CA and accountant referrals (they want cleaner monthly data from clients), trade and contractor associations (builders', electricians', transporters'), contractor communities on WhatsApp and Facebook, supplier and dealer networks, local shop-owner groups.

### B2B sales motion

1. Find: trade association talk or a CA referral. Qualifier: 5 to 50 staff, money moves through WhatsApp today, someone owns "the notebook".
2. Free trial path (no change needed, the product already works this way): owner installs, creates a company (first one free), invites 2 to 3 supervisors by link. No card at any step.
3. Demo script (15 minutes, on the owner's own phone)
   - 2 min: ask how a fuel bill reaches them today.
   - 3 min: employee phone adds a fuel expense with a photo; owner approves in a tap.
   - 3 min: mark today's attendance; open the wage run; record an advance and show it netted.
   - 3 min: assign a task with a photo; send an estimate with a UPI QR.
   - 2 min: show what an employee can and cannot see.
   - 2 min: agree the pilot: which site, which three people, review in 7 days.
4. Onboarding offer (recommendation, needs owner sign-off): we set up the company, import the staff list (file, contacts or Google Sheet are supported), and join the first week's check-in by WhatsApp.
5. Expand: second site or second company (paid slot), then Pro for the owner (no ads, scans).

### Pricing and packaging (recommendations only, no changes made)

- Keep "first company free" as the wedge; it removes the approval step for a small owner.
- Test an annual extra-company price alongside monthly, mirroring Pro (yearly Rs 699 vs Rs 948 for 12 months, about 26% off).
- Consider a "Business setup" one-off service (India) for owners who want hands-on onboarding.
- Pro for the owner is a natural upsell, not a company prerequisite: do not blur the two on the page.

## Social proof we do not have yet

Never invent any. Collect real quotes and numbers from:
- A trip organiser after settling a trip (quote, plus how many people, with permission).
- A parent or sibling running a household group.
- A contractor or shop owner after a 2-week pilot: hours saved per month, advances disputes avoided.
- A CA who referred two or more clients.
- Aggregate counts (companies, groups, rupees settled) only from our own first-party events once real.

## What the owner must supply

- A sales WhatsApp number: set `NEXT_PUBLIC_SALES_WHATSAPP` (digits with country code). Until set, the companies page shows only an email button to `hello@wavs.co.in`.
- Confirmation that the onboarding offer wording on the companies page ("help you set up, import your staff and run your first week") is something you will deliver.
- The real quotes above.
