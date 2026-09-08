---
id: overview
title: API overview
description: What the Waves developer API is for, how money is represented, and how to point these docs at your own deployment.
sidebar_position: 1
---

:::warning This API is not finished

The Waves developer API is being built now. The reference in this section is
generated from a **provisional** OpenAPI document written to give the pages a
shape to hold — every path, field and status code in it is a plausible guess,
not a commitment. Do not build against it yet.

When the real specification ships, this section regenerates from it and this
notice goes away.

:::

## What it is for

The API exposes the same ledger the app works on: groups, the expenses in them,
the balances those produce, and the settlements that clear them. It is the seam
for the things an app cannot do for you — importing a decade of shared costs
from a spreadsheet, wiring a company card feed into a group, or building a
dashboard over your own history.

It is not a payments API. Waves does not move money, and neither does this.

## Base URL

```
{{apiBaseUrl}}
```

Every path in the reference is relative to that.

If you are running your own Waves — see
[MIGRATION.md]({{repoUrl}}/blob/main/MIGRATION.md) — that address is yours, not
ours, and so is this documentation. Everything printed here comes from
environment variables at build time; the
[configuration section of the docs README]({{repoUrl}}/blob/main/apps/docs/README.md)
lists them. Nothing has to be edited by hand.

## Money is never a float

Every amount is a pair: an integer of **minor units** and an ISO 4217 currency
code.

```json
{ "minor": 125000, "currency": "INR" }
```

That is ₹1,250.00. There are no decimal amounts anywhere in the API, and there
will not be: a rupee split three ways has to add back up to a rupee, and a
binary floating-point number cannot promise that. The app, the database and this
API all agree on integers for exactly that reason.

Two rules follow from it, and the server enforces both rather than trusting the
caller:

- **Shares sum to the total.** An expense whose shares do not add up to its
  amount is rejected, not rounded.
- **Balances sum to zero.** Across a group, every net position adds to nothing.

## Errors

Errors come back as JSON with a stable machine-readable `code` and a message
that is safe to show a person:

```json
{
  "error": {
    "code": "shares_do_not_sum",
    "message": "The shares add up to ₹1,240 but the expense is ₹1,250."
  }
}
```

Branch on `code`. The message is written for a human and its wording will
change — including with the reader's language.

A message never carries a database error, a stack frame, or another member's
details.

## Reading a group you are not in

Requests for a group you are not a member of answer `404`, the same as a group
that does not exist. That is on purpose: a distinguishable `403` would confirm
that a particular group id is real to somebody with no business knowing.

## Next

[Authentication →](./authentication.md)
