# Design standard

One design for every screen. The Spending screen is the reference. Every new or
touched screen uses these components (`apps/mobile/src/components/standard`);
do not draw your own header, card, pill or row.

## Principles

Waves should read like a mature finance app, not a generated dashboard.

- Usability before decoration. Every element earns its space; if it can be removed or merged, it goes.
- Compact and calm: tight rows, clear alignment, hairline dividers, one accent colour. Calm is not empty: keep the information people need.
- No gradients, no soft shadows on cards, no capsule-shaped buttons, no decorative illustrations or photo headers. Shadows only on things that float (menus, sheets, toasts).
- Not everything is a white card. Use the page itself, typography, spacing and dividers; a card groups rows that belong together.
- Familiar patterns (back chevron, segmented control, list rows, ⋮ menu) so a first-time user needs no instructions.
- Mobile first, down to small Androids (360dp wide): no fixed photo bands, nothing that only fits a large phone.
- Identity comes from the violet accent, the money colours, tabular figures and consistent rhythm, not from effects.

Before building or changing a screen, answer: what must the user understand at a glance; what is the one main action; what can be removed or merged; can it take fewer taps; would a first-time user get it unaided?

## Components

| Component        | Use it for                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScenicHeader`   | The top of a sub-screen: a compact bar on the page colour with a back chevron, the 20sp title set against it, one optional action at the far end, an optional subtitle and an optional row of controls under it. No photo. (Historical name.) |
| `ScenicBody`     | The content under the header: 16dp side gutters, 16dp between sections.                                                                                                                                                                       |
| `SegmentedPills` | Choose one of a few (Group / Just me): one grey track, the chosen segment on the surface in full ink.                                                                                                                                         |
| `PillButton`     | A small outlined 8pt-corner button that opens a picker (month, currency).                                                                                                                                                                     |
| `SectionHeader`  | A 17sp bold section title. Optional `action` ("See all ›") or `trailing`.                                                                                                                                                                     |
| `StandardCard`   | Rows that belong together: flat surface, 12pt corners, hairline border, no shadow, 14dp padding.                                                                                                                                              |
| `StatCard`       | The screen's headline number, set on the page (no card): muted caption label, 30sp amount with grey minor units, change as plain text ("↑ 12%"), optional sparkline.                                                                          |
| `ListRow`        | A line in a list: optional leading glyph, regular-weight title, muted subtitle, semibold amount on the right, optional % or chevron. Separate rows with `divider`.                                                                            |

## Tokens

- Spacing: `theme.spacing` (4px scale); gutters 16, sections 16, rows 12.
- Radius: 8 for controls and chips, 10 for buttons, 12 for cards, 16 for sheets. `pill` only for circles (avatars, round icon buttons).
- Type: screen titles 20sp/700, section titles 17sp/700, body 15sp regular, amounts semibold and tabular, hints `caption`/`micro` muted.
- Colour: theme tokens only. Canvas is a near-neutral grey, surfaces white, one violet accent (`brand`) for actions and links; the money colours mean money only.
- Shadow: none on cards and buttons; `shadow.lifted` only for floating layers.
- Money: never convert between currencies and never re-divide an expense; use the `@waves/core` helpers.

## Forms and cards (Create group is the reference)

- Group label (Group name, Add friends, Group type, More options): `SectionLabel` only: a muted 18dp glyph, title 15sp/700 in full ink, 8dp gap. No disc.
- Sub-captions inside a group ("Suggested", "See all") are 13sp/600: muted, or `brand` for a link. Field text is 16sp; placeholders `textFaint`.
- Option rows (`DetailRow`) in a form card are always `tint={{ bg: brandSoft, ink: brand }}` and `dense`: the same 28dp disc, bold title, value on the right. No row without a disc.
- Cards: `FormCard` 12dp radius, 14dp padding, `spacing.sm` (8dp) between cards. Selected tile/chip: `brandSoft` fill with a `brand` outline.
- When you add a section to a form, use these; do not size a label or an icon by hand.

## Rules

- An action is drawn only when it does something. Pass `undefined` for `SectionHeader.action` when there is nothing to open; no inert "See all", no empty chevron.
- Rows get `onPress` only when they go somewhere.
- Dark mode comes from the theme.
- New or changed screens use these components. If one is missing a variant, extend the component, not the screen.
- People always render through PersonAvatar (photo, else initials). The bare `Avatar` from `@waves/ui` is for non-people (a group mark); `apps/mobile/test/personAvatarGuard.test.ts` enforces it.
- All action buttons use the brand violet; no black buttons.
- Every ⋮ (more) button opens `OverflowMenu`, the pop-up card anchored at the top corner, as on Home, the group screen and an expense. Never a bottom `Sheet` for a ⋮ menu. A bottom sheet is for a picker or form (switch company, add someone).
- Company mode: owner/manager inside a company get the company bar (Home (company overview) · Team · Payments · Vendors · More (Vendors is its own tab, not a More row); the bar is full at five, so Clients, Follow-ups and Complaints live in More, which is a menu of tiles in four groups: Money in, Money out, Team, Books; leave the company via the space switcher) with an add FAB, no mic; Team opens one screen with the company header (SpacePill) and a white People | Attendance | Tasks segment under it (remembers the last per company; red dot on Tasks while a task is blocked); People lists employees by name, with a sort pop-up of two switches (Sort by name, Show admins) and Not employed in the header menu, and the old people / attendance / work routes open Team on that segment (none of the three views draws its own header); Pending is a card at the top of Overview ("View all" opens company-pending) and Home carries the pending-count badge; employees keep the shared bar.
- Bottom-bar tab roots (Personal and Company) use the one tab header (company: `DashHeader` with `tab`, i.e. the Team header: SpacePill, round gear / ⋯ / action buttons, no subtitle); never a back button. Sub-screens use the back header (`ScenicHeader`).
- Customizable layouts: a screen of cards (the company Overview) may let people reorder and hide cards, never restyle them. Entry is the ⋮ OverflowMenu › "Edit layout", or a long press on the cards. Edit mode is one list: a − to hide, a ≡ handle to drag, a Hidden cards list with + to bring back, Reset to default and Done; the first card is locked (shown with a lock). Haptics only on pick-up and drop; every row has move up / move down / hide accessibility actions. The layout is a pure model (`lib/overviewLayout.ts`: per-role default merged with the saved one), saved per account and company on the phone and mirrored to `profiles.ui_prefs`.
- Spaces: Personal and each company are separate spaces, switched from the pill at the top left ("Personal" / the company name, with a chevron) which opens one "Switch space" sheet (`SpacePill` in `components/SpaceSwitcher.tsx`). Personal Home lists every group type except company; a company never shows groups. The last explicit switch (sheet, create, accept invite) is remembered per account and the app opens there; a company that is gone or left falls back to Personal. The Company tab opens the last company. Users with no company see a plain "Personal" label, no chevron.
