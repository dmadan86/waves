---
id: discovery-settings
title: How people find you
description: Who can look you up on Waves, what group-mates can see, and the rest of the privacy controls.
sidebar_position: 1
---

**Settings → How people find you** controls two separate things: whether
somebody can look you up, and what the people already in your groups can see.

The app's own summary of the model:

> Somebody who already has your number or your address can look you up on Waves.
> Nobody can browse for you, and no search is ever by name.

## Being found

Two switches, both defaulting to on:

- **Find me by my phone number** — _"Only an exact match. Turning this off does
  not remove you from groups you are already in."_
- **Find me by my email address** — _"Only an exact match, and only the address
  on this account."_

Turning both off means nobody can find you through search. It changes nothing
about the groups you are in, and nothing about what anybody owes.

There is no search by name and no directory to browse. A search that finds
nothing gives a deliberately ambiguous answer — _"Nobody uses that, or they have
chosen not to be found by it"_ — so a miss cannot be used to confirm that an
address is in use. Searches are rate-limited per day for the same reason.

## What group-mates see

**On your profile** decides who can read your phone number and email:

| Setting                         | What it means                                            |
| ------------------------------- | -------------------------------------------------------- |
| **People I share a group with** | They can see your phone and email on your profile.       |
| **Nobody**                      | Your phone and email stay hidden, even from group-mates. |

Either way, somebody who found you by typing your number will see that number —
they already had it. And the footnote that matters:

> None of this ever changes who owes what.

## The rest of the privacy screen

**Settings → Privacy** is a longer read, and worth one. It covers:

- **What is stored.** Your display name and whichever of a phone number, email
  or sign-in identity you used; optionally a payment handle and a country; the
  groups, expenses and who-owes-whom. _"No contacts are uploaded, and there is
  no advertising identifier."_
- **How it is kept.** Every table is behind row-level security in the database —
  _"not a filter applied by the app, but a rule the database enforces"_. Receipt
  images sit in a private bucket reached through short-lived signed links. Crash
  reports are scrubbed of addresses, phone numbers, payment handles and keys
  before they leave the phone.
- **On this phone.** Your ledger is kept on the device so the app works with no
  signal, and it is sealed with a key held in the phone's secure store — _"a
  copy of that file taken off the phone is unreadable without it"_. App settings
  and receipts still waiting to upload sit outside the seal. Signing out clears
  all of it together.
- **Who else touches your data.** Supabase for the database and sign-in, Sentry
  for scrubbed crash reports, Microsoft Clarity for anonymous usage **only if
  you switch it on**. _"Your data is never sold, and there are no ad networks."_
- **How long it is kept.** While your account is open. An account untouched for
  three years is deleted along with the personal data in it. A group untouched
  for eighteen months is archived, not deleted. It also says what survives
  deleting your account — the shared record does, without your name on it.

## The controls themselves

The Privacy screen holds the controls over what other people can see of you:

- **How people find you** — the two switches above.
- **Blocked** — people you have blocked.
- **Record how I use the app** — anonymous screen analytics, off unless you turn
  it on.

The rest live in Settings proper, because they change how the app behaves rather
than who can see you:

- **App lock** — under **Settings → Security**. _Ask for fingerprint or face to
  open Waves._ Off means _"anyone holding your phone can read the ledger."_
- **Notifications** — under **Settings → Preferences**. Every category can be
  turned off; the default is _only what involves me_.
- **Export your data** — under **Settings → Data & privacy**, and offered again
  on the way out of the delete screen. See
  [Export your data](./export-your-data.md).
- **Delete my data** — the red card at the very bottom of **Settings**. See
  [Delete your account](./delete-your-account.md).

## Next

[Export your data →](./export-your-data.md)
