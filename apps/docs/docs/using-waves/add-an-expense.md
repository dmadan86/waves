---
id: add-an-expense
title: Add an expense
description: The add-expense screen field by field, plus adding one by voice, by scanning a bill, or saving it for later.
sidebar_position: 1
---

The **+** on Home starts a new expense. So does **Add expense** inside a group,
the mic in the middle of the bottom bar, and the camera on the scan card.

## The screen, field by field

**Amount** is first and it is the only thing the app insists on. Until there is
one, Save is disabled and says why: _Enter an amount to save._

| Field                | What it is                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Amount**           | The whole bill, not your share. The currency sits beside it.                                                                       |
| **What was it for?** | A short description — _Beach shack dinner_. Optional; an expense with none shows as **Untitled**.                                  |
| **Paid by**          | Who put the money in. Defaults to you.                                                                                             |
| **How to split**     | One control: Equally, Shares, Percent, Exact — plus a **Split by item** link. See [How splitting works](./how-splitting-works.md). |
| **Split between**    | Who is in it. Everyone by default; the counter reads _{chosen} of {total}_.                                                        |

**More details** unfolds the rest, and folds it away again as **Fewer details**:

- **What kind of expense** — the category. The built-in list is Food & drink,
  Groceries, Travel, Stay, Shopping, Fun, Home & bills, Health, Gifts, Other,
  and you can add your own under **Settings → Tags & categories**.
- **Paid with** — Cash, Credit card, Debit card, Forex, UPI.
- **Date**.
- **Location** — optional and off unless you add it. **Add location** uses the
  phone's position; **Pick on map** lets you drop the pin yourself.
- A currency rate, on a group that spends in more than one currency.

Under the amount there are two compact actions — **Scan receipt** and
**Add photo** — covered in [Receipts](./receipts.md).

The bottom bar previews the result before you commit to it: _You paid · split
equally with everyone_, and _3 people owe ₹200 each_.

## Several people paid

Bills get split at the till as well as afterwards. **Several people paid** turns
the payer row into a list where each person's contribution is typed in, and the
app keeps score:

- _{amount} left to assign_ — the payments do not add up to the bill yet.
- _{amount} too much_ — they add up to more than it.
- **Split evenly** resets every payer to an even share.

**One person paid** collapses it back, and asks first, because the other payers'
amounts go with it:

> {name} put in the most, so they will be recorded as paying the whole bill. The
> other payers and their amounts are removed.

## By voice

The raised mic in the bottom bar is **Speak an expense**. Say what you spent —
the app's own example is _"add 500 to Goa trip"_ — and it fills the form in for
you to check before saving. It can pick out the amount, the currency, the group
by name, and more than one expense in a single sentence.

Speech is turned into text on the phone. On a device whose built-in recogniser
does not work offline, **Set up offline voice** downloads a language model so it
works with no signal at all.

If it did not catch an amount it says so — _Didn't catch an amount_ — rather
than saving a guess.

## By scanning the bill

**Scan** on the scan card photographs a bill and reads the total and the name of
the place off it:

> The total and the name of the place come out filled in. Check them — entering
> them by hand is always free.

If it reads the individual lines it offers **split by item** instead, which puts
the bill in front of everyone as a list to tap: _"{n} lines, nobody has claimed
one yet. Tap what you had."_

Always check the total. The app asks you to: _Check the total against the bill
before saving._

## Not splitting it? Save it for later

Two different things live behind similar words.

**Just for me** on the add-expense screen routes the spend away from the group
altogether, into your own **Saved for later**:

> Not splitting this? Keep it in your own captures — off the group's ledger.

**Save an expense** — the **Saved for later** screen — catches a spend before you
have decided which group it belongs to:

> Catch a spend the moment it happens — the amount, a note, a photo of the bill —
> and choose which group it belongs to later.

Saved expenses wait on the Home screen as _"{n} expenses waiting to be added"_.
**Add to group** turns one into a real expense, and only then does it ask who is
splitting it and how.

If it is your own money and never anybody else's, it belongs in
[Personal](./personal-ledger.md) instead.

## Editing and deleting

Editing keeps the old version:

> Editing keeps the old version. Everyone can see what changed, and it can be
> restored.

The expense screen has two tabs — **Details** and **History**. History is the
audit trail: who created it, who edited it, and every field that changed, shown
as old → new. **Restore this expense** brings back a version.

Deleting is soft:

> It stops counting towards balances but stays in the activity feed, and anyone
> in the group can restore it for 30 days.

After thirty days it is gone, and looking for it gets you _Expense not found ·
It may have been deleted more than 30 days ago._

## Next

[How splitting works →](./how-splitting-works.md)
