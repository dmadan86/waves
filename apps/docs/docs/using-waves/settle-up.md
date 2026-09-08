---
id: settle-up
title: Settle up
description: Recording a payment, confirming one, rejecting one you did not receive, and cancelling one you recorded by mistake.
sidebar_position: 5
---

Waves never moves money. **Settle up** records a payment you made some other way
— cash, UPI, a bank transfer — and clears that much of the balance. The app says
so on the screen: _Recorded, not moved by Waves._

## Recording a payment

**Settle up** offers the person, the amount, and how you paid:

- **Pay via UPI** — or whichever rail your country uses. This opens your own
  payment app with their handle filled in. Waves hands the payment off; it never
  touches it.
- **Paid in cash**.
- **Bank / other**.

By default the payment applies to the whole balance between you. **Apply to
specific expenses** narrows it to particular bills instead; anything left over
_"applies to the overall balance, oldest expense first."_

Before recording it, the app asks the obvious question:

> **Did the payment go through?** Only record it if it actually completed.

## It takes two

A settlement is **pending** until the other person confirms it. One person
cannot declare themselves paid.

Which side you are on decides what you see:

- You paid: _"{name} gets asked to confirm. Nothing changes hands through
  Waves."_
- They paid: _"You will be asked to confirm once they mark it paid."_

Pending settlements gather at the top of the group as **Pending confirmations**,
with the count and a **Review** button. If several people have paid you at once,
**Confirm all** clears them together — _"Mark all {count} payments as
received?"_

If nobody responds, it resolves itself:

> Auto-confirms in 7 days if nobody responds.

The window is shown on the row while it is running: _{n} days to confirm_.

## If it did not arrive

**Not received** rejects a payment somebody recorded against you:

> {name} recorded paying you. This clears the pending payment and doesn't change
> any balance.

That is the important half. Rejecting removes the pending record; it does not
move money and it does not alter what anybody owes. The balance simply goes back
to what it was.

## If you recorded it by mistake

**Cancel payment** is the same thing from the payer's side:

> Removes the payment you recorded. {name} won't be asked to confirm it, and no
> balance changes.

Either side can withdraw a pending settlement, and neither action can silently
change a balance.

## Proof of payment

A settlement can carry an image — a screenshot of the transfer, a photo of the
cash. It is attached to that settlement and visible to the two people it is
between.

## Reminding somebody

**Remind** on a person's row sends them a nudge about what they owe. Once it has
gone, the row reads **Reminded**.

There is one nudge per person per day. Ask for a second and the app declines it
with **Nudged today** rather than sending it — a reminder that can be sent
fifteen times is not a reminder.

## Next

[Receipts →](./receipts.md)
