# Play Console: the text and the answers

Everything the console asks for that is words rather than pictures, ready to
paste. The claims here are drawn from `website/src/i18n/dictionaries/en.json`
and the privacy policy, so the store listing, the marketing site and the policy
say the same things — a store listing that promises something the policy
contradicts is a review problem, not a copywriting one.

Graphics are not here and cannot be: the 512×512 icon, the 1024×500 feature
graphic and the screenshots have to be made.

---

## Store listing

### App name (30 characters max)

```
Waves: Split Bills & Expenses
```

29 characters. `Waves` alone is too generic to find; the suffix is what the
search actually matches.

### Short description (80 characters max)

```
Split bills, see who owes what, settle up. Works offline. Free is ad-supported.
```

73 characters. Offline is the differentiator against Splitwise, so it earns the
second sentence.

### Full description (4000 characters max)

```
Waves splits a bill any way you need, keeps the balance in every currency you
spent, and hands the settlement to the payment app you already use.

It works with the network off.

EVERY KIND OF SPLIT, NONE OF THE ARITHMETIC
Equal, exact amounts, shares, percentages, or one person covering someone else.
The split always adds back to the bill, to the last paisa — amounts are stored
as whole minor units, never as decimals that drift.

• Equal, exact, shares and percentage splits
• Split one bill between two groups of people
• Comment on any expense when the memory gets fuzzy
• A full edit history, so nothing changes quietly

ADD AN EXPENSE WITH NO NETWORK AT ALL
Waves writes to your phone first and syncs later. A restaurant with no signal, a
flight, a mountain road — none of it stops the ledger.

• Everything works with the network off
• Conflict-safe sync when you come back
• The copy on your device is encrypted at rest
• Sign out and that local copy becomes unreadable

ONE TRIP, FOUR CURRENCIES, NO SPREADSHEET
Set the rate you actually got, once, and every expense on the trip converts the
same way — so the total at the end matches the total you really paid.

• Fix a rate per bill, per person, or per trip
• Trip and per-category budgets that warn before they break
• Attach a place to any expense
• A shared album for the trip's receipts and photos

SCAN IT, OR JUST SAY IT
Point the camera at a receipt and Waves reads the line items for you: the photo is
uploaded and read by an AI service, then shown for you to check. Or hold the microphone and say it — "twelve fifty for coffee, split with
Nadia" — and the expense arrives filled in, ready to check before it is saved.

• Receipt scanning that itemises the bill
• Voice capture, several expenses in one breath
• Capture now with no group, file it later
• Keep the photo on your own device if you prefer

SETTLE UP FOR REAL
Waves works out the fewest payments that clear the group, then hands the amount
to your payment app. It never takes custody of your money — the payment happens
between you and your provider.

IN YOUR LANGUAGE
English, Tamil, Hindi and Arabic, with full right-to-left layout.

PRIVATE BY DEFAULT
Waves Free is supported by ads: small ads marked "Ad" on some screens, an occasional
full-screen ad after you save a group expense, and short video ads you can watch for
credits. Ads are never personalized and never on the settle-up screen. Pro has no
ads. We never sell your data and never share your expenses, groups or balances with
advertisers. Your private ledger can be backed up, encrypted, to your own Google
Drive. You can export everything, and delete your account, from inside the app.

Privacy policy: https://wavs.co.in/en/privacy
Delete your account: https://wavs.co.in/en/delete-account
```

Roughly 2,100 characters, inside the limit with room to grow.

### URLs

| Field            | Value                                  |
| ---------------- | -------------------------------------- |
| Privacy policy   | `https://wavs.co.in/en/privacy`        |
| Account deletion | `https://wavs.co.in/en/delete-account` |
| Website          | `https://wavs.co.in`                   |
| Support email    | `hello@wavs.co.in`                     |

### Category

Finance. (Not "Productivity" — the ledger, the currencies and the settlements
are all financial, and reviewers read the category against the permissions.)

---

## Data safety

The answers below come from the privacy policy's "What we collect", "Where it is
stored", "Who processes it for us" and "How long we keep it". **If you change one
of these answers, change the policy too** — Play compares them, and a
contradiction is a takedown rather than a warning.

### The two questions asked about everything

- **Is all data encrypted in transit?** — **Yes.** Every network call is HTTPS.
- **Can users request that data be deleted?** — **Yes**, and give the deletion
  URL above.

### Data types collected

Truth source: `docs/disclosures-audit.md` section 4.3 (production ad flags are on for Free).

**Overview**

| Question                                                            | Answer                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Does your app collect or share any of the required user data types? | Yes                                                                                     |
| Is all of the user data collected by your app encrypted in transit? | Yes                                                                                     |
| Account creation methods                                            | Username and other authentication (email or phone one-time code); OAuth (Google, Apple) |
| Delete account URL                                                  | `https://wavs.co.in/en/delete-account`                                                  |

"Shared" follows Play's definition: not a processor acting on our instructions, not
user-initiated, not legal. Google AdMob is not such a processor, so its rows are Shared.
Anything not listed below is **No**: Health and fitness, Emails, Videos, Music files,
Calendar, Installed apps, In-app search history, Other actions, Web browsing, Credit
score, Race, Political or religious beliefs, Sexual orientation, Other info, and SMS or MMS.

| Category -> type                             | Collected                                      | Shared                                                     | Ephemeral | Required / Optional | Purposes (collected)                                                                              | Purposes (shared)                                                   |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Location -> Approximate location             | Yes                                            | **Yes** (AdMob, from IP)                                   | No        | Required            | App functionality; Advertising or marketing; Fraud prevention, security and compliance            | Advertising or marketing; Fraud prevention, security and compliance |
| Location -> Precise location                 | Yes                                            | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| Personal info -> Name                        | Yes                                            | No                                                         | No        | Required            | App functionality; Account management                                                             | n/a                                                                 |
| Personal info -> Email address               | Yes                                            | No                                                         | No        | Required            | App functionality; Account management; Developer communications                                   | n/a                                                                 |
| Personal info -> User IDs                    | Yes                                            | **Yes** (account ID sent to AdMob for reward verification) | No        | Required            | App functionality; Account management; Analytics; Fraud prevention, security and compliance       | Advertising or marketing; Fraud prevention, security and compliance |
| Personal info -> Address                     | Yes                                            | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| Personal info -> Phone number                | Yes                                            | No                                                         | No        | Optional            | App functionality; Account management                                                             | n/a                                                                 |
| Financial info -> User payment info          | Yes (UPI ID, bank account or IBAN as a handle) | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| Financial info -> Purchase history           | Yes                                            | No                                                         | No        | Required            | App functionality; Account management                                                             | n/a                                                                 |
| Financial info -> Other financial info       | Yes (the ledger)                               | No                                                         | No        | Required            | App functionality                                                                                 | n/a                                                                 |
| Messages -> SMS or MMS                       | **No**                                         | n/a                                                        | n/a       | n/a                 | n/a                                                                                               | n/a                                                                 |
| Messages -> Other in-app messages            | Yes (expense comments)                         | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| Photos and videos -> Photos                  | Yes                                            | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| Audio files -> Voice or sound recordings     | **Yes**                                        | No                                                         | **Yes**   | Optional            | App functionality                                                                                 | n/a                                                                 |
| Files and docs -> Files and docs             | Yes (bank statement import, Pro)               | No                                                         | **Yes**   | Optional            | App functionality                                                                                 | n/a                                                                 |
| Contacts -> Contacts                         | Yes                                            | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| App activity -> App interactions             | Yes                                            | **Yes** (AdMob ad interactions)                            | No        | Required            | Analytics; Advertising or marketing                                                               | Advertising or marketing; Fraud prevention, security and compliance |
| App activity -> Other user-generated content | Yes (notes, descriptions, group names)         | No                                                         | No        | Optional            | App functionality                                                                                 | n/a                                                                 |
| App info and performance -> Crash logs       | Yes                                            | No                                                         | No        | Required            | Analytics                                                                                         | n/a                                                                 |
| App info and performance -> Diagnostics      | Yes                                            | **Yes** (AdMob SDK diagnostics)                            | No        | Required            | Analytics                                                                                         | Advertising or marketing; Fraud prevention, security and compliance |
| Device or other IDs -> Device or other IDs   | Yes                                            | **Yes** (AdMob)                                            | No        | Required            | App functionality; Analytics; Advertising or marketing; Fraud prevention, security and compliance | Advertising or marketing; Fraud prevention, security and compliance |

The four AdMob rows (Approximate location, App interactions, Diagnostics, Device or
other IDs) follow Google's published Data safety guidance for the Mobile Ads SDK. User
IDs "Shared" is the cautious reading of the reward-verification account id. Microsoft
Clarity session replay is opt-in; if Clarity is not a pure processor, App interactions
is also shared for it (audit open question 4).

### The answers worth getting right

**Voice: collected, processed ephemerally, optional.** With advanced voice on (Pro and
trial), audio is streamed to our server and Deepgram and not stored.

**Location: optional.** Once permission is granted, coordinates and a place name are
stamped on a new expense (foreground only, never in the background) and can be removed
before saving. Contacts are read only when somebody taps to pick a person.

**Analytics: required.** A few app steps are always counted in our own database.
Session replay (Microsoft Clarity) is separate and opt-in.

### Financial info — the extra questions

Play asks follow-ups for financial data. The honest answers:

- **Payment info**: collected only as a payment _handle_ (a UPI ID or similar) so
  a settlement can be handed to a payment app. No card numbers, no bank
  credentials, no payment is ever processed by Waves.
- **Other financial info**: the ledger — amounts, currencies, splits, who paid.
  This is the app.

---

## Content rating

The questionnaire is short and every answer is "no": no violence, no sexual
content, no profanity, no controlled substances, no gambling, no user-to-user
sharing of _unmoderated public_ content.

One question needs care: **does the app let users interact or share content?**
Yes — expense comments and shared group photos, but only inside a private group
somebody was invited to, never publicly. Answer yes and describe it that way.

## Target audience

18 and over. Not designed for children; matches the privacy policy's Children section.

## Ads

**Contains ads: Yes.** Free only, Google AdMob, non-personalized: native cards and banners on list screens, a paced full-screen ad after a saved group expense, and rewarded video (optional for credits, required for exports and for groups after the first two when credits run out). Never on settle-up. Pro and trial have none. Facts: docs/disclosures-audit.md.

Advertising ID: Yes (Advertising or marketing; Fraud prevention, security and compliance).
