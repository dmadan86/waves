# How a bank message reaches Waves, and what the parser does with it

Research, September 2026. Two questions were asked together and they are
genuinely different, so they are answered separately:

1. **How can a message be read at all?** The access paths, what each one costs,
   and the two that are quietly closing.
2. **What does the parser make of the message once it has it?** Measured, not
   estimated — `parseSms` was run against 61 messages written the way real
   institutions write them, in fifteen languages.

**Updated September 2026.** The corpus has since grown to 61 messages and the
parser has been internationalised. Everything below is re-measured; §3 now
carries both the original numbers and the current ones, and §4 records which of
the recommendations were acted on.

The short version:

- **The parser handled 20 of 25, and now handles 61 of 61.** The five it used to
  drop were not exotic: **State Bank of India's UPI alert**, **ICICI's account
  debit**, **any credit card spend**, **refunds**, and **amounts written
  `350.00 INR`**. One of the five was worse than a miss — a credit-card purchase
  was classified as **money coming in**. All five are fixed.
- **The worst bug was not in the original 25 at all.** `EUR 1.234,56` — the way
  half of Europe and most of Latin America write an amount — read as **€1.23**,
  a thousandfold error, accepted at confidence 0.9 and pre-selected. It is
  corpus case 61, and it is the reason the international pass happened.
- Several messages that "passed" carried a **wrong merchant** — `VPA`, `A`, or
  nothing at all where the shop's name was plainly in the text. The most common
  cause was a single missing `i` flag. Fixed, and the captures now have to pass
  a plausibility test before they count.
- **Confidence was measuring the wrong thing.** It counted how many fields were
  found, not whether they are right, so the worst merchant bug in the set scored
  **1.0**. It is now based on plausibility, and every field the parser had to
  guess costs it.
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

`parseSms` used to take `sender` and use it for nothing except display. It now
strips the operator prefix and, when the header looks like a financial
institution, adds a little confidence. It is a hint and never a filter: an
unrecognised header changes nothing, because a bank this list has not heard of
is still a bank, and nothing in the logic assumes the Indian `XX-HEADER` shape —
a bare `SANTANDER` or `CHASE` is read as itself.

---

## 2. What the messages actually look like

Four families inside India, and a fifth everywhere else. They are not stylistic
variations — they need different handling.

**Bank account debit.** `A/c`, a masked tail, a balance trailer.
`INR 1,234.00 debited from A/c no. XX3456 on 12-09-26 at AMAZON. Avl Bal INR 5,678.90`

**UPI.** The growth area and the least standardised. Often no currency token at
all, a `Ref`/`RRN`, and the counterparty as either a name or a VPA
(`swiggy@icici`). SBI's is the canonical hard case:
`Dear UPI user A/C X1234 debited by 150.0 on date 12Sep26 trf to SWIGGY Refno 526012345678`

**Card.** The word "credit" appears in `Credit Card` on messages that are
debits — a trap the original parser fell into. Verbs are different too: _spent_,
_used for a transaction of_, _transaction of_.

**Wallet / PPI.** Paytm, Amazon Pay. Shortest and least consistent; often no
account tail and no date.

### 2.1 And a fifth family, which is everywhere else

The four above are how an _Indian_ bank writes. Outside India the shape is
familiar but three things underneath it are not, and all three fail silently
rather than loudly:

- **The decimal point is a comma.** `EUR 1.234,56` in Germany, Spain, Brazil,
  Indonesia, Turkey and most of Latin America. Read with English assumptions it
  is €1.23.
- **Not every currency has two decimals.** KWD, BHD, OMR, JOD and TND have
  three; JPY, KRW, VND, CLP and ISK have none.
- **The date is month-first** in the United States and nowhere Waves currently
  ships, and `08/05/2026` gives no hint which it is.

There is also a fourth thing that fails loudly and is therefore easier: the
message may be in Arabic, Thai, Hindi, Vietnamese or German, may write its
numbers in Devanagari or Arabic-Indic digits, and may wrap its amount in
invisible bidi controls so it renders correctly inside right-to-left text.

---

## 3. Measured results

`parseSms` was run against 25 messages covering those four families plus the
negatives it must reject, and later against 61 covering the fifth as well.
Verbatim bodies are in §6 so this is reproducible.

**Then: 20 of 25.** All six negatives were correctly rejected —
OTP-with-an-amount, scheduled autopay, balance-only, payment-due, declined, and
marketing. The rejection side was in good shape and is the side where a mistake
costs the most, so that mattered.

**Now: 61 of 61**, on a corpus that grew from 25 messages to 61. The same
`01b5f678` parser scores **35 of 61** on that wider set. All twelve negatives are
still rejected, in six languages. No case regressed.

The direction score is the headline but not the whole measurement. Of the 35 the
old parser called correctly, four carried a silently wrong field: case 61 an
amount a thousand times too small, case 59 the balance instead of the
transaction, case 51 the wrong country's dollar, case 38 the wrong day. Those
are invisible in a direction score and visible in somebody's ledger.

### 3.1 The five hard failures (all now fixed)

| #   | case                    | result               | cause                                                                                                            |
| --- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | **SBI UPI**             | dropped              | `AMOUNT` requires a currency token; SBI writes `debited by 150.0`                                                |
| 2   | **ICICI account debit** | dropped              | message says `debited` _and_ `credited` (of the payee); `debit === credit` bails                                 |
| 3   | **Credit card spend**   | **booked as income** | `CREDIT_WORDS` matches the word _credit_ inside `Credit Card`; no debit verb matches `used for a transaction of` |
| 4   | **Refund**              | dropped              | `CREDIT_WORDS` has `refund`; the message says `refunded`                                                         |
| 5   | **`350.00 INR`**        | dropped              | `AMOUNT` only matches a marker _before_ the number                                                               |

**#3 was the one to fix first.** The others lose a transaction, which the person
can see and paste again. #3 silently records a ₹2,500 purchase as ₹2,500
_received_ — a wrong ledger entry that looks deliberate. Everything downstream
trusts `direction`. It was fixed first, and the rest with it.

### 3.1a The worse failure, which was not in the first 25

`EUR 1.234,56 debited from card 1234 at REWE` — corpus case 61 — was **accepted**
by the old parser, given `direction: debit`, scored **0.9**, pre-selected, and
recorded as **€1.23**. `AMOUNT` matched `1.23` out of `1.234,56` and stopped,
because it read the first dot as the decimal point and took two digits after it.

This is worse than every failure in §3.1 put together. A dropped message is
visible; the person pastes it again. A thousandfold error in a row that looks
correctly parsed is not visible at all, and it lands in a shared ledger where
somebody else is owed the difference.

Two smaller members of the same family: `KWD 12.345` silently truncated to
`12.340` once the currency was recognised at all (the fraction was capped at two
digits, and five currencies have three); and `$` resolving to USD everywhere,
so a Canadian message came back in the wrong currency at full confidence.

### 3.2 The quiet ones — parsed, but wrong (all now fixed)

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
`REF`, a bare number) should score _nothing_, not `+0.2`. That is what it does
now, and the score also pays for every field the parser had to guess.

### 3.4 Never guess silently — the rule the fix is built on

Three things in a bank message cannot be decided from the message: `08/05/2026`
is two days, `1.234` is two amounts a thousand apart, and `$` is seven
currencies. There is no clever reading that resolves them; there is only a
signal from outside, or a guess.

So `parseSms` takes an optional context — region, locale, default currency, and
the message's own sender — and for anything the context does not settle it uses
**one documented fallback and reports it**. `ParsedSms.inferred` lists the fields
that were decided rather than read (`currency`, `decimalSeparator`, `dateOrder`),
and each one costs confidence, which is what keeps a guessed row out of the
pre-selected set. The UI can then point at the field to check rather than
telling somebody the whole row is doubtful.

The fallbacks, written down so they are arguable:

| ambiguity                            | resolved by                                                  | with nothing at all                                        |
| ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `08/05/2026`                         | a component over 12; else the region's order                 | day-first, marked `dateOrder`                              |
| one separator, three digits after it | the currency's exponent — a 2-decimal currency cannot have 3 | grouping, **not** marked: this is a deduction, not a guess |
| the same, for a 3-decimal currency   | the locale's decimal separator                               | the currency's own precision, marked `decimalSeparator`    |
| `$`, `kr`, `Rs`, `ريال`              | the region                                                   | the family's most common member, marked `currency`         |
| no currency token at all             | the caller's default, then the region's currency             | INR — Waves' home market — marked `currency`               |

---

## 4. Recommendations, and what became of them

1. ~~**Stop reading `credit` inside `Credit Card`.**~~ Done. Card phrases are
   blanked — replaced by spaces of the same length, so every other index into
   the message still holds — before direction is decided, and the missing debit
   verbs are in the list.
2. ~~**Make the currency token optional.**~~ Done. A bare number introduced by a
   transaction verb is an amount; the currency comes from the caller's default,
   then the region, then INR, and the last case says it guessed.
3. ~~**Direction by proximity, not presence.**~~ Done. The verb nearest the
   amount decides; equidistant still refuses.
4. ~~**Add the `i` flag to `MERCHANT`, allow lowercase, stop-word the
   captures.**~~ Done, plus a plausibility test: an implausible capture is
   skipped and the parser keeps looking rather than returning it.
5. ~~**Read VPAs properly.**~~ Done — `swiggy@icici` yields `swiggy`.
   `normaliseMerchantName` was not used: it strips gateway noise for
   _categorisation_, and a merchant shown to a person should keep the spelling
   the bank sent.
6. ~~**Accept a trailing currency.**~~ Done.
7. **Use the sender** — done as a hint, not as a filter. The recommendation said
   "let a non-bank header skip the message entirely"; that was not followed. A
   bank the allowlist has not heard of is still a bank, an allowlist written in
   India would silently drop every European sender, and a person who pasted a
   message has already decided it is worth reading. A recognised header raises
   confidence and nothing lowers it.
8. ~~**Re-base confidence on plausibility.**~~ Done, per §3.3 and §3.4.

Still open:

- **The sender allowlist as a cheap first filter over a whole inbox** — the
  performance half of §1.2, distinct from the accuracy half. Nothing in the
  reader uses it yet.
- **Telling a bank name from a merchant name** (corpus case 14 reads `HDFC`
  where the shop is `AMAZON`). That needs a table the parser does not have.
- **`de`, `a` and `no` as merchant prepositions.** Left out deliberately: each
  is also an ordinary English fragment and would mint merchants out of the
  middle of English sentences. It costs a merchant on two Spanish and
  Portuguese shapes (corpus 34, 60).

## 5. What this research did not do

No real inbox was read — every message here is written to match documented
formats, not captured from a device. Bank wording changes without notice and
varies by product within one bank. The corpus is now 61 messages across roughly
fifteen languages, but it is still a corpus somebody wrote rather than one
somebody received, and the non-English cases are a bigger leap than the Indian
ones: those at least match formats that are publicly documented. RCS
displacement is reported from public sources, not measured. And nothing here has
been run on a device: these are results from the pure parser, which is the right
place to test it, but not the same as the feature working.

Two things the parser knows it cannot do. It does not read a language whose
verbs are not in its list, and that list is written by hand — the failure mode
is a silent miss, not an error. And it cannot tell a Hindi message from a Hindi
message _about_ a transaction any better than its Hindi vocabulary allows, which
is thinner than its English one.

## 6. The corpus

Reproducible — 61 bodies, the five families plus the negatives, with the
expected direction for each and the result from both the original and the
current parser. Stored alongside this document as `sms-parser-corpus.md` so a
fix can be measured against the same set rather than against a new one that
happens to pass.
