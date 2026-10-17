# Review Screen UX Roast

Source reviewed: `apps/mobile/src/app/(tabs)/captures.tsx`  
Screen: mobile **Review** tab (`/captures`)

This review is based on the local implementation, not a rendered screenshot. I am judging the screen like a first-time user who does not know the product internals, and like a designer optimizing for fast comprehension and repeated daily use.

---

## Critical

### 1. The screen is conceptually overloaded: “Review” is doing too many jobs

#### Designer Pass

The screen wants to be an inbox, a bank-message status dashboard, a draft manager, a bulk triage tool, an expense router, and an automation trust surface. That is a lot of product surface area for one bottom tab.

The implementation has:

- a gradient hero,
- an automation status line,
- a count summary,
- a bank-message CTA,
- segmented tabs,
- day headings,
- individual draft cards,
- batch cards,
- destination chips,
- uncertainty warnings,
- checkboxes,
- overflow sheets,
- a bottom bulk-action bar,
- a destination picker sheet.

Each element is defensible in isolation. Together, the screen risks becoming an operational cockpit instead of a simple “clear these items” workflow.

The biggest hierarchy problem: the user’s real question is probably **“What do I need to do next?”** but the screen answers with several competing concepts: Added, SMS, Ready, Worth a look, Bank messages, Watching, Nothing needs you, destination chips, batch cards.

#### User Pass

As a new user, I would hesitate because I do not immediately know what “Review” means. Am I reviewing expenses already added? Bank SMS messages? Drafts? Suspicious transactions? Something I need to approve?

If I see tabs called **Added** and **SMS**, I have to learn the app’s internal source model before I can act. Users do not wake up thinking “I need to process my SMS-sourced captures.” They think: “Did this expense get added?” or “Can I clear this?”

#### Recommendation

Reframe the screen around action, not provenance.

Better mental model:

- **Needs action** — things that need a destination or confirmation.
- **Maybe not expenses** — suspicious/noisy items.
- **Recently handled** — optional, maybe hidden behind history.

If source matters, show it as a small badge on the row, not as a primary navigation structure.

---

### 2. Primary action is not obvious enough

#### Designer Pass

The row supports multiple possible actions:

- tap row to assign,
- more menu to assign/edit/delete/file,
- checkbox in SMS tab,
- bottom bar to add selected to group,
- destination chip that implies “file here,”
- batch card expansion,
- bank-message row navigation.

This is classic “power-user UI disguised as simple UI.” It has useful shortcuts, but a first-time user may not know the happy path.

The card visual hierarchy likely emphasizes merchant + amount, but the action is destination assignment. The `DestinationChip` helps, but the UI still asks users to infer that tapping the card means “choose where this goes.”

#### User Pass

I would ask: “Do I tap the amount? The group chip? The checkbox? The row? The three dots?”

If I tap a row in SMS mode and it selects instead of opening, that is potentially surprising because the same row tap means different things in different tabs:

- Added tab: tap opens assign flow.
- SMS tab: tap toggles checkbox.

That inconsistency creates hesitation.

#### Recommendation

Make the primary action explicit on each row.

For example:

- If destination is known: show a clear primary pill **Add to Goa**.
- If destination is unknown: show **Choose group**.
- Secondary: **Not an expense**.
- Tertiary: overflow menu.

For high-volume SMS triage, keep bulk selection, but do not make row tap silently change meaning. Use explicit checkboxes for selection and make the rest of the row open detail/assignment consistently.

---

### 3. “SMS” as a primary tab label is too technical and too narrow

#### Designer Pass

The tab labels encode implementation source rather than user intent. **SMS** is accurate but not emotionally clear. It may also age poorly if the app later imports email, bank feeds, UPI notifications, receipts, or card alerts.

The product is trying to feel smart, but “SMS” makes it feel like a parser utility.

#### User Pass

As a user, “SMS” makes me wonder:

- Is the app reading my texts?
- Are these already expenses?
- Do I need to verify every message?
- Is this safe/private?
- Why are bank messages separate from review?

The trust question is huge. If the screen says SMS prominently, the privacy reassurance must be equally prominent and plain.

#### Recommendation

Rename based on user value:

- **Found for you** instead of SMS.
- **Added by you** instead of Added.

Then show source badges inside rows:

- SMS
- Pasted
- Voice
- Photo
- Manual

This keeps the primary model human and the secondary metadata available.

---

### 4. The Review screen may not be conversion-oriented for new users

#### Designer Pass

The prompt asks for “make every visitor start a free trial.” This screen appears to be an in-app operational screen, not a marketing page. Still, if this is part of onboarding or trial activation, it needs to sell the magic fast.

Current direction is utility-heavy: “here are waiting drafts.” That is good for retained users, but not enough for first-run conversion.

The strongest product magic is likely: **the app finds expenses from bank messages and turns them into split-ready drafts.** That value should be visually undeniable.

#### User Pass

If I land here during onboarding and it is empty, I may not understand what I am supposed to be excited about. “Nothing needs you” is excellent for an existing user, but weak for activation if the user has not experienced the automation yet.

#### Recommendation

Create separate first-run/empty-state variants:

1. **New user, no permission/import yet**  
   Headline: “Catch split expenses automatically.”  
   CTA: “Scan bank messages” / “Paste a bank message.”

2. **User has automation enabled, no drafts**  
   Headline: “You’re all caught up.”  
   Body: “We’ll surface split-worthy expenses here.”

3. **User has drafts**  
   Headline: “Review 7 expenses.”  
   CTA: “Clear all obvious ones.”

Do not use the same empty state for acquisition, activation, and retained usage.

---

### 5. Too much important functionality is hidden behind the three-dot menu

#### Designer Pass

The overflow sheet contains major actions: file to suggested group, assign, edit, delete/not expense. These are not minor actions. Hiding them behind `⋯` makes the screen cleaner but harms discoverability.

A three-dot menu is acceptable for destructive or rare actions. It is not ideal for primary review actions.

#### User Pass

As a first-time user, I may never discover that I can:

- file directly to a suggested group,
- mark something as not an expense,
- edit the parsed draft,
- batch-assign spoken expenses.

If the whole product value depends on fast triage, hiding triage controls is expensive.

#### Recommendation

Expose two visible actions on rows:

- Primary: **Add / Choose group / Add to [Group]**
- Secondary: **Not expense**

Keep `⋯` for:

- Edit details,
- Delete,
- advanced/debug-like options.

---

## High Impact

### 6. The hero may be visually heavy for a task inbox

#### Designer Pass

A gradient `ScreenHero` gives the tab personality, but Review is a productivity/inbox workflow. If the hero is too tall, it steals vertical space from the actual list.

For a screen where users may process dozens of rows, vertical efficiency matters more than brand drama. Linear/Superhuman-style screens are polished because they remove chrome around the work.

#### User Pass

If I have many expenses to process, I want the list immediately. A large hero with status, count, and icon may feel good once, then become repetitive every day.

#### Recommendation

Use a compact header after first run or when list count is high.

Possible behavior:

- First-time / empty: rich hero.
- Active inbox: compact sticky header with title, count, and status.
- Long list: collapse hero on scroll.

---

### 7. The bank-message row competes with the review list

#### Designer Pass

`bankMessagesRow` is rendered as `ListHeaderComponent`. That makes it the first item before the actual Review items. If the user came to clear drafts, a navigation row to another inbox is competing with the work.

It also creates a weird nested-inbox feeling: Review contains a row to Bank messages, while SMS-derived drafts also appear in Review.

#### User Pass

I would wonder: “Should I open Bank messages first, or handle these Review items first?”

If there is a badge saying bank messages are waiting, I may leave the Review list even though there are already actionable drafts below.

#### Recommendation

Move bank-message access into the hero/status area or a compact secondary link. Do not place it as the first list row unless bank messages are the primary task.

Alternative:

- Header status: “Watching bank messages · 3 need checking” with a small **View** link.
- Keep Review list focused on only actionable drafts.

---

### 8. “Ready” vs “Worth a look” sounds useful, but may add another taxonomy layer

#### Designer Pass

The file comments describe sections inside tabs: Ready and Worth a look. That is conceptually strong, but combined with Added/SMS tabs it creates a two-dimensional classification system.

Users must understand both:

- where the draft came from,
- how confident the parser is.

That is a lot for a mobile tab.

#### User Pass

I would prefer a simple priority order:

1. obvious items I can approve fast,
2. uncertain items needing attention,
3. noisy bank messages elsewhere.

I do not want to cross-reference tabs and sections.

#### Recommendation

Use confidence as the main grouping. Use source as metadata.

Better hierarchy:

- **Ready to add**
- **Needs checking**
- **Not sure these are expenses**

Then rows can carry small source labels.

---

### 9. Checkbox mode on SMS tab improves bulk actions but weakens direct manipulation

#### Designer Pass

Always-visible checkboxes in the SMS tab communicate bulk processing, which is good for high volume. But it also makes the screen feel like an admin table, not a consumer finance app.

The checkbox icon adds visual noise to every row. On small screens, that competes with category icon, merchant, destination chip, amount, and overflow.

#### User Pass

If I only have one SMS draft, the checkbox feels weird. I expect to tap and resolve it, not select it like email.

#### Recommendation

Use adaptive selection:

- If SMS count is small: row tap opens assignment, checkbox hidden.
- If SMS count is large or user taps **Select**: show checkbox mode.
- Add smart bulk suggestions: “Looks like 8 transfers. Mark all as not expenses?”

This gives power users speed without making every user start in spreadsheet mode.

---

### 10. Destination chips are useful but may not be enough to build trust

#### Designer Pass

The destination chip says where the app thinks the expense should go. That is valuable. But if the chip is based on merchant history, the UI should explain confidence or source.

A chip like “Goa” could feel like the app randomly guessed unless users know the rule.

#### User Pass

I would ask: “Why does it think this goes to Goa?”

If the guess is wrong once, I may stop trusting all chips.

#### Recommendation

Add lightweight explainability:

- “Usually goes to Goa”
- “Last time: Goa”
- “Suggested from merchant history”

Maybe show this only on first few uses or in a tooltip/sheet.

---

### 11. Empty state is good for retained users, weaker for action recovery

#### Designer Pass

“Nothing needs you” is excellent emotionally. It frames empty as success. But the empty state includes two CTAs: capture and paste/add another way. That may dilute the calm moment.

#### User Pass

If I am done, I want reassurance. If I am new, I want setup guidance. If something is missing, I want a recovery path.

One empty state cannot serve all three.

#### Recommendation

Split empty states by user state:

- **No setup:** “Start by connecting how expenses arrive.”
- **Setup active:** “Nothing needs you. We’re watching.”
- **Recently cleared:** “All caught up. 12 expenses filed this week.”
- **No groups:** “Create your first group to start splitting.”

---

### 12. Batch cards need clearer affordance

#### Designer Pass

Batch cards use a layers icon, count, hint, total, chevron, and overflow. This is reasonable but may still not communicate “these were spoken together and can be assigned together.”

The title “N expenses” is generic. It misses context.

#### User Pass

I may wonder why some rows are grouped and some are not. If I expand it, I need to understand whether assigning one row assigns all rows or only that row.

#### Recommendation

Use more explicit copy:

- “Spoken together · 3 expenses”
- “Add all to one group” as a visible action
- When expanded, label individual row actions clearly: “Edit this item” vs “Add whole batch”

---

### 13. Privacy reassurance around bank/SMS reading should be more visible

#### Designer Pass

There is a row subtitle `onDevice`, and comments imply strong privacy decisions. But privacy is not a footnote for SMS parsing; it is a conversion-critical trust issue.

#### User Pass

If I see an app reading bank messages, I need immediate reassurance:

- Is this on-device?
- Are full SMS bodies stored?
- Can I control it?
- Can I delete found items?

#### Recommendation

Add a concise trust line near automation status:

> “Read on-device. Message text is not uploaded.”

Make it tappable to a privacy explanation. This can increase trust and trial conversion.

---

## Nice to Have

### 14. Rename the screen if “Review” is not self-explanatory

#### Designer Pass

“Review” is short and tab-friendly, but generic. It could mean pending friend claims, receipts, expenses, imports, or notifications.

#### User Pass

I may not know why I should open this tab.

#### Recommendation

Consider labels like:

- **Inbox**
- **To Add**
- **Needs You**
- **Review** with badge and onboarding explanation

If keeping Review, make the hero title more specific: “Expenses to review.”

---

### 15. Add progressive education for gestures and bulk actions

#### Designer Pass

The implementation has thoughtful interaction details, but much of it is invisible until discovered.

#### User Pass

I will not know that I can bulk-select, use row actions, or trust destination suggestions unless the UI teaches me at the moment I need it.

#### Recommendation

Use small first-use hints:

- “Tap a row to choose where it goes.”
- “Select multiple bank messages to clear them together.”
- “Suggested groups come from where you filed this merchant before.”

Show once, dismiss forever.

---

### 16. Make “not an expense” safer but still fast

#### Designer Pass

Instant dismissal for found SMS items is efficient, but if the user makes a mistake, the UX needs visible recovery.

#### User Pass

If I accidentally mark something as not an expense, I need an undo. A toast saying done is not enough unless it includes Undo.

#### Recommendation

Add undo to dismissal toast:

- “Marked not an expense · Undo”

For bulk dismiss:

- “12 marked not expenses · Undo”

---

### 17. Add smarter grouping and suggested actions

#### Designer Pass

The screen currently makes the user process rows. A premium-feeling AI/automation product should process clusters.

#### User Pass

I do not want to clear 30 card bills manually. I want the app to say: “These 12 look like self-transfers. Clear them?”

#### Recommendation

Add grouped suggestions:

- “8 credit card payments — mark not expenses”
- “5 Swiggy orders usually go to Flatmates — add all”
- “3 items need a group”

This turns the screen from a list into an assistant.

---

### 18. Improve row information scent

#### Designer Pass

Rows currently show title, destination, doubts, pending marker, amount. Useful, but the date/location/payment method may be hidden unless editing.

#### User Pass

Before filing an expense, I may need to know:

- when it happened,
- which card/account,
- whether the amount is debit or credit,
- whether it has a receipt/photo,
- why it was captured.

#### Recommendation

Add compact metadata only when useful:

- “Yesterday · HDFC card”
- “From SMS”
- “Photo attached”
- “Date guessed”

Avoid always showing everything. Use uncertainty-driven disclosure.

---

### 19. Consider a “review queue complete” celebration

#### Designer Pass

The empty state already treats zero as success. A little completion feedback can make Review habit-forming.

#### User Pass

After clearing a pile, I want closure.

#### Recommendation

When the user reaches zero from a non-zero state, show a satisfying transient state:

- “Inbox zero. 14 expenses handled.”
- subtle animation,
- “View activity” secondary link.

---

### 20. Make trial/paywall value explicit if this is monetized

#### Designer Pass

If the app monetizes automated capture, the screen needs to show what paid users get without feeling blocked.

#### User Pass

I need to understand what I gain by starting a trial:

- automatic bank-message review,
- fewer manual entries,
- bulk clean-up,
- smart group suggestions.

#### Recommendation

For non-trial/free users, add a tasteful upgrade module only when relevant:

> “Save 10 minutes a week: automatically find split expenses from bank messages.”  
> CTA: “Start free trial”

Do not put this above active review work for paying/trial users.

---

## What I Would Remove or De-emphasize

1. **Source as primary navigation**  
   Demote SMS/Added into badges or filters unless research proves users think this way.

2. **Always-visible SMS checkboxes**  
   Use explicit selection mode or adaptive display for high-volume lists.

3. **Bank messages as first list row**  
   Move it to status/header unless it is the most important next action.

4. **Too many hidden primary actions in overflow**  
   Promote “Add to group” and “Not expense.”

5. **Large hero for heavy daily usage**  
   Collapse or compact it when there are many rows.

---

## Features I Think Are Needed

1. **Undo for dismiss/delete/not-expense.**
2. **Clearer first-run onboarding for Review.**
3. **Privacy explanation for SMS reading.**
4. **Visible row-level primary action.**
5. **Smart grouped suggestions for noisy bank messages.**
6. **Reason behind destination suggestions.**
7. **Separate empty states by setup/user lifecycle.**
8. **Consistent row tap behavior across tabs.**
9. **Compact mode for large queues.**
10. **Trial conversion module if automation is paid.**

---

## Overall Verdict

The thinking behind this screen is strong. It is not lazy vibe-coded UI. The implementation shows product taste: offline-first behavior, privacy constraints, empty-state care, accessibility actions, and real high-volume workflows.

But the user-facing experience risks being too clever. The screen exposes the app’s internal taxonomy — SMS vs Added, ready vs uncertain, bank-message inbox vs Review inbox — instead of giving the user one obvious job: **clear the things that need attention**.

The best version of this screen should feel like Superhuman for expenses:

- one clear queue,
- one obvious next action,
- bulk actions when volume appears,
- smart suggestions that explain themselves,
- privacy reassurance where trust is needed,
- no visible machinery unless the user asks for it.

If I had to make only three changes, I would:

1. Rename/reframe tabs from **SMS / Added** to user-intent language or remove them as primary navigation.
2. Add visible row actions: **Add to [Group] / Choose group** and **Not expense**.
3. Add lifecycle-specific empty/onboarding states that sell the automation and build trust.
