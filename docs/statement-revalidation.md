# Statement import: monthly revalidation

The statement importer (`packages/core/src/statement/`) reads CSV, spreadsheet,
OFX and PDF-text exports from the banks' own layouts. Banks change those layouts
without notice, so the importer is revalidated every month.

## What is checked automatically

`scripts/statement-revalidate.mjs`, run by `.github/workflows/statement-revalidate.yml`
at 04:00 UTC on the first of every month (and on demand from the Actions tab):

1. Reads the sources table in `packages/core/test/fixtures/statement/real/NOTICE.md`
   and re-downloads every vendored sample from its repository's **default branch**
   (not the pinned commit).
2. Diffs each against our copy and reports drift: header row, column count and
   order, date format, line count. Drift is reported, never fatal.
3. Runs the core statement tests (`npx vitest run test/statement` in
   `packages/core`): the real-format fixtures, the specimen-shaped ones, and the
   focused layout cases. A failure makes the run red.
4. Opens one GitHub issue, `Monthly statement import revalidation — YYYY-MM`,
   labelled `statement-import`, with the report and the manual checklist below.
   If that month's issue is already open, it comments on it instead.

Run it locally with `node scripts/statement-revalidate.mjs` (add `--no-tests`
for the drift report alone).

## What a person checks each month

The vendored samples are other projects' synthetic copies of each bank's
format; only a fresh export proves the bank has not moved. On the issue:

- Export a fresh statement from HDFC, SBI, ICICI, Axis and Kotak (and one
  US/UK/UAE/AU bank if an account is available).
- Import each into Waves on a test account.
- Confirm the row count, the debit and credit totals and the signs against the
  bank's own figures.
- If a bank changed its format, add a fixture in its new shape under
  `packages/core/test/fixtures/statement/` (hand-written, no real data) with
  expectations in `packages/core/test/statement/realFixtures.test.ts`, then fix
  the profile or parser so the old and new shapes both pass.

## Where things live

| What                                                         | Where                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Parsers                                                      | `packages/core/src/statement/{profiles,intl,pdfText,ofx}.ts`                     |
| Vendored real-format samples and their licences              | `packages/core/test/fixtures/statement/real/`, `NOTICE.md`                       |
| Hand-written layouts of specimens that could not be vendored | `packages/core/test/fixtures/statement/specimen-shaped/`                         |
| End-to-end expectations per fixture                          | `packages/core/test/statement/realFixtures.test.ts`                              |
| One focused test per known layout quirk                      | `packages/core/test/statement/layoutGaps.test.ts`                                |
| Revalidation script and workflow                             | `scripts/statement-revalidate.mjs`, `.github/workflows/statement-revalidate.yml` |

Never vendor a bank-published PDF or a file that could hold a real person's
details; write the layout by hand with placeholder data instead.
