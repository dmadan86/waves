# How a bank message reaches Waves, and what the parser does with it

Research, September 2026. Two questions were asked together and they are
genuinely different, so they are answered separately:

1. **How can a message be read at all?** The access paths, what each one costs,
   and the two that are quietly closing.
2. **What does the parser make of the message once it has it?** Measured, not
   estimated — `parseSms` was run against 25 messages written the way real
   institutions write them.

The short version:

- **The parser handles 20 of 25.** The five it does not are not exotic. They are
  **State Bank of India's UPI alert**, **ICICI's account debit**, **any credit
  card spend**, **refunds**, and **amounts written `350.00 INR`**. One of the
  five is worse than a miss: a credit-card purchase is currently classified as
  **money coming in**.
- Several messages that "pass" carry a **wrong merchant** — `VPA`, `A`, or
  nothing at all where the shop's name is plainly in the text. The most common
  cause is a single missing `i` flag.
- **Confidence is measuring the wrong thing.** It counts how many fields were
  found, not whether they are right, so the worst merchant bug in the set scores
  **1.0**.
- **The inbox is a shrinking source.** Banks are migrating alerts to RCS, which
  `READ_SMS` cannot see at all, and HDFC already stopped sending SMS for small
  UPI payments. Neither is a reason not to build this; both are reasons the
  paste and share lanes are not merely the iPhone consolation prize.

---

## 1. How a message can reach the parser

`docs/plan-drafts-and-rules.md` §1.6 covers the permission economics. This is
the same list re-cut by _what actually arrives_, which is a different question.

| path                                  | what it can see                                  | what it cannot                                                        |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `READ_SMS` (inbox read)               | every SMS in the device store, historic and new  | RCS messages; anything a bank stopped sending; app-only notifications |
| `RECEIVE_SMS` (live)                  | SMS as it arrives                                | everything above, plus anything sent before install                   |
| Share sheet                           | the one message the person shares                | everything they do not share                                          |
| Paste                                 | whatever is selected and copied                  | same                                                                  |
| Emailed statement (`import/email.ts`) | a whole month, authoritative, reconciled         | anything not on the statement yet                                     |
| Notification listener                 | every notification, including RCS and app-native | rejected on policy grounds — §1.6                                     |

### 1.1 The two that are closing

**RCS.** In 2026 RCS Business Messaging went from pilot to production in India
with Jio, Airtel and Vi all supporting it, and banks are among the first movers
for alerts — verified sender, brand logo, no 160-character limit. **An RCS
message is not an SMS.** It does not land in the SMS provider that `READ_SMS`
reads; it lives in the messaging app's own store, and there is no public API for
a third-party app to read it. Every bank that migrates its alerts is a bank
whose transactions silently stop appearing. The person will not see an error —
they will see Waves quietly stop noticing their spending.

**Small UPI payments already stopped.** HDFC Bank stopped sending SMS for UPI
payments under ₹100 sent and ₹500 received. For an expense-splitting app this is
exactly the wrong end of the range to lose: the chai, the auto, the ₹80 share of
something. Other banks are under the same cost pressure.

Neither kills the feature. Both change what it should promise. **"We will catch
your bank messages" is honest. "We will catch your spending" is not**, and the
copy should not drift toward the second.

### 1.2 Which messages are even worth reading

India's DLT regime gives a reliable filter that costs nothing. Every commercial
sender is a registered 6-character header, delivered as `XX-HEADER` where `XX`
is an operator+circle code the carrier prepends — `AD-HDFCBK` is Airtel Delhi
plus HDFC Bank's registered `HDFCBK`. Since May 2025 a message-type suffix is
appended too, which separates transactional from promotional traffic at the
header level.

Two consequences worth using:

- A **sender allowlist** of known bank headers is a far better first filter than
  running a regex over every message in the inbox, and it lets the reader touch
  dramatically fewer messages — which is both faster and a better answer to
  "why do you need my whole inbox".
- The **operator prefix must be stripped before matching**, because the same
  bank arrives as `AD-HDFCBK`, `VM-HDFCBK`, `JD-HDFCBK` depending on the
  recipient's carrier and circle. Matching the whole string is a bug that will
  look like "it works on my phone".

`parseSms` currently takes `sender` but does not use it for anything except
display. That is a free accuracy win left on the floor.

---

## 2. What the messages actually look like

Four families, and they are not stylistic variations — they need different
handling.

**Bank account debit.** `A/c`, a masked tail, a balance trailer.
`INR 1,234.00 debited from A/c no. XX3456 on 12-09-26 at AMAZON. Avl Bal INR 5,678.90`

**UPI.** The growth area and the least standardised. Often no currency token at
all, a `Ref`/`RRN`, and the counterparty as either a name or a VPA
(`swiggy@icici`). SBI's is the canonical hard case:
`Dear UPI user A/C X1234 debited by 150.0 on date 12Sep26 trf to SWIGGY Refno 526012345678`

**Card.** The word "credit" appears in `Credit Card` on messages that are
debits — a trap the current parser falls into. Verbs are different too: _spent_,
_used for a transaction of_, _transaction of_.

**Wallet / PPI.** Paytm, Amazon Pay. Shortest and least consistent; often no
account tail and no date.

---

## 3. Measured results

`parseSms` was run against 25 messages covering those four families plus the
negatives it must reject. Verbatim bodies are in §6 so this is reproducible.

**20 of 25 behaved as expected.** All six negatives were correctly rejected —
OTP-with-an-amount, scheduled autopay, balance-only, payment-due, declined, and
marketing. The rejection side is in good shape and is the side where a mistake
costs the most, so that matters.

### 3.1 The five hard failures

| #   | case                    | result               | cause                                                                                                            |
| --- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | **SBI UPI**             | dropped              | `AMOUNT` requires a currency token; SBI writes `debited by 150.0`                                                |
| 2   | **ICICI account debit** | dropped              | message says `debited` _and_ `credited` (of the payee); `debit === credit` bails                                 |
| 3   | **Credit card spend**   | **booked as income** | `CREDIT_WORDS` matches the word _credit_ inside `Credit Card`; no debit verb matches `used for a transaction of` |
| 4   | **Refund**              | dropped              | `CREDIT_WORDS` has `refund`; the message says `refunded`                                                         |
| 5   | **`350.00 INR`**        | dropped              | `AMOUNT` only matches a marker _before_ the number                                                               |

**#3 is the one to fix first.** The others lose a transaction, which the person
can see and paste again. #3 silently records a ₹2,500 purchase as ₹2,500
_received_ — a wrong ledger entry that looks deliberate. Everything downstream
trusts `direction`.

### 3.2 The quiet ones — parsed, but wrong

These all "passed" and would be pre-selected for the person to confirm:

- **`To SWIGGY` yields no merchant.** `MERCHANT` has no `i` flag, so capitalised
  `To`/`At` never match. HDFC writes `To SWIGGY`. One character fixes it.
- **Lowercase merchants never match.** The capture requires `[A-Z0-9]` first.
  `at bigbasket` yields nothing.
- **`to VPA swiggy@icici` yields the merchant `VPA`** — the literal word,
  because `to\s+(...)` grabs it before the alternation reaches `VPA`. Scored
  **confidence 1.0**.
- **`credited to A/c XX1234` yields the merchant `A`.** The `A` of `A/c`.
- Amazon Pay and the plain SBI shape yield no merchant at all.

A draft whose merchant reads `VPA` or `A` is worse than one with no merchant:
the inbox shows a row that looks parsed, and the person has to notice it is
nonsense.

### 3.3 Confidence is measuring the wrong thing

> `confidence` starts at 0.55 and adds for merchant, reference, date, tail.

It counts _fields found_, never _fields plausible_. So the `VPA` bug scores 1.0
and is pre-selected, while a perfectly-parsed wallet message with no date and no
tail scores 0.7. The comment in the source is honest about this — "how much of
the message we actually understood" — but the number is used as if it meant
correctness, and `SMS_LOW_CONFIDENCE` gates pre-selection on it.

Minimum fix: a merchant that is a known stop-word (`VPA`, `A`, `A/C`, `UPI`,
`REF`, a bare number) should score _nothing_, not `+0.2`.

---

## 4. Recommendations, in order

1. **Stop reading `credit` inside `Credit Card`.** Strip card phrases before the
   direction test, and add the missing debit verbs (`used for a transaction of`,
   `transaction of`, `txn of`). Fixes the only failure that writes a wrong
   ledger entry.
2. **Make the currency token optional.** When a debit verb and an account
   pattern are present, a bare `150.0` is an amount. Default to the account's
   currency, not to a body-wide guess. Recovers SBI — the largest bank in India.
3. **Direction by proximity, not presence.** Take the verb nearest the amount
   rather than bailing when both appear. Recovers ICICI, which is simply
   describing both sides of a transfer.
4. **Add the `i` flag to `MERCHANT`, allow lowercase, and stop-word the
   captures.** The cheapest quality win in the document.
5. **Read VPAs properly.** `swiggy@icici` should yield `swiggy` — and
   `normaliseMerchantName` in `category/merchant.ts` already exists to tidy it.
6. **Accept a trailing currency** (`350.00 INR`).
7. **Use the sender.** Strip the `XX-` operator prefix, match a bank allowlist,
   and let a known bank header raise confidence and a non-bank header skip the
   message entirely.
8. **Re-base confidence on plausibility**, per §3.3.

1–4 are small, self-contained changes to a pure function with an existing test
suite. They are worth doing before anybody tests the feature on a real inbox,
because the first impression of this feature is entirely a function of its hit
rate.

## 5. What this research did not do

No real inbox was read — every message here is written to match documented
formats, not captured from a device. Bank wording changes without notice and
varies by product within one bank. The corpus is India-heavy, with two foreign
cases (USD, AED) and none from a European or US bank. RCS displacement is
reported from public sources, not measured. And nothing here has been run on a
device: these are results from the pure parser, which is the right place to
test it, but not the same as the feature working.

## 6. The corpus

Reproducible — 25 bodies, the four families plus the negatives, with the
expected direction for each. Stored alongside this document as
`sms-parser-corpus.md` so a fix can be measured against the same set rather than
against a new one that happens to pass.
