# Waves design system

The calm system (November 2026): Waves should read like a mature finance app,
not a generated dashboard. A near-neutral grey canvas, flat white cards with
12pt corners and a hairline instead of a shadow, plain headers on the page
colour, one violet accent for every action, and money colours that mean money
only. No gradients, no photo headers, no capsule buttons, no decoration that
does not carry information. It replaced the original look (lavender canvas,
soft-shadowed cushion cards, pills and a brand gradient), which read as
generated.

Everything below is code, in `packages/ui/src/tokens.ts` and `theme.tsx` — this
file explains the _why_, the tokens are the source of truth. The working rules
for building a screen (principles, the five questions, which component to use)
are in [docs/design-standard.md](./docs/design-standard.md).

## Colour

| Role       | Light                                                                                                 | Notes                                           |
| ---------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Brand      | `#7A5AF8` (pressed `#6C4EE3`)                                                                         | CTAs, links, FAB, selected chips                |
| Brand soft | `#E9E4FF`                                                                                             | secondary buttons, operator keys, badges        |
| Canvas     | `#F4F4F6`                                                                                             | every screen background                         |
| Surface    | `#FFFFFF`                                                                                             | cards, sheets, list containers                  |
| Text       | `#14142B` / muted `#7B7B8F` / faint `#A8A9BA`                                                         | three levels, no more                           |
| Tints      | lilac `#DCD9FB` · pink `#F8D7DA` · mint `#DCE1FF` · peach `#FBE0C4` · sky `#CFE6FA` · coral `#FFC5C5` | each with a matching ink colour for text on top |

Dark mode keeps the same hues at lower luminance (`theme.tsx`), so a group's
colour identity survives the switch.

**No gradients.** `theme.gradient` and `Gradient` still exist so older callers
compile, but `Gradient` paints one solid colour and squares off capsule radii.
Identity comes from the accent, the money colours, tabular figures and a steady
rhythm, not from effects.

### The one rule that is not decorative

**Money colour is semantic and global.** Owed-to-you is always the
positive (periwinkle/blue) pair; you-owe is always the negative (pink/red) pair. Nothing else in
the app may use those two colours, because in a ledger app colour is data:
a user should be able to answer "am I up or down?" without reading a digit.

`MoneyText` enforces it — components pass an amount and a mode, never a colour.

It also renders the minor units fainter than the major ones (`₹1,517`**`.53`**),
in the amount's own colour rather than grey, so the fade works on the brand
panel, on green and on red alike. Where the split falls is the locale's
business, not ours: `formatParts` in `@waves/core` cuts the string at the
separator `Intl` actually used, because `de-DE` writes `1.517,53 €` and
searching for a `.` would take the wrong one.

## Type

One family, seven steps: `display 28 · title 22 · heading 17 · subheading 16 ·
body 15 · caption 13 · micro 11`. Body is regular weight; bold is for titles and
amounts. Screen titles are 20sp/700, section titles 17sp/700. Money always renders with tabular figures so
columns do not jitter as digits change, and money always carries a spoken label
("You are owed ₹420") rather than a bare number — TDR §11.

Dynamic type is respected up to 1.6×, capped so money rows stay legible instead
of clipping.

## Shape and depth

Radii: `sm 8 · md 10 · lg 12 · xl 12 · xxl 16 · pill 999`. Controls and chips
are `sm`, buttons `md`, cards `lg`, sheets `xxl`. `pill` is only for circles
(avatars, round icon buttons), never for a button with a word on it. A card is a
12pt rectangle, not a cushion.

One shadow: `lifted`, for things that float over content (menus, sheets,
toasts, the FAB). `soft` is kept as a name so callers compile, but draws
nothing. Cards and buttons sit flat; in light mode a card is separated from the
page by a hairline border. Not everything is a card: the page itself, type,
spacing and dividers do most of the grouping, and a card is for rows that belong
together.

Sub-screen headers are plain: a back chevron and the title on the page colour,
no photo, no tinted band (`ScenicHeader`, a historical name).

The doorway screens — the welcome and the lock screen — open with a brand-purple
panel whose bottom edge sweeps rather than cuts (`CurvedPanel`). It is the one
place the app is allowed a flourish, because it is the one place with nothing to
read: no balance, no list, no decision. Everywhere past it is somebody's money,
and a shape that draws the eye there is a shape competing with a number.

The arc is an over-wide box with a large bottom radius, not an SVG path — the
screen only ever sees the middle of a much wider circle. That keeps
`react-native-svg` out of the dependency list, which matters for a screen that
has to render before anything else in the app does.

The overhang has to scale with the radius, not with the screen. It did not once,
and the sign-in header shipped as a plain rectangle: the panel was short, so the
radius was small, so the whole arc sat off the sides of the screen and the flat
middle was all that showed. The arithmetic and its three caps now live in
`packages/ui/src/curve.ts`, on their own and tested, because nothing about that
failure looked like a failure.

## Meeting Waves for the first time

Three full-bleed pastel cards before the welcome — what you get for free, that
the people you split with need no account, and that settling hands the amount to
UPI. Swipeable, skippable from the first frame, shown once and never again.

It is emoji rather than illustration, at the same size art would be. Art means a
binary asset in every build, and these are the frames that render before the app
has proved anything about itself; the group covers are emoji for the same reason,
so the tour looks like the product rather than a brochure stapled to the front of
it.

## Lists somebody has to aim at

The contact picker is the one screen where the data is not ours and can be
enormous — a phone with nine hundred names in it. It borrows the shape of the
phone's own contacts app rather than inventing one: the count in the search
field, letter headings that stick as you scroll, and an index rail down the
right side. Nobody has to learn it, and a thousand rows stops being something
you scroll and becomes something you aim at.

The rail's letters come from the contacts rather than a hard-coded A–Z, so an
address book of Tamil or Devanagari names gets a rail that matches it instead of
filing everyone under `#`. When there are more letters than fit, it shows every
nth: a squashed complete alphabet is worse at aiming than a sparse one.

`@shopify/flash-list` does the recycling — sections are one flat array of
headings and people, with `getItemType` telling it the two are different shapes.
The rail is ours, forty lines, because every published React Native
alphabet-index component was abandoned years ago.

## Switching faces inside a page

A page with a few faces (Group / Just me, People | Attendance | Tasks) switches
between them with a segmented control: one grey track, the chosen segment on the
surface in full ink (`SegmentedPills`, or `SegmentedTabs` in `@waves/ui`). It is
not the bottom bar. The bar moves you between destinations; the segmented
control sits in the page and chooses which face of this page you see. The two
read as different things, which is the point.

## Choosing a language, and the restart it sometimes costs

The phone's language is the default and stays the default. A picker exists on
top of it because a phone is one setting for one person and the two do not
always agree: somebody in Chennai with an English phone still reads Tamil
faster, and a visitor's phone is in Arabic while their group is not.

Each language is listed in its own script first, with the English name under it.
Somebody who has opened the app in a language they cannot read is scanning for
the **shape** of their own writing, and "Tamil" spelled in Latin letters is not
that shape. The two words the picker is reached by — Language and Upgrade —
are the only settings labels that are translated, for the same reason: a row
labelled in the language you are trying to escape is no help at all.

Words change instantly. **Direction does not.** React Native decides
right-to-left natively, before any JavaScript runs, and `forceRTL` says so
itself — _changes take full effect on the next application start_. There is no
reload to call. So the screen says "close and open Waves again" in a banner that
stays until it is true, rather than half-mirroring a screen and calling it done.

The banner alone was not enough, twice over. A banner lives on one screen, and
somebody who taps a language and walks away never reads it — they come back to a
mirrored app in a language that is no longer Arabic and report it as broken. So
the words are also said in an alert, at the moment of the choice, in the
language just chosen, and only when the direction actually turns: going Arabic →
English → Arabic in one sitting ends where the app launched and has nothing left
to restart for. The sentence has **two directions** and they are not
interchangeable — telling somebody who has just chosen English that reopening
will "mirror it" describes the opposite of what will happen, on the one screen
they are reading to find out why it has not turned back.

Since `expo-updates` was added, the app can restart itself, so the alert
**offers** rather than instructs. It still asks: throwing somebody out of the
screen they are standing on is not a thing to do without permission, and the
banner keeps a Restart button for whoever says "not now" and changes their mind.
Builds that cannot do it — anything older than the binary that added the module,
and any reload the platform refuses — fall back to the sentence that was always
true. That check has to be `requireOptionalNativeModule('ExpoUpdates')` rather
than a `try`/`catch` around the import: `expo-updates` calls
`requireNativeModule` at its own module scope, and that throw reaches the global
error handler on the way past, so the red box appears even though the catch runs.

The choice is offered twice, and the second time is the important one. A
settings row is the right home for it once somebody is inside the app; it is the
wrong home for somebody standing at the front door who cannot read the door.
So the four scripts also sit flat on the sign-in screen, under the buttons —
four chips, endonyms only, no "follow my phone" among them, because following
the phone is what the app is already doing and a row of five where one is an
English sentence has stopped being scannable. In the settings list Language
leads rather than sits fifth, for the same reason: a row you can only reach by
reading past rows you cannot read is a row that is not there.

Two consequences worth stating, because both are the kind of thing that looks
like a bug when it is right:

- **The icons follow the screen, not the choice.** `setLayoutDirection` is given
  the direction the app actually launched in, so between choosing Arabic and
  restarting the arrows keep pointing the way the layout still runs. Mirroring
  them on the choice would put backwards chevrons on an unmirrored screen.
- **A choice changes the language, not the country.** The locale keeps the
  phone's region and swaps only the language subtag, so reading the app in Hindi
  in Dubai formats money and dates as `hi-AE`. Where somebody is decides what
  their currency and calendar look like; what they read does not.

## A door with no shop behind it

The Upgrade row leads to a screen that says there is nothing to buy, and says
what would ever cost money: scanning bills, which costs real money per scan, and
outsized exports. The ledger — groups, expenses, splits, balances, settling up,
and getting all of it back out — is free forever and is not on that list.

It sits in its own section above Settings rather than among them. Paying for
something is not a preference, and a row that sells you something between
Notifications and Export is a row dressed up as a setting.

## Spacing

4px base: `xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32`. Screens use
`xl` horizontal padding; scroll containers reserve room at the bottom
(`useTabBarClearance`) so the opaque bottom bar never covers the last row.

## Bottom navigation

The bar is flat and pinned to the bottom edge on **every** screen, WhatsApp
style — a top hairline, no float, no shadow. The selected destination is shown
by colour and weight alone: its icon and bold label take the brand colour, the
rest sit muted. No tinted pill behind it. The centre mic is a plain solid brand
circle, no glow.

It is rendered once at the root over the whole navigation stack (`AppTabBar`),
not inside the tabs navigator, so it stays put when a screen is pushed on top —
a group, a settings page, the inbox. The tabs navigator keeps the scene
switching but hides its own bar so there is never a second copy. The rules for
when it hides (the camera and the rise-from-bottom modals, the signed-out
screens) and which destination reads as current are pure and tested in
`lib/tabBar.ts` / `test/tabBar.test.ts`.

The destinations change with the space (Personal, a company, an employee) and
are defined in `AppTabBar`; `docs/design-standard.md` has the company bar.
Settings live behind the header's three-dot overflow menu (`OverflowMenu`), a
small rounded card that drops from the top-right over a tap-away scrim.

## Components

`Screen · Card · TintCard · SectionHeader · Divider · Row · Callout · CurvedPanel ·
Gradient · Text · Button · IconButton · Fab · Chip · ChipRow · Badge · Avatar ·
AvatarStack · ListRow · EmptyState · MoneyText · Skeleton · ProgressBar · Toggle ·
PillTabBar · SegmentedTabs · AmountField · AmountKeypad · Sheet · Popup ·
BarList · ColumnChart`

`packages/ui/src/index.ts` is the list; this one is written out because a
component that is not in it gets rebuilt locally, badly, on the next screen.

Four carry product decisions rather than styling:

- **`AmountKeypad`** — the calculator lives inside the amount field (TDR §9,
  the 955-vote fix). Splitting a bill means arithmetic; making people leave for
  another app to do it is the bug. All of its maths is integer minor units, and
  `÷` rounds exactly the way the split engine does.
- **`Avatar` (ghost variant)** — members who have not joined yet (ADR-006) get a
  dashed ring. A ghost holds real balances, so it must look present but
  provisional, never like an error.
- **`Sheet` and `Popup`** — every transient surface in the app is one of these
  two, and reaching for `Modal` with a hand-picked `animationType` is not an
  option any more. A sheet springs up from the bottom edge under a fading scrim;
  a popup fades in while scaling up from just under full size. Both are built on
  React Native's own `Animated` rather than Reanimated, because the design system
  carries no animation dependency and opacity, translate and scale on the native
  driver are exactly what `Animated` is good at. Each holds its surface mounted
  through the close so the exit actually plays — `Modal`'s own animation unmounts
  too soon for that. Reduced motion keeps the fade and drops the travel and the
  scale, read from `AccessibilityInfo` locally: the OS setting is a choice the
  reader has already made, and this app does not ask again.
- **`BarList` and `ColumnChart`** — the only two charts in the app, and both are
  plain views (TDR A8). No chart library ships in the binary: `victory-native`
  renders through Skia, which is a native module that can fail at launch, and
  the price of that is a list of bars. The operator console is a web page and
  draws with ECharts instead (A31) — that is not an inconsistency, it is the
  same rule reaching a different conclusion where the constraint is absent.

## Lists are recycled, always

Every list of rows a person can scroll is `@shopify/flash-list`, never a
`ScrollView` with a `.map()` inside it. The settings that go with it: a
`drawDistance` in the low thousands so a fast flick does not scroll into blank
space (1500 on most lists, 2500 on the group ledger, which has the tallest
rows), `extraData` carrying whatever a row reads besides its own item, and the
bottom clearance from `useTabBarClearance` on a tab screen or
`useScreenClearance` on a pushed one, so the last row never sits under the
navigation bar.

The rule is absolute rather than a judgement about length, because the list that
needs recycling is never the one being written: it is the same list two years
later with nine hundred expenses in it, and by then nobody remembers it was a
`.map()`. The one place a `ScrollView` is still right is a screen that is a
_form_ or a _page_ — a settings screen, an expense detail — where the content is
finite, heterogeneous, and known at build time.

The contact picker (above) is where this earns itself twice over: sections are
one flat array of headings and people, with `getItemType` telling the recycler
the two are different shapes.

## Where this list stops

The screens themselves are not enumerated here. There are far too many now —
[TDR §9](./waves-tdr.md) carries the list and says which amendment each arrived
under, so it is one place that stays current rather than two that disagree. What
belongs in this file is the vocabulary: the colours, the type ramp, the shapes,
the components, and the handful of rules above that a screen has to obey whatever
it is for.
