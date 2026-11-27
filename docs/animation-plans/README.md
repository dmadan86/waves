# Animation plans: Rentals and Personal

Written against commit `781ec67fe`. Read-only audit; nothing has been built. See [AUDIT.md](AUDIT.md) for the findings, the rejected list and the recon (installed libraries, house conventions).

Libraries: Reanimated 4.5.3 in the app (no new dependencies, OTA-safe). `packages/ui` uses core `Animated` only and none of these plans edit it. Every plan respects reduced motion through `useReducedMotion` from `@/lib/reducedMotion`.

| # | Title | Impact | Effort | Status |
| --- | --- | --- | --- | --- |
| [01](01-press-feedback-and-motion-tokens.md) | Motion tokens and press dip on cards, tiles, buttons | High (every tap feels alive) | Small | built |
| [02](02-rentals-list-entrance-and-first-run.md) | Rentals list arrival, bar fill, first-run empty state | High | Small to medium | built |
| [03](03-rental-detail-arrival.md) | Property detail opens from the card; art settles; 12-month strip ripples | High | Small | built |
| [04](04-rent-recorded-moment.md) | The "rent received" moment: collapse, crossfade, check pop, haptic | High (the memorable one) | Medium | built |
| [05](05-documents-slot-grid-motion.md) | Documents grid: tile arrival, thumbnail fade, busy dim | Medium | Medium | built |
| [06](06-wizard-step-motion.md) | Wizard steps: progress glide, slide-in question, tile selection | Medium | Medium | built |
| [07](07-sliding-pills-row-exit-dropdown.md) | Sliding tab pill, Mark-paid row exit, loans dropdown | Medium | Medium | built |
| [08](08-personal-add-button-presence.md) | Personal add button fades with the page that covers it | Medium to low | Small | built |

## Recommended order

1. **01 first.** It adds `EASE_OUT`, `EASE_IN_OUT`, `SPRING_SETTLE`, `SPRING_POP` and the `pressedScale` prop; every other plan reads them.
2. **02, then 03.** The two biggest "it has life now" changes, both using already-built components. Ship 01 to 03 as one set and let the owner feel it on a device before going further.
3. **04** (needs 02 for `popEntering`; apply after 03 because both edit `rentals/[id].tsx`).
4. **08** (independent, small), then **06**, **07**, **05** in any order.

## Dependencies

- 02, 03, 04, 05, 06, 07, 08 need plan 01's tokens.
- 04 needs plan 02 (`popEntering`) and should follow 03 (same file).
- 05 expects 01's `PressableScale` swap on the document tiles.
- 06 expects 01's `PressableScale` swap on `Pick` tiles.
- 03 and 04 both add `useReducedMotion` to `DetailBody`; the second one applied should reuse the existing line.

## Not planned (on purpose)

See "Rejected" in AUDIT.md: no counting-up money, no animation on frequent filter changes, no replay of entrances on refetch, no change to the Personal bar mode transition. A possible later plan 09 (press scale inside the shared `Button` and `Chip` in `packages/ui`, using core `Animated`) is described as L3 in the audit; it changes every button in the app, so it needs its own decision.

## How to run a plan

Each plan is self-contained for an agent with no context. After each: `pnpm typecheck && pnpm lint && pnpm test` in `apps/mobile` from the main checkout (not a worktree with symlinked `node_modules`), then install a preview build and do the feel check on a real phone, once with Reduce Motion off and once on. Per the release rule, ship nothing to production (OTA, store, `app_releases`) until the owner is happy.
