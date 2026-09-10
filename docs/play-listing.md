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
Split any bill, track who owes what, and settle up. Works with no network.
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
Point the camera at a receipt and Waves pulls the line items out on the device
itself. Or hold the microphone and say it — "twelve fifty for coffee, split with
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
No advertising. No data sold, ever. No third-party tracking pixels. Receipt
photos can stay on your device or go to your own Google Drive, Dropbox or
OneDrive instead of our servers — you choose, per photo. You can export
everything, and delete your account, from inside the app.

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

"Shared" below means shared with a third party for _their_ purposes. Sending
data to a processor acting on our instructions is not sharing, and Play says so
explicitly — which is why every row is "not shared" even though the ledger
plainly reaches a database.

| Data type                         | Collected | Shared | Optional?    | Purpose                                        |
| --------------------------------- | --------- | ------ | ------------ | ---------------------------------------------- |
| Name                              | Yes       | No     | Required     | App functionality (who owes whom)              |
| Email address                     | Yes       | No     | Required     | Account management, App functionality          |
| User IDs                          | Yes       | No     | Required     | Account management                             |
| Phone number                      | Yes       | No     | **Optional** | App functionality (finding people you know)    |
| Payment info (UPI handle etc.)    | Yes       | No     | **Optional** | App functionality (settling up)                |
| Purchase history                  | Yes       | No     | Required     | App functionality (subscription state)         |
| Other financial info (the ledger) | Yes       | No     | Required     | App functionality                              |
| Approximate location              | Yes       | No     | **Optional** | App functionality (a place on an expense)      |
| Precise location                  | Yes       | No     | **Optional** | App functionality (a place on an expense)      |
| Contacts                          | Yes       | No     | **Optional** | App functionality (picking who was there)      |
| Photos                            | Yes       | No     | **Optional** | App functionality (receipts, proofs, albums)   |
| Voice or sound recordings         | **No**    | —      | —            | See below                                      |
| App interactions                  | Yes       | No     | **Optional** | Analytics — opt-in, off by default             |
| Crash logs                        | Yes       | No     | Required     | Diagnostics                                    |
| Diagnostics                       | Yes       | No     | Required     | Diagnostics                                    |
| Device or other IDs               | Yes       | No     | Required     | App functionality (push delivery, device list) |

### The three answers worth getting right

**Voice: not collected.** Speech is transcribed on the device and the recording
is discarded; no audio leaves the phone and none is stored. Declaring it
collected would be false in the direction that costs users trust for nothing.

**Location and contacts: optional.** Both are behind an explicit tap — location
when somebody attaches a place, contacts when somebody picks a person. Neither
is read in the background. Play distinguishes optional from required, and
marking these required would misdescribe the app.

**Analytics: optional.** The product-analytics toggle is off until a person
turns it on, in Settings.

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

18 and over. Not designed for children; matches the privacy policy's Children
section, which says Waves is not directed at under-13s.

## Ads

**No ads.** There is no advertising SDK in the app.
