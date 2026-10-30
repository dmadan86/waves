# Design standard

One design for every screen. The Spending screen is the reference. Every new or
touched screen uses these components (`apps/mobile/src/components/standard`);
do not draw your own header, card, pill or row.

## Components

| Component        | Use it for                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScenicHeader`   | The top of a screen: a short photo band (about 20% of the screen height) with back chevron, centred 22sp bold title and an optional pill row as children.                                                                                                  |
| `ScenicBody`     | The content under a `ScenicHeader`: rides up 36dp over the photo, 16dp side gutters, 20dp between sections. In a list, put the header in `ListHeaderComponent` and give items the same gutters.                                                            |
| `SegmentedPills` | Choose one of a few (Group / Just me): navy `#1F1B4D` with white text when selected, translucent white otherwise.                                                                                                                                          |
| `PillButton`     | A white pill that opens a picker (month, currency).                                                                                                                                                                                                        |
| `SectionHeader`  | A 20sp bold section title. Optional `action` ("See all ›") or `trailing` (a dropdown pill, a day total).                                                                                                                                                   |
| `StandardCard`   | Any grouped content: white, 24dp radius, soft shadow, 16dp padding.                                                                                                                                                                                        |
| `StatCard`       | The screen's headline number: muted 15sp label with glyph, 34sp bold amount with grey minor units, a caption, an optional change pill and sparkline.                                                                                                       |
| `ListRow`        | A line in a card: tinted icon circle, regular-weight title, muted subtitle, semibold amount on the right, optional muted % or chevron. Also `trailing` (a toggle or menu button), `highlight`, `destructive`, `titleAccessory` (an ⓘ) and `subtitleLines`. |

## Tokens

- Spacing: `theme.spacing` (4px scale); gutters 16, sections 20, rows 12.
- Type: headings 20sp/800, card labels 15sp muted, body regular, amounts 600, hints `micro`/`caption` muted.
- Colour: theme tokens only. Selected pill `#1F1B4D`; accent links `brand`; category colours from the rank palette (`RANK_COLORS`) in charts.
- Money: never convert between currencies and never re-divide an expense; use the `@waves/core` helpers.

## Rules

- An action is drawn only when it does something. Pass `undefined` for `SectionHeader.action` when there is nothing to open; no inert "See all", no empty chevron.
- Rows get `onPress` only when they go somewhere.
- Dark mode comes from the theme; the header darkens the photo with a scrim.
- New or changed screens use these components. If one is missing a variant, extend the component, not the screen.
- People always render through PersonAvatar (photo, else initials). The bare `Avatar` from `@waves/ui` is for non-people (a group mark); `apps/mobile/test/personAvatarGuard.test.ts` enforces it.
- All action buttons use the brand violet; no black buttons.
- Every ⋮ (more) button opens `OverflowMenu`, the pop-up card anchored at the top corner, as on Home, the group screen and an expense. Never a bottom `Sheet` for a ⋮ menu. A bottom sheet is for a picker or form (switch company, add someone).
- Company mode: owner/manager inside a company get the company bar (Home · Overview · People · Team · Payments · More) with an add FAB, no mic; Team opens one screen with Attendance | Daily Work pill tabs (remembers the last); Pending is a card at the top of Overview ("View all" opens company-pending) and Overview carries the pending-count badge; employees keep the shared bar.
