# Personal space: layout fixes

Three problems found on Android (1080×2400, about 411×914dp). Screenshots: `.playwright-mcp/qa-personal/retest-01e.png`, `retest-14a.png`.
Follows `docs/design-standard.md`. References are Mobbin iOS screens (Mobbin has no Android set).

Line numbers are from `main` at 7bc2ff4fc. "Likely cause" notes are read from the code and the screenshots, not reproduced on a device: confirm before fixing.

## 1. Edit loan sheet

### References

- [Buddy, Editing wallet (Loan)](https://mobbin.com/screens/aeddf0a8-3161-4e29-baa1-1555d095bfae): history is a short "Latest transactions" block with one "See all transactions" row; Save is pinned at the bottom, outside the scroll.
- [YNAB, Loan](https://mobbin.com/screens/f82cde3f-c4d8-4688-94ba-4f16096e79ef): details and activity are kept apart (Overview | Activity); editing is one pencil in the header, not buttons in the body.
- [Afterpay, Payment schedule](https://mobbin.com/screens/896a8f02-33b2-45e2-8d85-2d30cba028b8): payments are a plain date + amount list; rare actions sit in the header ⋯; one pinned primary button.
- [KOHO, Manage plan](https://mobbin.com/screens/fc1765bf-649a-4c42-ac0b-0f95ef5165e8): the destructive action is the last thing on the page, plain red text after a divider, never a filled button next to the primary.

### Recommendation

Keep the sheet (no route jump mid-flow). Make it a form and nothing else: fields, then read-only history, with Save pinned. Everything that is not a field moves to a ⋮ on the loan card.

File: `apps/mobile/src/app/personal/loans.tsx`, `LoanEditor` (line 578).

1. **Scroll.** Likely cause: the `ScrollView` (line 705) sits in a card that only has `maxHeight`, so it takes its content height and the card clips it. Split the sheet into three parts inside `Sheet`:
   - Header (fixed): title + close button, the existing `Row` at line 714, moved out of the `ScrollView`. `paddingHorizontal: spacing.xl`.
   - Body: `ScrollView` with `style={{ flexGrow: 0, flexShrink: 1 }}`. If it still does not scroll, give it `maxHeight: Math.round(windowHeight * 0.92) - 200` (header + footer + foot). `contentContainerStyle`: `paddingHorizontal: spacing.xl`, `paddingBottom: spacing.lg`, `gap: spacing.md`.
   - Footer (fixed): error text if any, then Save. `paddingHorizontal: spacing.xl`, `paddingTop: spacing.sm`, hairline `border` on top. Use `Button` (`fullWidth`, brand, 10 radius) in place of the hand-drawn capsule at line 971.
2. **Body order.** I borrowed / I lent · Amount · EMI · With · What was it for? · Starts on · Payments.
   - Subtitle "Track money you owe or money you lent." shows on Add only, not on Edit.
   - Payments stays as the last block (line 998): `caption` muted label "Payments", up to 5 rows of date + amount, 44dp each, as today. No change to the tap (opens the entry).
3. **Move out of the sheet** to a ⋮ on each loan card (end of the card's title row, line 344; `IconButton` with `ellipsis-vertical`, opens `OverflowMenu` with `anchor` measured from the button):

   | Row                         | Icon                                         | Section  | When                        |
   | --------------------------- | -------------------------------------------- | -------- | --------------------------- |
   | "Mark as closed" / "Reopen" | `checkmark-done-outline` / `refresh-outline` | `state`  | always                      |
   | "Stop sharing"              | `people-outline`                             | `share`  | `loan.synced && unlinkable` |
   | "Delete" (`tone: 'danger'`) | `trash-outline`                              | `danger` | always                      |
   - Delete keeps the confirm dialog and its body text from line 1056 unchanged, and still removes linked payments.
   - Mark as closed / Reopen saves at once (upsert with `status` flipped); it no longer waits for Save. This replaces the "Close [Close]" row (line 953), whose label and button read the same.
   - When a shared loan cannot be unlinked, show the existing `cannotStopSharing` text as the `hint` of a disabled "Stop sharing" row.
   - New string: `t.personal.markLoanClosed` = "Mark as closed". "Reopen", "Stop sharing", "Delete" exist.

4. Out of scope: the lavender capsule fields. They break the calm system (radius 8 controls, no capsules) but are a separate restyle.

### Acceptance (1080×2400)

- Open Edit on a loan with 5 payments: the title and Save never move; the body scrolls; the last payment row can be scrolled fully above Save.
- Nothing is cut by the bottom edge or the navigation bar, with the keyboard closed and open.
- The sheet has no Delete, no Close/Reopen and no Stop sharing.
- A loan with no payments fits without scrolling.
- Loan card ⋮ opens the pop-up next to the button; Delete is red, last, under a divider; tapping it shows the confirm.
- "Mark as closed" moves the loan to closed at once; the same menu then says "Reopen".
- Add loan shows the subtitle; Edit loan does not.

## 2. Home "More" menu

### References

- [Revolut, Invest home](https://mobbin.com/screens/35ebfb71-9114-4c37-92fa-99389940d31a): "More" opens a 3-row menu right at the More button; the main actions stay as tiles.
- [Revolut Business, Home](https://mobbin.com/screens/c119559f-95c2-49ed-acad-5f2ee953c1e6): 4 rows, one line each, menu grows from the button that opened it.
- [Mercury, Accounts](https://mobbin.com/screens/d538550f-6446-4e95-871c-3ee284daf776): 2-row menu anchored under the +; hairline dividers, no scrolling.
- [Origin, Net worth options](https://mobbin.com/screens/760a362a-b3c9-42b2-90d4-d28f1802a234): 5 rows is where others stop; none of the references shows a pop-up that scrolls.

### Recommendation

**a. Never clip (component).** File: `apps/mobile/src/components/OverflowMenu.tsx`.

Likely cause: the card is 220dp wide (`minWidth`; a `ScrollView` does not pass its content width up), so "Ask about my spending" wraps to two lines. The card in the screenshot is as tall as seven one-line rows (about 326dp), so the extra line pushes "Add by voice" out of view. There is plenty of room below (about 760dp), so `room` is not the limit.

- Size the list from its real height: keep `contentHeight` from the `ScrollView`'s `onContentSizeChange` and set `height: Math.min(contentHeight, room)` in place of `maxHeight` + `flexShrink` (line 274).
- Label: `numberOfLines={1}` (line 360). Card `minWidth: 248` (was 220), so 180dp of label fits "Ask about my spending" and "Import a statement" on one line. `maxWidth` unchanged.
- When `contentHeight > room` (a long month list), set `showsVerticalScrollIndicator` to true so a cut row reads as scrollable.
- Row height (44dp), padding (`spacing.lg` / `spacing.md`) and `MENU_FOOT` stay.

**b. Open at the tile.** File: `apps/mobile/src/app/(tabs)/me.tsx`, line 716. Pass `anchor` measured from the More tile (same way as `monthAnchor`, line 717). The menu then opens above the tile, next to the finger, not at the top corner.

**c. Shorter menu: 7 rows to 5.** `moreItems`, line 284.

| Order | Row                   | Section |
| ----- | --------------------- | ------- |
| 1     | Spending              | `views` |
| 2     | Ask about my spending | `views` |
| 3     | Reminder              | `add`   |
| 4     | Add by voice          | `add`   |
| 5     | Import a statement    | `data`  |

- Remove "To-Do & Tasks": it opens `/personal/setup`, the same place as the first row of the gear menu (line 727).
- Move "Categories" to the gear menu (line 726), after the scene row: it is a setting.
- Set `section` on every row so dividers draw (design standard, ⋮ menu order). Copy is unchanged.

### Acceptance (1080×2400)

- Tap More on Home: all 5 rows are fully visible with no scrolling; two dividers; every label on one line.
- The menu touches the More tile (opens above it), not the header.
- Font size at the largest system setting: every row is still reachable; if the list scrolls, a scroll bar shows.
- Gear menu has 4 rows, including Categories.
- Month picker menu (long list) still scrolls and still opens at its pill.
- Other ⋮ menus (group screen, expense, Recurring) look the same apart from being 28dp wider.

## 3. Add controls

### References

- [Buddy, Transactions](https://mobbin.com/screens/342ef140-0224-455a-98ac-8c8b4f862aeb) and [Copilot, Transactions](https://mobbin.com/screens/b945aba6-956f-47a7-973f-f37c4159e8e0): the daily list has one floating +, bottom right above the tab bar, and no + in the header.
- [Mercury, Spending](https://mobbin.com/screens/3c3ecfe3-03fa-4c7c-ab09-68213f8d5599): a calm screen with a short list has one + in the header and no floating button.
- [Chime, Family](https://mobbin.com/screens/47370a64-3df2-4a44-bd11-91e59e309455) and [Monarch, Budget](https://mobbin.com/screens/cfc569e0-0ef7-4ee1-a978-662825af5b27): an empty screen shows one sentence and one button; nothing else on the screen adds.
- [Wise, Bill splits](https://mobbin.com/screens/c62b97b9-bfb4-41e3-8abf-be88aa4867e6): the add control is in the header on a pushed screen, in the same place whether the list is empty or not.

### Rule

One add control per screen, chosen by where the screen lives:

| Screen                                                              | Add control                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tab root (Home, Transactions)                                       | The tab-bar FAB (`components/AppTabBar.tsx`). No + in the header.                                                                                |
| Sub-screen with a back header (Loans, Recurring, Budgets, Upcoming) | One + in the header (`PlainHeader` `trailing`: `IconButton`, `add`, `iconSize.xl`, `brand`). No FAB.                                             |
| Any list that is empty                                              | The button in the empty state is the only add control; hide the header +. Label is verb + noun: "Add expense", "Add loan", "Add recurring item". |
| List empty because of filters                                       | "No entries match these filters" + "Clear filters". The screen's normal add control stays.                                                       |

### Changes

- `app/personal/loans.tsx`: delete the floating button (lines 505–522) and drop the extra `+ 72` bottom padding (line 139). Header + (line 127) already hides when empty. Replace the hand-built empty block (line 159) with `EmptyStateCta compact`, button "Add loan".
- `app/personal/transactions.tsx`: remove the round header + (lines 334–350); the tab-bar FAB adds. The sparkles button stays. Empty state unchanged.
- `app/personal/recurring.tsx`: one header +; remove any floating add and the `+ 72` padding (line 84). Empty-state label: "Add recurring item" (drop the leading "+ " from `addRecurringItem`).
- `app/personal/budgets.tsx` (line 115) and `app/personal/upcoming.tsx` (line 147): already header-only. Use the same `IconButton` on both (Upcoming draws its own 40dp disc).

### Acceptance (1080×2400)

- Loans, Recurring, Budgets, Upcoming with items: exactly one +, top right; no floating button; the last card's actions are not covered.
- The same four screens when empty: one button, in the empty state; no + in the header.
- Transactions and Home: one floating +, bottom right above the tab bar; no + in the header.
- Transactions with a filter and no matches: "Clear filters" in the empty state and the floating + still there.
- No Personal screen shows two controls that open the same add form.
