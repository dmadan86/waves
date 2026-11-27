# Animation audit: Rentals and Personal (commit 781ec67fe)

Scope: `apps/mobile/src/app/rentals/*`, `components/wealth/*`, `app/personal/{upcoming,setup,loans,recurring,transactions}`, `components/personal/*`, `app/investments/*`, the Personal bar and add button in `components/AppTabBar.tsx`, and the `packages/ui` pieces they use (Sheet, Button, Card, Chip).

Method: the three motion skills (find-animation-opportunities, improve-animations, apple-design), applied to React Native. Read only. No source was changed.

## 1. Recon

| Fact | Value |
| --- | --- |
| Stack | Expo 57, React Native 0.86, `react-native-reanimated` 4.5.3, `react-native-worklets` 0.10.1, `react-native-gesture-handler` 2.32 |
| Not installed | `moti`, Skia, Lottie. `LayoutAnimation` is not used anywhere. Plans must not add any of these. |
| Where Reanimated is used | `src/lib/anim.tsx`, `AppTabBar.tsx`, `SwipeRow.tsx`, `ScreenHero`, `OverflowMenu`, voice and onboarding screens |
| Where core `Animated` is used | `packages/ui` (Overlay/Sheet, ProgressBar, PillTabBar, Toast, Skeleton) and `GroupRow`. The UI package deliberately carries no Reanimated dependency (`Overlay.tsx:12`). **Plans touching `packages/ui` must use core `Animated` with `useNativeDriver: true`.** |
| House motion kit | `src/lib/anim.tsx`: `Stagger` (FadeInDown 340ms, 55ms step, capped at 8 rows), `PressableScale` (spring 0.96, `damping 18 / stiffness 280 / mass 0.5`), `DetailEnter` (scale 0.97 to 1 plus fade), `useCrossfade`. Math in `src/lib/motionMath.ts`. |
| Reduced motion | `useReducedMotion()` from `@/lib/reducedMotion` (reads `AccessibilityInfo`, app-wide provider, defaults to `true` until the OS answers). `packages/ui` has its own copy in `Overlay.tsx:98-120`. Every plan uses the first in the app and leaves the second alone. |
| Curve tokens | None for easing. Only `TRANSITION_MS = 260` (`anim.tsx:67`). Plan 01 adds `EASE_OUT`, `EASE_IN_OUT`, `SPRING_SETTLE`, `SPRING_POP` to `anim.tsx`. |
| Haptics | `expo-haptics` is installed; `lib/assistantHaptics.ts` is the one wrapper. |
| Personality | Friendly consumer money app ("WhatsApp for finance"). Calm, not bouncy. Bounce is only for the one moment that deserves it: money arriving. |

### The main finding

**Every screen in scope has zero motion of its own.** A grep for `Animated`, `reanimated`, `entering`, `exiting`, `Layout`, `useReducedMotion` and `LayoutAnimation` across `app/rentals`, `components/wealth`, `components/personal`, `app/personal/{upcoming,setup,loans,recurring,transactions}` and `app/investments` returns nothing. The kit that would give these screens life (`Stagger`, `DetailEnter`) exists and is not used anywhere in `src` (no `<Stagger` or `<DetailEnter` JSX). `PressableScale` is used on only 3 hero surfaces. That is why the rental UI feels "very plain, no life": it is not badly animated, it is not animated.

Frequency map used for severity:

| Surface | Frequency | Motion budget |
| --- | --- | --- |
| Rentals list, rental detail | Occasional (a few times a week) | Standard entrance, press feedback, one delight moment |
| Record rent / "yes received" | Rare and emotional (monthly) | Delight allowed |
| Add property / tenant wizard | Rare / first-time | Delight allowed |
| Personal tab bar, tab switches (Upcoming, Transactions) | Tens per day | Near-imperceptible only |
| Personal quick tiles, list rows | Tens per day | Press feedback only, no entrance replay |

## 2. Findings (prioritized)

Severity: HIGH = most of why the screens feel flat; MEDIUM = noticeable gap; LOW = polish.

### HIGH

| # | Category | Location | What is wrong or missing | Exact proposed motion | Plan |
| --- | --- | --- | --- | --- | --- |
| H1 | Missed opportunity / feedback | `rentals/index.tsx:222` (property card), `rentals/[id].tsx:88` (`TintButton`), `RentalExtras.tsx:446,494` (doc tiles), `PersonalHomeParts.tsx:260,320` (quick tiles), `parts.tsx:200` (`Pick` tiles), `GroupRow.tsx:117` | Cards and tiles give no press feedback, or a bare opacity blink (`opacity: pressed ? 0.7`). A 100px-wide card that does not react under the thumb reads as dead. | Reuse `PressableScale`. Scale to 0.98 for big cards, 0.96 for tiles and buttons. Spring `damping 18, stiffness 280, mass 0.5` (existing `PRESS_SPRING`). Property: `transform: scale`. Trigger: `onPressIn` / `onPressOut`. | 01 |
| H2 | Missed opportunity / teleporting content | `rentals/index.tsx:177-298` | The month summary and every property card blink on at once when the screen opens. `Stagger` exists for exactly this and is unused. | Wrap in `Stagger`: `FadeInDown`, 260ms, `EASE_OUT` (`cubic-bezier(0.23,1,0.32,1)`), `translateY` from 12px, `opacity` 0 to 1, delay `index * 55` ms (capped at 8, existing `staggerDelay`). Plays once at mount only. | 02 |
| H3 | Missed opportunity / state indication | `rentals/index.tsx:186-200` | The "collected this month" bar is drawn already filled (`width: ${percent}%`). It is the one number that says "your rent is coming in" and it does not move. | On mount fill from 0 to `percent` over 600ms, `EASE_OUT`, 120ms delay after the card arrives. Re-animate (retarget, same spring-free timing) whenever `percent` changes. Reduced motion: set instantly. | 02 |
| H4 | Missed opportunity / rare moment | `rentals/index.tsx:102-147` (empty state) | First-run empty state is a static icon pair, which is the biggest delight budget in the flow ("Add your first property"). | House icon rises in (`translateY` 12 to 0, `opacity` 0 to 1, `SPRING_SETTLE`), then the key pops (`scale` 0.6 to 1, `SPRING_POP`, 160ms later), then the title, subtitle and button fade up with 60ms steps. Plays once. | 02 |
| H5 | Missed opportunity / spatial | `rentals/[id].tsx:311-414` | Opening a property is a hard cut onto a screen where the hero card, art and every section appear fully formed. `DetailEnter` was built for this. | Wrap the body in `DetailEnter`. Hero `PropertyArt` settles (`translateY` 8 to 0, `opacity` 0 to 1, `SPRING_SETTLE`, 80ms after the card). 12-month strip cells ripple in left to right, 30ms apart. | 03 |
| H6 | Missed opportunity / the delight moment | `rentals/[id].tsx:418-460` (confirm card), `:344-346` (hero amount), `:538-551` (strip cell) | "Yes, received" is the product's best moment (money arrived) and it is silent: the card vanishes, the hero number swaps, a check appears, all in one frame, with the layout jumping up. | Card exits (`FadeOut` 160ms) while siblings glide up (`LinearTransition` spring `SPRING_SETTLE`). Hero amount crossfades 180ms (`useCrossfade`). Current month check pops (`scale` 0.5 to 1, `SPRING_POP`). One `notificationAsync(Success)` haptic. Reduced motion: opacity swaps only, no pop or glide. | 04 |

### MEDIUM

| # | Category | Location | What is wrong or missing | Exact proposed motion | Plan |
| --- | --- | --- | --- | --- | --- |
| M1 | Teleporting state | `RentalExtras.tsx:446-470` (empty tile), `:494-561` (filled tile), `:516` (`Image`) | Adding a document swaps a dashed empty tile for a filled one in one frame; the thumbnail pops in when decoded; `busy` (`:451`) gives no visual at all, so a slow photo pick looks frozen. | Filled tile fades and scales in (`opacity` 0 to 1, `scale` 0.96 to 1, `SPRING_SETTLE`). Thumbnail `expo-image` `transition={180}`. `busy` tile eases to `opacity` 0.6 in 120ms. Removed tile `FadeOut` 150ms. | 05 |
| M2 | Missed opportunity / spatial | `parts.tsx:119-124` (progress), `TenantFlow.tsx:59-80` (step switch), `parts.tsx:200-244` (`Pick`) | Next question appears instantly, the progress bar jumps a step, and a picked tile flips colour and border in one frame. Owner's rule is "nothing jumps between steps". | Progress width animates 260ms `EASE_IN_OUT` (`cubic-bezier(0.77,0,0.175,1)`). Step content enters from the reading direction: `translateX` 16 to 0, `opacity` 0 to 1, 220ms `EASE_OUT`; no exit animation (it would delay the next question). Picked tile: background and border colour ease 150ms, icon bubble pops `scale` 0.9 to 1 with `SPRING_POP`. | 06 |
| M3 | Missed opportunity / state indication | `upcoming.tsx:188-216`, `transactions.tsx:406-455` | The selected pill moves by swapping a background colour. The eye gets no "this became that". | One highlight view slides under the labels: `translateX` with `SPRING_SETTLE` (no bounce, these are tens per day). Text colour eases 120ms. | 07 |
| M4 | Preventing a jarring change | `upcoming.tsx:306-310` ("Mark paid") | The row disappears and the rows below jump up with no bridge. | Row `exiting`: `FadeOut` 160ms; siblings `LinearTransition` with `SPRING_SETTLE`. Never on filter-tab changes (see Rejected). | 07 |
| M5 | Origin / physicality | `loans.tsx:949-975` (names dropdown), `:945` (chevron) | The dropdown pops in; the chevron swaps glyph (`chevron-up` / `chevron-down`) instead of turning. | Dropdown: `opacity` 0 to 1, `scale` 0.97 to 1, `transformOrigin: 'top'`, 160ms `EASE_OUT` (origin at its trigger). Chevron: single `chevron-down` icon with `rotate` 0 to 180deg, 180ms `EASE_OUT`. | 07 |
| M6 | Missed opportunity / spatial | `AppTabBar.tsx:813` | `personalShowsAddFab(segments)` hides the round + the instant you push `/rentals` or `/investments` (see `personalLayoutRules.ts:18-26`), while the screen itself is still sliding in. The button vanishes before the page covers it. | Keep `CenterButton` mounted and animate presence: `opacity` and `scale` 0.6 to 1 (`SPRING_SETTLE`), `pointerEvents` and accessibility hidden when out. Exit 120ms `EASE_OUT`. | 08 |

### LOW

| # | Category | Location | Finding | Proposed fix | Plan |
| --- | --- | --- | --- | --- | --- |
| L1 | Easing | `anim.tsx:90` (`Stagger`) | `FadeInDown.duration(340)` has no explicit easing, so Reanimated falls back to its default ease-in-out; entrances should be ease-out. 340ms is also at the top of the budget. | 260ms plus `.easing(EASE_OUT)`. Fixed inside plan 01 (affects its three existing callers: none today). | 01 |
| L2 | Cohesion | `AppTabBar.tsx:230` | Bar mode switch uses `Easing.linear` over 280ms. Linear is fine for a plain opacity dissolve, but `ModeItem` derives per-icon staggers from it (`interpolate(p.value, [(index*30)/280, ...])`). | **Leave as is.** Changing the base curve would re-time every icon's stagger. Noted so nobody "fixes" it. | none |
| L3 | Cohesion | `Button.tsx:83-120`, `Chip.tsx:49-61` | Shared `Button` has colour change only; `Chip` uses `opacity: 0.85`. App-wide, so higher blast radius than this brief. | Core `Animated` press scale 0.97 over 120ms like `PillTabBar` `TabItem` (`PillTabBar.tsx:453-466`). Candidate follow-up (plan 09), not written: it changes every button in the app. | none |
| L4 | Accessibility | `anim.tsx:4-5` header comment says "animations always play, there is no preference gating"; the code below it does gate on `useReducedMotion`. | Comment is wrong. | One-line comment fix inside plan 01. | 01 |
| L5 | Accessibility | `reducedMotion.ts` `useState(true)` | The preference defaults to "reduce" until the OS answers, so anything mounted in the first frames skips its entrance. The provider sits at app root, so screens in scope mount after it resolves. | No change; keep in mind when feel-checking a cold start straight onto Rentals. | none |

## 3. Rejected (should NOT animate)

| Where | Why not |
| --- | --- |
| Amounts, balances, "rent due" figures (`rentals/[id].tsx:345`, `index.tsx:86`, `AmountField`) counting up or rolling | Functional data the person reads and acts on; money that moves for style erodes trust. Gate 4 (function). The only number motion allowed is the one-off crossfade in plan 04 after a real payment. |
| Filter tab content on Upcoming/Transactions (list re-filtering) | Tens per day; a list reflow animation on every tap makes a frequent control slow. Only the pill highlight moves (plan 07). |
| Personal tab bar items and bar mode swap (`AppTabBar.tsx:150-170,230`) | Core navigation, hundreds of taps a day, and already animated more than enough. |
| `Stagger` replay on every focus, refetch or tab switch | Entrances play once at mount (`anim.tsx` doc comment says the same). Replaying on a data refresh is decoration on frequent surfaces. |
| Transactions list rows (`transactions.tsx`) and Recurring rules list (`recurring.tsx:198`) entering | Long, scrolled, information-dense lists seen daily. Gate 1 and 4. |
| Skeleton to content in `OverflowMenu` and `Sheet` content | Sheet already springs in (`Overlay.tsx`); adding inner motion on top is double motion. |
| `Sheet` internals (`Overlay.tsx`): tension 70 / friction 12 open spring | Already correct: spring open, 200ms exit, velocity-based drag close (`DRAG_CLOSE_VELOCITY 0.8`), reduced motion keeps the fade. No finding. |
| Delete-confirmation dialog on rental delete | Destructive and rare; plain is correct. |
| Loan/People screens' long forms (`loans.tsx` sheets) | Not Rentals/Personal-visible hot spots; sheets already animate. Revisit only if asked. |
| Bounce on any Personal-home control | Tens per day. Bounce (damping ratio under 1) is reserved for plan 04 and wizard picks (rare). |

## 4. Verdict

The motion here does not need to be louder, it needs to exist: five small, consistent behaviours (press dip, one entrance per screen, a progress fill, a payment-recorded beat, a sliding pill) will change the feel more than any bespoke animation. The single highest-leverage change is plan 01 plus 02 together, because they use components that are already built and reviewed. Plan 04 is the memorable one. Feel cannot be fully judged from code, so every plan has an on-device feel check.
