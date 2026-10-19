# Waves Assistant: manual QA checklist

Run on **Wednesday 21 Oct 2026, 11:00 to 15:00**, on a release-candidate build. Tick one box per device. Attach a screenshot to the PR for every item that fails and for QA-05, QA-13, QA-26 and QA-28.

## Setup

| What        | Detail                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iPhone      | iOS 26. Run once in dark and once in light.                                                                                                                                                                      |
| Android     | API 34, light.                                                                                                                                                                                                   |
| Assistive   | One of the two with VoiceOver or TalkBack for QA-28.                                                                                                                                                             |
| Accounts    | **Pro**, **Pro trial**, **Free**, **Free with the advanced-voice quota used up**. Pro must be on `voice_agent_allowlist` or have the flag.                                                                       |
| Backend     | Staging, migrated (including `20261020120000_assistant_events`). The live model is used here; `VOICE_AGENT_STUB` is for the Maestro flows only and must be OFF for this pass.                                    |
| Seed        | `node e2e/seed-e2e.mjs` (optionally `E2E_SEED_EXTRAS=assistant`) gives Goa trip (Priya, Sam, Dev, Ravi) and Flat 4B. Personal data is on the device and has to be entered by hand where an item says so (QA-17). |
| Permissions | Microphone allowed throughout. Location allowed unless the item says otherwise.                                                                                                                                  |

Legend: iPhone `[ ]` / Android `[ ]`. Mark `[x]` pass, `[!]` fail with a note.

## Items

### QA-01 Pro: spoken personal add, quiet room

**Steps**

1. Sign in as the Pro account. Open the assistant from the mic.
2. In a quiet room say: "add 8000 rupees to my personal expense".

**Expected:** The confirm card shows ₹8,000 and "Just for you" within 2.5 s of you stopping.

- [ ] iPhone
- [ ] Android

### QA-02 Pro: same sentence in a noisy room

**Steps**

1. Play café or street noise nearby.
2. Say the QA-01 sentence.

**Expected:** Either the correct card or a clarifying question. A wrong amount is never confirmed silently: if the amount on the card is not 8,000, the card must not have been auto-saved.

- [ ] iPhone
- [ ] Android

### QA-03 Hinglish amount

**Steps**

1. Say: "aath hazaar personal mein".

**Expected:** Card for ₹8,000, personal.

- [ ] iPhone
- [ ] Android

### QA-04 Tamil-English

**Steps**

1. Say: "nooru coffee enakku mattum".

**Expected:** Card for ₹100 personal, or a clarifying question. Never a different amount.

- [ ] iPhone
- [ ] Android

### QA-05 Confirm gives the Added line and first question fast; location chip

**Steps**

1. Allow location when asked. Stand somewhere with a named place (a cafe, a mall).
2. Say the QA-01 sentence and tap Confirm.

**Expected:** "Added ₹8,000 to Personal ✓" and the first question appear within 150 ms of the tap. The place question offers the place you are at as its first chip ("you're here") and it is the correct place.

- [ ] iPhone
- [ ] Android

### QA-06 Location denied

**Steps**

1. Settings: set Waves location to Never.
2. Add an expense by voice and Confirm.

**Expected:** No location prompt, no place chip marked "here", no "Where was this?" built on the current place. Other questions still work.

- [ ] iPhone
- [ ] Android

### QA-07 Tap a chip

**Steps**

1. Add an expense that gets a payment or category question.
2. Tap an answer chip (for example UPI).

**Expected:** "Updating…" shows briefly, then the next question or the closing line. A light haptic fires on the tap (iPhone and Android with vibration on).

- [ ] iPhone
- [ ] Android

### QA-08 Skip twice stops the chain

**Steps**

1. Add a ₹8,000 personal expense. When the first question shows, tap Skip.
2. Tap Skip on the second question.

**Expected:** A closing line and no third question. Skip is gone.

- [ ] iPhone
- [ ] Android

### QA-09 Done closes

**Steps**

1. Add an expense and answer or skip a question until Done shows.
2. Tap Done.

**Expected:** The assistant closes and you are back where you started.

- [ ] iPhone
- [ ] Android

### QA-10 Don't ask this again, and reset

**Steps**

1. Add an expense; on the payment question tap "Don't ask this again".
2. Add another expense of a similar size.
3. Profile: tap "Reset muted questions".
4. Add another.

**Expected:** The second add has no payment question. After Reset it is asked again, and a "Follow-up questions reset" toast shows.

- [ ] iPhone
- [ ] Android

### QA-11 Type an answer on the device path

**Steps**

1. Add an expense that asks about place or payment.
2. Tap "Type instead", type "blue tokai, cash", send.

**Expected:** Place and payment are set with no spinner and no delay (read on the phone). Saved line names both.

- [ ] iPhone
- [ ] Android

### QA-12 Correct an amount by typing, then undo the correction

**Steps**

1. Add ₹250 personal. Tap Change and type "make it 800".
2. Tap the Undo beside the "Changed to ₹800" line.

**Expected:** The amount becomes ₹800 in the saved line and in Personal. Undo returns it to ₹250 in both.

- [ ] iPhone
- [ ] Android

### QA-13 Undo and Restore

**Steps**

1. Add a personal expense and tap Undo on the "Added" line.
2. Open Personal transactions, then Home, and check the monthly total.
3. Return to the assistant and tap Restore.

**Expected:** "Removed ..." with Restore. The ledger and totals drop the entry while removed. Restore brings it and the totals back exactly once.

- [ ] iPhone
- [ ] Android

### QA-14 Group expense, payer named

**Steps**

1. In a group with a member named Ravi say: "dinner 1200 Ravi paid".
2. Confirm, then answer "Ravi paid" to the payer question.
3. Open the group's balances.

**Expected:** Ravi is the payer, and the balances show everyone else owes Ravi their shares (not you paying). Totals match a hand check.

- [ ] iPhone
- [ ] Android

### QA-15 Receipt chip hand-off

**Steps**

1. Add a large personal expense (₹8,000) to get the receipt question.
2. Tap Scan (or Pick photo).

**Expected:** The camera or picker opens. After you take or pick a photo and come back, the line reads "Opened it for you" and the receipt is on the entry.

- [ ] iPhone
- [ ] Android

### QA-16 Split chip moves the personal entry (D7)

**Steps**

1. Add a food expense that you usually split with someone, so the Split question appears.
2. Tap the partner chip, then save the prefilled group expense.

**Expected:** The add-expense screen is prefilled with the partner. After the group save succeeds the personal entry is deleted (no double count). If you back out of the group form, the personal entry stays.

- [ ] iPhone
- [ ] Android

### QA-17 Recurring suggestion

**Steps**

1. Enter "Rent" by hand as the same amount on about the same day for each of the last 3 months.
2. Add "Rent" again by voice this month.

**Expected:** "This looks monthly — repeat it every month?" Tap Repeat monthly: a rule appears in Personal > Recurring with auto-post OFF.

- [ ] iPhone
- [ ] Android

### QA-18 Lend becomes a loan

**Steps**

1. Say: "gave 2000 to Anu".
2. Confirm and answer "Yes, Anu owes me".

**Expected:** A loan to Anu is in Personal > Loans for ₹2,000, and the spending total drops by ₹2,000.

- [ ] iPhone
- [ ] Android

### QA-19 Duplicate across two accounts

**Steps**

1. On a second account in the same group, add "Dinner" for ₹1,200.
2. On this account say: "dinner 1200" in that group and Confirm.
3. Tap "Same, remove mine".

**Expected:** The duplicate question names the other person. Only YOUR entry is removed; theirs remains; balances match one dinner.

- [ ] iPhone
- [ ] Android

### QA-20 Trip wrap-up

**Steps**

1. Use a trip whose end date was yesterday.
2. Add an expense to it by voice.

**Expected:** "<trip> looks finished. Settle up now?" Tapping Settle up opens the Settle up screen for that trip.

- [ ] iPhone
- [ ] Android

### QA-21 Offline add, then sync

**Steps**

1. Turn on airplane mode.
2. Add an expense by voice (read on the phone). Use the chips on the questions.
3. Turn airplane mode off and wait for sync.

**Expected:** The add works offline, chips work, "Type instead" is hidden. After reconnecting the entry is synced exactly once (no duplicate on a second device or the web).

- [ ] iPhone
- [ ] Android

### QA-22 Kill the app mid-question

**Steps**

1. Add an expense; while a question shows, force-quit the app.
2. Reopen.

**Expected:** The expense exists and no question is waiting. (The question session is not persisted; that is accepted.)

- [ ] iPhone
- [ ] Android

### QA-23 Free account out of quota: teaser once

**Steps**

1. Use a Free account with advanced voice commands used up.
2. Add an expense by voice twice, on different days if needed.

**Expected:** The basic on-device path works. No follow-up questions. The "Pro would ask" teaser appears at most once a week, with Dismiss and See Pro, and never blocks Done.

- [ ] iPhone
- [ ] Android

### QA-24 Pro fair-use exhausted

**Steps**

1. Use a Pro account that has hit the monthly command limit (or the follow-up cap).
2. Try chips, then a typed answer.

**Expected:** Chips (read on the phone) still work. A typed answer says the limit is reached, without losing the saved expense.

- [ ] iPhone
- [ ] Android

### QA-25 Two items in one breath

**Steps**

1. Say: "breakfast 300 and cab 450 Goa".

**Expected:** Two cards. "Confirm all" saves both and asks no follow-up questions.

- [ ] iPhone
- [ ] Android

### QA-26 Dark mode

**Steps**

1. Set the phone to dark mode.
2. Walk through an add with two questions, then collapse the card.

**Expected:** Chips are legible, contrast is fine, and there is no white flash when the card collapses.

- [ ] iPhone
- [ ] Android

### QA-27 Dynamic Type / font scale at the largest size

**Steps**

1. iPhone: Larger Text to the maximum (XXL). Android: font size Largest and display size Largest.
2. Run an add with a question.

**Expected:** Chips wrap, nothing is clipped, and Done and Skip are reachable (scroll if needed).

- [ ] iPhone
- [ ] Android

### QA-28 Screen reader (VoiceOver on iPhone, TalkBack on Android)

**Steps**

1. Turn the screen reader on.
2. Add an expense and reach a question.

**Expected:** The question is announced when it appears. Each chip is a button with its full label. Skip and Done are reachable by swiping. Undo reads "Undo <amount> <description>".

- [ ] iPhone
- [ ] Android

### QA-29 Reduce Motion

**Steps**

1. Turn on Reduce Motion (iPhone) or Remove animations (Android).
2. Run an add with two questions, and Undo.

**Expected:** No slide or spring animations; the Undo ring is a still dot.

- [ ] iPhone
- [ ] Android

### QA-30 Rotate, background and foreground mid-question

**Steps**

1. Reach a question.
2. Rotate the phone (if rotation is on), lock it for 10 s, switch apps, return.

**Expected:** The question and your place in the chain are intact. Nothing is saved twice.

- [ ] iPhone
- [ ] Android

### QA-31 Mutes are per device

**Steps**

1. Sign in to the same account on two phones.
2. On phone A mute the payment question. Add an expense on phone B.

**Expected:** Phone B still asks the payment question (mutes are stored per device, by design).

- [ ] iPhone
- [ ] Android

### QA-32 Follow-up questions toggle

**Steps**

1. Profile: turn "Follow-up questions" off and add an expense.
2. Turn it on and add again.

**Expected:** Off: the expense saves with the Added line and no question. On: questions return.

- [ ] iPhone
- [ ] Android

### QA-33 Intro shows once per account

**Steps**

1. Use a fresh account or reinstall.
2. Add an expense; tap Got it on the intro; add another.

**Expected:** The intro ("I'll ask one or two quick things") shows with the first follow-up only, and not again. Signing in as a different new account shows it again.

- [ ] iPhone
- [ ] Android

### QA-34 Telemetry rows, enum props only

**Steps**

1. After QA-01..QA-13 on staging, run the SQL below as a staging admin.

**Expected:** Rows exist for assistant_opened, assistant_command, assistant_followup_shown/answered/skipped/muted, assistant_correction, assistant_undo. Every props value is a short enum or number; the amount, description, place and names appear nowhere.

```sql
select name, props, platform, occurred_at
from app_events
where name like 'assistant_%'
order by occurred_at desc
limit 100;

-- must return zero rows: no free text in props
select id, name, props from app_events
where name like 'assistant_%'
  and props::text ~ '(8000|800|250|450|Ravi|Anu|Priya|tokai)';
```

- [ ] iPhone
- [ ] Android

### QA-35 Server log for a follow-up turn

**Steps**

1. Make a typed follow-up that goes to the server (for example a note the phone cannot read).
2. Open the voice-agent function logs for that minute (Supabase dashboard > Edge Functions > voice-agent > Logs).

**Expected:** The line shows `turn: 'followup'`, latency, model, action types and `updateFields`. It contains no transcript, no place, no names, no amounts.

- [ ] iPhone
- [ ] Android

### QA-36 Latency sample

**Steps**

1. Run 20 spoken commands on Wi-Fi (mix of personal, group, a question).
2. Record time from end of speech to card for each.

**Expected:** p50 and p95 are written in the PR description. Target: p50 under 2.5 s, p95 under 6 s.

- [ ] iPhone
- [ ] Android

### QA-37 Hindi and Tamil UI

**Steps**

1. Account > Language: Hindi, then Tamil.
2. Run an add with two questions, Undo, and the Profile follow-up rows.

**Expected:** Every assistant and follow-up string is translated; none shows a raw key or falls back to English.

- [ ] iPhone
- [ ] Android

### QA-38 Web unaffected

**Steps**

1. Open the web app, sign in, add an expense, open Personal.

**Expected:** No assistant UI, no follow-up questions, no console errors. Add expense works as before.

- [ ] iPhone
- [ ] Android

### QA-39 Widgets and quick actions open the assistant

**Steps**

1. Tap the Search/voice widget, the app-icon quick action, and the in-app entry points (mic, "Ask the assistant" on Personal).

**Expected:** Each opens the voice screen (the right scope: Personal shows "Adding to Personal").

- [ ] iPhone
- [ ] Android

### QA-40 Release build runs the whole chain

**Steps**

1. Install the release (not dev) build on both platforms.
2. Run QA-01, QA-05, QA-07, QA-12, QA-13, QA-21.

**Expected:** All behave as in dev: no red screens, no missing fonts or icons, haptics work, and the new image/asset files render (no blank tiles).

- [ ] iPhone
- [ ] Android

## Sign-off

|                           | iPhone | Android |
| ------------------------- | ------ | ------- |
| Tester                    |        |         |
| Build / version           |        |         |
| Items passed (of 40)      |        |         |
| Blocking failures         |        |         |
| Latency p50 / p95 (QA-36) |        |         |
