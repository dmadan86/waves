---
id: receipts
title: Receipts
description: Scanning a bill, attaching a photo, who can see it, where it is stored, and the free limits.
sidebar_position: 6
---

A receipt in Waves is a photo attached to an expense. It can be scanned to fill
the form in, or simply kept as evidence of what the bill said.

## Scanning one

**Scan receipt** on the add-expense screen photographs a bill and reads it:

> The total and the name of the place come out filled in. Check them — entering
> them by hand is always free.

If it reads the individual lines it offers to split by them instead — _"It read
{n} items — split by item instead"_ — which is covered in
[How splitting works](./how-splitting-works.md#split-by-item).

Reading happens on the phone. If it cannot make sense of the image it says so
rather than guessing: _"Couldn't read this bill — enter the amount yourself."_

Always check the total against the paper. The app asks you to.

## Attaching one without scanning

**Add photo** and **Attach** put an image on an expense without reading it.
Once attached, the expense shows _Bill kept — tap to view_.

The **Receipts** viewer pages through everything on an expense — _{index} of
{total}_ — with **Markup** for drawing on one, **Adjust** for rotating and
cropping, and **Save to device** to keep a copy in your own photos.

## Who can see it

Each image is set individually:

> Each receipt can be visible to everybody in the group, or only to the people
> on that expense — you choose per image.

A restricted one is tagged **Private** in the list.

## Where it lives

A receipt is written to your phone first and uploaded afterwards, so it survives
a bad connection. While it is in flight the row says **Waiting to send** or
**Sending…**, and if it fails:

> This receipt is saved on your phone and hasn't been sent yet. It will keep
> trying on its own, or you can try again now.

Some receipts are deliberately kept off Waves' servers altogether — on the
device that took them, or backed up to your own cloud storage. Opening one of
those on a different phone gets an honest answer rather than a broken image:

> **Receipt not on this device.** This bill is saved on the device it was added
> from. Open the app there to see it.

or, if it went to your own Drive:

> This bill is backed up to your {provider}, not on this device.

### Sharing one from your own Drive

**Share receipt with group** is an explicit, per-image opt-in:

> Let everyone in the group open the bill from your own Drive. The image never
> touches Waves. Off by default.

It needs the receipt backed up to Drive first.

## Limits on the free plan

Two ceilings apply, and both are stated on screen when you meet them.

**Per group, free receipts:**

> **Receipt limit reached.** This group has used its free receipts. Upgrade or
> add your own storage to keep scanning.

**Per account, cloud storage:**

> Free accounts can store up to {cap} of photos and receipts. Upgrade for
> unlimited.

**Storage usage** in Settings shows where you stand — _{used} of {cap}_ — and
what your plan includes.

Both limits are lifted by **Plus**, and Plus is not on sale: it is granted by a
redeem code, and the upgrade screen says so —
[What costs money](../getting-started/what-waves-is.md#what-costs-money).
Storing your own images in your own cloud lifts them too, and costs nothing.

## Removing one

**Remove** takes an image off an expense, and records that it happened:

> Remove this receipt? The change is recorded.

The removal shows up in the expense's **History** like any other edit. Receipt
changes are audited because a bill is evidence, and evidence that can vanish
without trace is not evidence.

## Next

[Personal →](./personal-ledger.md)
