---
id: balances
title: Balances
description: What "you lent" and "you borrowed" mean, how the overall figure is built, and what Fewer repayments does.
sidebar_position: 4
---

A balance in Waves is worked out, never typed. It is what the expenses and
settlements add up to, recomputed every time either changes — which is why it
cannot drift out of step with the ledger.

## On one expense

Every expense row carries a label saying what that one bill did to **your**
balance:

| Label            | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| **you lent**     | You put in more than your own share, so the group owes you the rest. |
| **you borrowed** | Somebody else put in money and you have a share of it.               |
| **not involved** | You neither paid for it nor have a share of it.                      |

The subtitle underneath keeps the whole bill in view — _Asha paid ₹1,200_ — so
the total is not lost when the amount column is showing your slice instead.

## In a group

The group's **Balances** tab lists every member's net position, and
**Who owes what** breaks one expense down person by person. When everybody is
square:

> Nobody owes anybody in this group.

### Fewer repayments

**Fewer repayments** (in the group's **•••** menu) changes what the balances
screen suggests, and nothing else:

> Suggest the fewest payments that settle the group. The real who-owes-whom
> ledger is never rewritten.

With it on, a three-way tangle can collapse to a single payment — _{from} pays
{to}_ — instead of three. With it off you see _"the actual pairwise ledger,
exactly as the expenses created it."_

Either way the underlying record is the same. This is a view, not an edit.

## Across everything

**Home** shows one figure for where you stand overall — **Net receivable** or
**Net payable** — with **{n} groups** underneath it. **Hide balance** covers it
up for reading the app in public.

**Friends** is the same money arranged by person rather than by group. The
balance at the top reads the way Home's does — **Net receivable · INR** for what
you are owed, **Net payable · INR** for what you owe — and when you are both
owed and owing, swipe it sideways to see the other one. Other currencies sit
underneath the figure in small type.

Under the balance, **Add people** is how you add somebody: **From contacts**,
**Find someone**, or **Scan to join**. When Waves spots the
same guest in more than one of your groups, a merge button appears beside it
with the number of possible duplicates on it; see
[Merging duplicates](./people-and-placeholders.md#merging-duplicates).

Each person in the list says **Owes you** or **You owe**, and across how many
groups. When there is nothing to show:

> **All square.** Nobody owes you and you owe nobody. New balances show up here.

Tapping a person opens every group you share with them.

### Currencies are never mixed

Amounts are kept per currency and never converted into a single total:

> Amounts are kept per currency, never converted into one total.

So a trip that spent in both euros and rupees shows two figures, not one made-up
one. A group can set a rate for a foreign currency, which affects how an
individual expense converts — not how balances are totalled.

## The activity feed

**Activity** is the third tab, and it is the group's history rather than yours:

> Every expense, edit, deletion and settlement lands here — for everyone in the
> group.

Entries are grouped by day. A deleted expense leaves the **Expenses** list, but
its deletion stays here — tap it to open the expense and restore it.

Nothing in the feed is ever rewritten:

> Nothing here is ever overwritten. Every version above is kept, and a deleted
> expense can be brought back for 30 days.

## Next

[Settle up →](./settle-up.md)
