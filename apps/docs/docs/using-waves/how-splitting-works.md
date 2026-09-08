---
id: how-splitting-works
title: How splitting works
description: Equally, Shares, Percent and Exact — what each one does, and who gets the odd paisa.
sidebar_position: 2
---

**How to split** is one control on the add-expense screen with four settings.
Whichever you choose, the shares always add up to the bill exactly. Waves will
not save a split that does not.

## The four ways

They sit in this order: **Equally**, **Shares**, **Percent**, **Exact**.

### Equally

The bill divided by the number of people in **Split between**. The default, and
the right answer most of the time.

The bottom bar previews it: _3 people owe ₹200 each._

### Shares

Weights rather than money. Give one person 2 and two people 1 each and the bill
splits three ways with the first person carrying half. Useful for a flat where
one room is bigger, or a car where one person drove twice as far.

### Percent

The same idea in percentages, which have to reach 100.

### Exact

You type each person's amount yourself. Every row has a field labelled with
whose it is — _{name}'s share_ — and the app keeps a running check:

- _{amount} left to assign_ — the shares do not add up to the bill yet.
- _{amount} too much_ — they add up to more than it.

Use it for a bill where one person had the lobster.

## Who gets the odd paisa

₹100 between three people is ₹33.33 each and one paisa over. That paisa cannot
be thrown away — if it were, the balances in the group would not sum to zero and
somebody would be permanently one paisa out.

So Waves hands the leftover units out one at a time, in a fixed member order,
starting at a position derived from that particular expense's id. Two
consequences are worth knowing:

- **Every device agrees.** Your phone, your friend's phone and the server all
  compute the same share for the same expense, so nobody sees a figure that
  disagrees by a paisa.
- **It moves around.** A different expense starts at a different position, so
  the same person does not absorb the extra unit every time.

You will never be asked about this. It is here because people notice the ₹33.34
and wonder.

## Trip presets

A group whose **Kind** is **Trip** gets four ready-made splits under **Trip
presets**:

| Preset         | What it does                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **By nights**  | Split a stay by how many nights each person was there.                                                           |
| **Car rental** | Split a hire between whoever shared the car, with optional fuel and tolls, and a **Driver pays nothing** option. |
| **This ride**  | Split one taxi between whoever was in it, rather than the whole group.                                           |
| **My treat**   | One person covers it. Everyone else's share is zero.                                                             |

Each one is a shortcut to a split you could have built by hand.

## Split by item

**Split by item** is not a fifth setting. It sits under the same **How to
split** heading as a link, and it opens a screen of its own.

If a scanned bill was read line by line, it puts the list in front of the group
and everybody taps what they had:

> {n} lines, nobody has claimed one yet. Tap what you had.

The screen counts progress — _{claimed} of {items} lines claimed_ — and turns
the claims into shares when it is done. An expense split this way is labelled
**Itemized** on its detail screen.

## Reading the split back

The expense detail screen names the split under **Split**, using the fuller
wording: **Split equally**, **Exact amounts**, **By shares**, **By percentage**,
**With adjustments**, **Itemized**.

**Who owes what** lists the resulting shares person by person. If somebody both
paid and has a share, their row shows both: _paid ₹1,200 · share ₹400_.

If you are looking at a bill you are not part of, the app says so rather than
showing you a zero:

> **You're not in this split.** You're viewing this as a group member — nothing
> here touches your balance.

## Next

[People and placeholders →](./people-and-placeholders.md)
