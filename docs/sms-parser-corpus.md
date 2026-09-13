# The SMS corpus these results were measured against

61 bodies written to match documented institution formats — **not captured from
any real device or inbox**. Kept so that a parser change can be measured against
the same set rather than against a new one that happens to pass. See
[sms-parser-coverage.md](sms-parser-coverage.md) for the results.

`null` in the **expected** column means the parser must reject it. Those twelve
matter most: a wrong rejection loses a transaction the person can paste again,
but a wrong acceptance writes a ledger entry nobody made.

**1–25** are the original India-first set, measured on
`packages/core/src/sms/parse.ts` at commit `01b5f678`, September 2026. Their
numbering has not changed. **26–61** were added when the parser was
internationalised, and cover the hazards that only appear outside one country:
the decimal comma, three- and zero-decimal currencies, month-first dates,
non-Latin numerals, right-to-left text, and shared currency symbols.

The **before** column is that same `01b5f678` parser run against every case,
including the new ones — so the two columns are the same 61 messages through two
parsers, not two different sets. **after** is the internationalised parser. Both
were run by the same harness; the numbers in the coverage document come from it.

The **context** column is what a caller told the parser about the reader — a
region, a locale, or a default currency. It is always optional: the cases marked
`—` were given nothing at all, and the `*(…)*` note in the **after** column
lists what the parser therefore had to infer for itself.

## Direction, before and after

| before | after | count |
| ------ | ----- | ----- |
| right  | right | 35    |
| wrong  | right | 26    |
| right  | wrong | 0     |

**35/61 → 61/61.** On the original 25 alone: **20/25 → 25/25**.

Direction is not the whole story, and the table below is there because it is
not: four of the 35 the old parser called correctly carried a silently wrong
**field** — case 61 an amount a thousand times too small, case 59 the balance
instead of the transaction, case 51 the wrong country's dollar, case 38 the
wrong day. None of those shows up in a direction score, and all four would have
reached somebody's ledger looking deliberate.

## The corpus

| #   | case                                         | context     | expected | before                                         | after                                                                 | body                                                                                                                        |
| --- | -------------------------------------------- | ----------- | -------- | ---------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | SBI UPI (no currency token)                  | —           | debit    | dropped                                        | debit, INR 150.00, SWIGGY, 2026-09-12 _(currency)_                    | `Dear UPI user A/C X1234 debited by 150.0 on date 12Sep26 trf to SWIGGY Refno 526012345678. If not u? call 1800111109 -SBI` |
| 2   | HDFC UPI sent                                | —           | debit    | debit, INR 245.00, no merchant, 2026-09-12     | debit, INR 245.00, SWIGGY, 2026-09-12 _(currency+dateOrder)_          | `Sent Rs.245.00 From HDFC Bank A/C x1234 To SWIGGY On 12/09/26 Ref 526012345678 Not You? Call 18002586161`                  |
| 3   | ICICI acct debit                             | —           | debit    | dropped                                        | debit, INR 500.00, SWIGGY, 2026-09-12 _(currency)_                    | `ICICI Bank Acct XX123 debited for Rs 500.00 on 12-Sep-26; SWIGGY credited. UPI:526012345678. Call 18002662 for dispute.`   |
| 4   | Axis classic                                 | —           | debit    | debit, INR 1234.00, AMAZON, 2026-09-12         | debit, INR 1234.00, AMAZON, 2026-09-12 _(dateOrder)_                  | `INR 1,234.00 debited from A/c no. XX3456 on 12-09-26 at AMAZON. Avl Bal INR 5,678.90`                                      |
| 5   | Credit card "used for a transaction of"      | —           | debit    | **credit**, INR 2500.00, AMAZON, 2026-09-12    | debit, INR 2500.00, AMAZON, 2026-09-12                                | `Your ICICI Bank Credit Card XX1234 has been used for a transaction of INR 2,500.00 on 12-Sep-26 at AMAZON.`                |
| 6   | Debit card spent, ISO-ish date               | —           | debit    | debit, INR 1500.00, AMAZON, no date            | debit, INR 1500.00, AMAZON, 2026-09-12 _(currency)_                   | `Alert: You've spent Rs.1500.00 via Debit Card xx1234 at AMAZON on 2026-09-12:14:23:05.`                                    |
| 7   | Kotak lakh grouping                          | —           | debit    | debit, INR 123456.78, RENT PAYMENT, 2026-09-12 | debit, INR 123456.78, RENT PAYMENT, 2026-09-12 _(currency+dateOrder)_ | `Rs 1,23,456.78 debited from Kotak A/c XX7890 on 12-09-26 towards RENT PAYMENT. Ref 998877665544`                           |
| 8   | ATM withdrawal                               | —           | debit    | debit, INR 2000.00, ATM SECTOR 5, 2026-09-12   | debit, INR 2000.00, ATM SECTOR 5, 2026-09-12 _(currency+dateOrder)_   | `Rs.2000 withdrawn from A/c XX1234 at ATM SECTOR 5 on 12-09-26. Avl Bal Rs 12,340.00`                                       |
| 9   | Paytm wallet                                 | —           | debit    | debit, INR 120.00, SWIGGY, no date             | debit, INR 120.00, SWIGGY, no date _(currency)_                       | `Paid Rs.120 to SWIGGY using Paytm UPI. Txn ID 526012345678`                                                                |
| 10  | Amazon Pay                                   | —           | debit    | debit, INR 349.00, no merchant, no date        | debit, INR 349.00, no merchant, no date                               | `INR 349 debited from your Amazon Pay balance for order 404-1234567. Ref 7788990011`                                        |
| 11  | Foreign card spend                           | —           | debit    | debit, USD 42.50, STARBUCKS, 2026-09-12        | debit, USD 42.50, STARBUCKS, 2026-09-12                               | `USD 42.50 spent on your card ending 1234 at STARBUCKS on 12-Sep-26`                                                        |
| 12  | AED spend                                    | —           | debit    | debit, AED 89.00, CARREFOUR DUBAI, 2026-09-12  | debit, AED 89.00, CARREFOUR DUBAI, 2026-09-12 _(dateOrder)_           | `AED 89.00 debited from Card xx4471 at CARREFOUR DUBAI on 12-09-26`                                                         |
| 13  | Salary credit                                | —           | credit   | credit, INR 85000.00, **A**, 2026-09-01        | credit, INR 85000.00, no merchant, 2026-09-01 _(dateOrder)_           | `INR 85,000.00 credited to A/c XX1234 on 01-09-26 by NEFT. Avl Bal INR 92,340.00`                                           |
| 14  | Refund                                       | —           | credit   | dropped                                        | credit, INR 599.00, HDFC, 2026-09-12 _(currency+dateOrder)_           | `Rs.599.00 refunded to your HDFC Card xx1234 by AMAZON on 12-09-26. Ref 5544332211`                                         |
| 15  | OTP with amount                              | —           | null     | dropped                                        | dropped                                                               | `OTP 445566 for txn of Rs.2,500.00 at AMAZON on HDFC Card xx1234. Do not share.`                                            |
| 16  | Scheduled autopay                            | —           | null     | dropped                                        | dropped                                                               | `Rs 499.00 will be debited from A/c XX1234 on 15-09-26 towards NETFLIX e-mandate.`                                          |
| 17  | Balance only                                 | —           | null     | dropped                                        | dropped                                                               | `Avl Bal in A/c XX1234 is Rs 12,340.00 as on 12-09-26.`                                                                     |
| 18  | Payment due reminder                         | —           | null     | dropped                                        | dropped                                                               | `Your ICICI Credit Card XX1234 payment of Rs 8,450.00 is due on 18-09-26.`                                                  |
| 19  | Failed txn                                   | —           | null     | dropped                                        | dropped                                                               | `Your transaction of Rs.1,200.00 at AMAZON was declined due to insufficient balance.`                                       |
| 20  | Marketing                                    | —           | null     | dropped                                        | dropped                                                               | `Get a personal loan of up to Rs 5,00,000 at 10.5% p.a. Apply now!`                                                         |
| 21  | UPI VPA merchant                             | —           | debit    | debit, INR 75.00, **VPA**, 2026-09-12          | debit, INR 75.00, swiggy, 2026-09-12 _(currency+dateOrder)_           | `Rs.75.00 debited from A/c XX1234 to VPA swiggy@icici on 12-09-26. UPI Ref 526012345678`                                    |
| 22  | Lowercase bank voice                         | —           | debit    | debit, INR 250.00, no merchant, 2026-09-12     | debit, INR 250.00, bigbasket, 2026-09-12 _(currency+dateOrder)_       | `rs.250 debited from a/c xx1234 at bigbasket on 12-09-26`                                                                   |
| 23  | No space after Rs                            | —           | debit    | debit, INR 1499.00, MYNTRA, 2026-09-12         | debit, INR 1499.00, MYNTRA, 2026-09-12 _(currency+dateOrder)_         | `Rs1,499.00 spent on HDFC Card xx1234 at MYNTRA on 12-09-26`                                                                |
| 24  | Amount trailing INR                          | —           | debit    | dropped                                        | debit, INR 350.00, UBER, 2026-09-12 _(dateOrder)_                     | `Your A/c XX1234 is debited with 350.00 INR on 12-09-26 at UBER.`                                                           |
| 25  | Two amounts, txn then balance                | —           | debit    | debit, INR 450.00, DOMINOS, 2026-09-12         | debit, INR 450.00, DOMINOS, 2026-09-12 _(currency+dateOrder)_         | `Rs.450.00 debited from A/c XX1234 at DOMINOS on 12-09-26. Avl Bal: Rs.9,999.00`                                            |
| 26  | German decimal comma                         | DE          | debit    | dropped                                        | debit, EUR 1234.56, REWE, 2026-09-12                                  | `Ihr Konto DE12 wurde mit EUR 1.234,56 belastet am 12.09.2026 bei REWE.`                                                    |
| 27  | German decimal comma, no context             | —           | debit    | dropped                                        | debit, EUR 1234.56, REWE, 2026-09-12 _(dateOrder)_                    | `Ihr Konto wurde mit EUR 1.234,56 belastet am 12.09.2026 bei REWE.`                                                         |
| 28  | German dot grouping, no decimal part         | DE          | debit    | dropped                                        | debit, EUR 1234.00, REWE, 2026-09-12                                  | `EUR 1.234 belastet Konto 3456 bei REWE am 12.09.2026`                                                                      |
| 29  | French space grouping                        | FR          | debit    | dropped                                        | debit, EUR 1234.56, CARREFOUR, 2026-09-12                             | `Votre compte 1234 a ete debite de 1 234,56 EUR le 12/09/2026 chez CARREFOUR`                                               |
| 30  | Swiss apostrophe grouping                    | CH          | debit    | dropped                                        | debit, CHF 1234.50, MIGROS, 2026-09-12                                | `CHF 1'234.50 belastet Konto 4471 bei MIGROS am 12.09.2026`                                                                 |
| 31  | Spanish card purchase                        | ES          | debit    | dropped                                        | debit, EUR 45.90, MERCADONA, 2026-09-12                               | `Compra de EUR 45,90 en MERCADONA con tarjeta 1234 el 12/09/2026`                                                           |
| 32  | Portuguese (Brazil)                          | BR          | debit    | dropped                                        | debit, BRL 1234.56, MERCADO LIVRE, 2026-09-12                         | `Compra aprovada: R$ 1.234,56 em MERCADO LIVRE no cartao final 1234 em 12/09/2026`                                          |
| 33  | Indonesian                                   | ID          | debit    | dropped                                        | debit, IDR 150000.00, TOKOPEDIA, 2026-09-12                           | `Rp 150.000 didebet dari rekening 1234 di TOKOPEDIA pada 12/09/2026`                                                        |
| 34  | Turkish                                      | TR          | debit    | dropped                                        | debit, TRY 250.75, no merchant, 2026-09-12                            | `Hesabinizdan 250,75 TL harcama yapildi. Kart 1234, 12.09.2026 MIGROS`                                                      |
| 35  | Kuwaiti dinar, three decimals                | KW          | debit    | dropped                                        | debit, KWD 12.345, LULU, 2026-09-12                                   | `KWD 12.345 debited from Account XX1234 at LULU on 12-09-2026`                                                              |
| 36  | Kuwaiti dinar, no context                    | —           | debit    | dropped                                        | debit, KWD 12.345, LULU, 2026-09-12 _(decimalSeparator+dateOrder)_    | `KWD 12.345 debited from Account XX1234 at LULU on 12-09-2026`                                                              |
| 37  | Japanese yen, zero decimals                  | JP          | debit    | dropped                                        | debit, JPY 1234, LAWSON, 2026-09-12                                   | `JPY 1,234 spent on card 1234 at LAWSON on 2026-09-12`                                                                      |
| 38  | US month-first date                          | US          | debit    | debit, USD 42.50, TARGET, **2026-05-08**       | debit, USD 42.50, TARGET, 2026-08-05                                  | `USD 42.50 spent on card ending 1234 at TARGET on 08/05/2026`                                                               |
| 39  | Indian day-first, same digits                | IN          | debit    | debit, USD 42.50, TARGET, 2026-05-08           | debit, USD 42.50, TARGET, 2026-05-08                                  | `USD 42.50 spent on card ending 1234 at TARGET on 08/05/2026`                                                               |
| 40  | Ambiguous date, no context                   | —           | debit    | debit, USD 42.50, TARGET, 2026-05-08           | debit, USD 42.50, TARGET, 2026-05-08 _(dateOrder)_                    | `USD 42.50 spent on card ending 1234 at TARGET on 08/05/2026`                                                               |
| 41  | ISO date                                     | IE          | debit    | debit, EUR 20.00, IKEA, no date                | debit, EUR 20.00, IKEA, 2026-09-12                                    | `EUR 20.00 debited from account 1234 at IKEA on 2026-09-12`                                                                 |
| 42  | Named month, month first                     | US          | debit    | debit, USD 42.50, STARBUCKS, no date           | debit, USD 42.50, STARBUCKS, 2026-09-12                               | `USD 42.50 spent at STARBUCKS on Sep 12, 2026 with card 1234`                                                               |
| 43  | Arabic debit, Arabic-Indic digits            | AE          | debit    | dropped                                        | debit, AED 250.50, كارفور, 2026-09-12                                 | `تم خصم ٢٥٠٫٥٠ د.إ من البطاقة ٤٤٧١ لدى كارفور بتاريخ 12-09-2026`                                                            |
| 44  | Arabic with a bidi isolate around the amount | AE          | debit    | dropped                                        | debit, AED 250.50, كارفور, no date                                    | `تم خصم ⁦AED 250.50⁩ من الحساب 4471 لدى كارفور`                                                                             |
| 45  | Hindi Devanagari digits                      | IN          | debit    | dropped                                        | debit, INR 500.00, SWIGGY, 2026-09-12                                 | `आपके खाते XX1234 से ५००.०० रुपये डेबिट किए गए 12-09-2026 को SWIGGY`                                                        |
| 46  | Thai                                         | TH          | debit    | dropped                                        | debit, THB 1250.00, 7-ELEVEN, 2026-09-12                              | `บัญชี 1234 ถูกหัก THB 1,250.00 ที่ 7-ELEVEN 12/09/2026`                                                                    |
| 47  | Vietnamese                                   | VN          | debit    | dropped                                        | debit, VND 1250000, HIGHLANDS, 2026-09-12                             | `Tai khoan 1234 ghi no 1.250.000 VND tai HIGHLANDS ngay 12/09/2026`                                                         |
| 48  | Malay                                        | MY          | debit    | dropped                                        | debit, MYR 125.50, MYDIN, 2026-09-12                                  | `Akaun 1234 didebit RM 125.50 di MYDIN pada 12/09/2026`                                                                     |
| 49  | Swedish krona                                | SE          | debit    | dropped                                        | debit, SEK 1234.50, ICA, 2026-09-12                                   | `Kortkop 1 234,50 kr hos ICA 12/09/2026 kort 1234`                                                                          |
| 50  | Dollar with no region                        | —           | debit    | debit, USD 42.50, STARBUCKS, 2026-09-12        | debit, USD 42.50, STARBUCKS, 2026-09-12 _(currency+dateOrder)_        | `$42.50 spent on card ending 1234 at STARBUCKS on 12-09-2026`                                                               |
| 51  | Canadian dollar by region                    | CA          | debit    | debit, **USD** 42.50, TIM HORTONS, 2026-09-12  | debit, CAD 42.50, TIM HORTONS, 2026-09-12                             | `$42.50 spent on card ending 1234 at TIM HORTONS on 12-09-2026`                                                             |
| 52  | Bare number, no currency anywhere            | default GBP | debit    | dropped                                        | debit, GBP 150.00, CAFE, 2026-09-12 _(dateOrder)_                     | `Account XX1234 debited by 150.0 at CAFE on 12-09-2026`                                                                     |
| 53  | Spanish OTP                                  | ES          | null     | dropped                                        | dropped                                                               | `Su codigo de verificacion es 445566 para una compra de EUR 250,00 en ZARA.`                                                |
| 54  | German scheduled debit                       | DE          | null     | dropped                                        | dropped                                                               | `Ihr Konto wird mit EUR 49,90 belastet am 15.09.2026 fuer NETFLIX.`                                                         |
| 55  | French declined                              | FR          | null     | dropped                                        | dropped                                                               | `Votre transaction de 45,00 EUR chez FNAC a ete refusee.`                                                                   |
| 56  | Indonesian balance only                      | ID          | null     | dropped                                        | dropped                                                               | `Saldo rekening 1234 adalah Rp 1.250.000 pada 12/09/2026.`                                                                  |
| 57  | Turkish due reminder                         | TR          | null     | dropped                                        | dropped                                                               | `Kredi karti 1234 son odeme tarihi 18.09.2026, tutar 1.250,00 TL.`                                                          |
| 58  | Arabic OTP                                   | AE          | null     | dropped                                        | dropped                                                               | `رمز التحقق 445566 لعملية شراء بقيمة 250.00 د.إ لدى كارفور`                                                                 |
| 59  | Balance quoted before the transaction        | IN          | debit    | debit, INR **9999.00**, DOMINOS, 2026-09-12    | debit, INR 450.00, DOMINOS, 2026-09-12                                | `Avl Bal Rs 9,999.00. Rs.450.00 debited from A/c XX1234 at DOMINOS on 12-09-26`                                             |
| 60  | Refund in Spanish                            | ES          | credit   | dropped                                        | credit, EUR 59.90, no merchant, 2026-09-12                            | `Reembolso de EUR 59,90 acreditado a su tarjeta 1234 de ZARA el 12/09/2026`                                                 |
| 61  | Decimal comma in an English sentence         | DE          | debit    | debit, EUR **1.23**, REWE, 2026-09-12          | debit, EUR 1234.56, REWE, 2026-09-12                                  | `EUR 1.234,56 debited from card 1234 at REWE on 12-09-2026`                                                                 |

Bold marks a field that is **wrong**, as against merely missing.

## Notes on particular cases

**Case 61 is the reason this work happened.** The old parser accepted it,
scored it 0.9 — comfortably pre-selected — and read €1,234.56 as **€1.23**. The
amount regex matched `1.23` out of `1.234,56` and stopped, because it took the
first dot as the decimal point and two digits as the fraction. Nothing about the
result looks wrong. A person confirming a list of drafts would have to notice
that one row is a thousandth of what they spent.

**Case 59 replaces the luck in case 25.** Case 25 passed on the old parser
because Indian banks quote the transaction before the balance and it took the
first number. Case 59 is the same message with the two swapped, and it is the
case that fails that way. The parser now skips a number that sits behind a
balance word rather than relying on the order.

**Cases 35 and 36 are the same message with and without a region.** KWD has
three minor digits, so `12.345` is twelve dinars and 345 fils — and also,
equally plausibly, twelve thousand three hundred and forty-five. With a region
the locale settles it; without one the parser picks the currency's own precision
and reports `decimalSeparator` as inferred, which drops the confidence below
pre-selection.

**Cases 38, 39 and 40 are one message read three ways.** `08/05/2026` is the 5th
of August in Chicago and the 8th of May in Mumbai, and the message says nothing
either way. Case 40 has no context: the parser answers day-first — the order
most of the world writes — and says it guessed.

**Case 44 contains invisible characters.** `U+2066` and `U+2069` wrap the amount
so the digits render left-to-right inside a right-to-left sentence. They will
not show in a diff or a terminal. The old parser failed on this message not
because it does not read Arabic but because it does not read Unicode.

**Case 14 still gets the merchant wrong**, reading `HDFC` where `AMAZON` is the
shop. It is a credit, so it is never proposed as an expense, and telling a bank
name from a merchant name needs a table this parser does not have.

**Cases 10, 34 and 60 return no merchant.** In 10 the message genuinely names
only an order number. In 34 the shop is at the very end after a comma with no
preposition, and in 60 it follows a bare Spanish `de` — a word left out of the
preposition list on purpose, because it is also an ordinary fragment of English
and would mint merchants out of the middle of English sentences.

## Reproducing this

Every row comes from `parseSms(body, context)` in
`packages/core/src/sms/parse.ts`. The behaviours are asserted directly in
`packages/core/test/sms.test.ts`, which is the version that is kept honest by
CI; this table is the wider sweep those tests were selected from.
