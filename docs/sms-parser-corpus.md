# The SMS corpus these results were measured against

25 bodies written to match documented institution formats — **not captured from
any real device or inbox**. Kept so that a parser change can be measured against
the same set rather than against a new one that happens to pass. See
[sms-parser-coverage.md](sms-parser-coverage.md) for the results.

`null` means the parser must reject it. Those six matter most: a wrong rejection
loses a transaction the person can paste again, but a wrong acceptance writes a
ledger entry nobody made.

Result column records behaviour as measured on `packages/core/src/sms/parse.ts`
at commit `01b5f678`, September 2026.

| #   | case                                    | expected | result               | body                                                                                                                        |
| --- | --------------------------------------- | -------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | SBI UPI (no currency token)             | debit    | **dropped**          | `Dear UPI user A/C X1234 debited by 150.0 on date 12Sep26 trf to SWIGGY Refno 526012345678. If not u? call 1800111109 -SBI` |
| 2   | HDFC UPI sent                           | debit    | ok, no merchant      | `Sent Rs.245.00 From HDFC Bank A/C x1234 To SWIGGY On 12/09/26 Ref 526012345678 Not You? Call 18002586161`                  |
| 3   | ICICI acct debit                        | debit    | **dropped**          | `ICICI Bank Acct XX123 debited for Rs 500.00 on 12-Sep-26; SWIGGY credited. UPI:526012345678. Call 18002662 for dispute.`   |
| 4   | Axis classic                            | debit    | ok                   | `INR 1,234.00 debited from A/c no. XX3456 on 12-09-26 at AMAZON. Avl Bal INR 5,678.90`                                      |
| 5   | Credit card "used for a transaction of" | debit    | **booked as credit** | `Your ICICI Bank Credit Card XX1234 has been used for a transaction of INR 2,500.00 on 12-Sep-26 at AMAZON.`                |
| 6   | Debit card spent, ISO-ish date          | debit    | ok, no date          | `Alert: You've spent Rs.1500.00 via Debit Card xx1234 at AMAZON on 2026-09-12:14:23:05.`                                    |
| 7   | Kotak lakh grouping                     | debit    | ok                   | `Rs 1,23,456.78 debited from Kotak A/c XX7890 on 12-09-26 towards RENT PAYMENT. Ref 998877665544`                           |
| 8   | ATM withdrawal                          | debit    | ok                   | `Rs.2000 withdrawn from A/c XX1234 at ATM SECTOR 5 on 12-09-26. Avl Bal Rs 12,340.00`                                       |
| 9   | Paytm wallet                            | debit    | ok                   | `Paid Rs.120 to SWIGGY using Paytm UPI. Txn ID 526012345678`                                                                |
| 10  | Amazon Pay                              | debit    | ok, no merchant      | `INR 349 debited from your Amazon Pay balance for order 404-1234567. Ref 7788990011`                                        |
| 11  | Foreign card spend                      | debit    | ok                   | `USD 42.50 spent on your card ending 1234 at STARBUCKS on 12-Sep-26`                                                        |
| 12  | AED spend                               | debit    | ok                   | `AED 89.00 debited from Card xx4471 at CARREFOUR DUBAI on 12-09-26`                                                         |
| 13  | Salary credit                           | credit   | ok, merchant `A`     | `INR 85,000.00 credited to A/c XX1234 on 01-09-26 by NEFT. Avl Bal INR 92,340.00`                                           |
| 14  | Refund                                  | credit   | **dropped**          | `Rs.599.00 refunded to your HDFC Card xx1234 by AMAZON on 12-09-26. Ref 5544332211`                                         |
| 15  | OTP with amount                         | null     | ok                   | `OTP 445566 for txn of Rs.2,500.00 at AMAZON on HDFC Card xx1234. Do not share.`                                            |
| 16  | Scheduled autopay                       | null     | ok                   | `Rs 499.00 will be debited from A/c XX1234 on 15-09-26 towards NETFLIX e-mandate.`                                          |
| 17  | Balance only                            | null     | ok                   | `Avl Bal in A/c XX1234 is Rs 12,340.00 as on 12-09-26.`                                                                     |
| 18  | Payment due reminder                    | null     | ok                   | `Your ICICI Credit Card XX1234 payment of Rs 8,450.00 is due on 18-09-26.`                                                  |
| 19  | Failed txn                              | null     | ok                   | `Your transaction of Rs.1,200.00 at AMAZON was declined due to insufficient balance.`                                       |
| 20  | Marketing                               | null     | ok                   | `Get a personal loan of up to Rs 5,00,000 at 10.5% p.a. Apply now!`                                                         |
| 21  | UPI VPA merchant                        | debit    | ok, merchant `VPA`   | `Rs.75.00 debited from A/c XX1234 to VPA swiggy@icici on 12-09-26. UPI Ref 526012345678`                                    |
| 22  | Lowercase bank voice                    | debit    | ok, no merchant      | `rs.250 debited from a/c xx1234 at bigbasket on 12-09-26`                                                                   |
| 23  | No space after Rs                       | debit    | ok                   | `Rs1,499.00 spent on HDFC Card xx1234 at MYNTRA on 12-09-26`                                                                |
| 24  | Amount trailing INR                     | debit    | **dropped**          | `Your A/c XX1234 is debited with 350.00 INR on 12-09-26 at UBER.`                                                           |
| 25  | Two amounts, txn then balance           | debit    | ok                   | `Rs.450.00 debited from A/c XX1234 at DOMINOS on 12-09-26. Avl Bal: Rs.9,999.00`                                            |

**Score: 20/25 on direction, of which 6 more carry a wrong or missing
merchant.** All six negatives (15–20) were correctly rejected.

Case 25 is worth keeping for the reason it passes: the message quotes two
amounts, and the parser takes the first. That is right here, because the
transaction is quoted before the balance — but it is positional luck, not a
rule, and a bank that leads with the balance would break it.
