---
id: bank-messages
title: Bank messages
description: Turning bank payment messages into expenses — pasted on any phone, or read for you on Android — and why the drafts stay on the phone until you use them.
sidebar_position: 8
---

A bank sends a message for almost every card or UPI payment. Waves can turn
those messages into drafts in **Review**, so the spend is waiting for you to
put in a group instead of being typed out again.

## Two ways in

**Paste them.** In **Review**, **Add from a message** opens **Add from bank
messages**. Copy the payment messages from your messages app and paste them in.
Waves reads them on the phone, lists the payments it found, and you tick the
ones you want. This works on every phone, including iPhone.

**Let Waves read them (Android).** On Android, Waves can look through the bank
messages already on the phone for you. It asks first, on its own screen, before
Android shows the permission prompt — and you can say no; pasting still works.
Once allowed, it checks for new payment messages when you open the app and
about once an hour, and the confident ones appear in **Review** under **SMS**.
Every message it read, confident or not, is on the **Bank messages** screen.

## Drafts stay on the phone until you use them

A draft made from a bank message — pasted or read — is kept **only on the phone
that made it**. It is not synced, so your other devices never see it: an iPad
or the web app on the same account shows no SMS drafts at all.

On the phone, drafts are stored encrypted, in a store the app never syncs. They
are not included in your personal cloud backup.

A draft leaves the phone only when you use it:

- **Add it to a group**, and the expense it becomes syncs like any expense you
  typed — amount, description, date. The message itself is never part of it.
- **Just me** puts it in your [Personal](./personal-ledger.md) ledger, which
  syncs as your personal records always do.
- **Not an expense** (dismissing it) deletes the draft from the phone. Nothing
  is sent anywhere.

Signing out removes the drafts, and the bank messages Waves read, from the
phone.

### If you used Waves before this change

Earlier versions synced SMS drafts to your account, which is how they could
show up on another device. After you update, the first time the Android phone
syncs it moves any SMS drafts you had not used yet back onto that phone and
removes the synced copies, so your other devices drop them. Drafts you had
already added to a group were already expenses, and stay exactly as they are.

## What is never sent

The text of a message Waves read from your inbox is never saved with a draft
and never sent to Waves. A message you pasted is kept with its draft, encrypted
on the phone, so you can check the draft against it. Nothing on this path is
reported to crash reports or analytics.

## Next

[Personal ledger →](./personal-ledger.md)
