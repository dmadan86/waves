/**
 * One hero, not four.
 *
 * The gradient panel that a group opens with — running up under the status bar,
 * carrying the name of the thing, one number that is the point of the screen,
 * and the actions that number invites — is now also what Review and Bank
 * messages open with. It is a *shared shell* (`components/ScreenHero`), and the
 * only way it stays shared is if nobody quietly hand-rolls a fifth copy the
 * next time a screen wants one: four `Gradient` panels with four sets of
 * padding drift within a release, and then the app has four ideas about how
 * tall a header is.
 *
 * Source-reading, like `captureGroupHandoff.test.ts` and `captureFactsCard`:
 * these screens pull in Reanimated and gesture-handler by way of their sheets,
 * which this node-environment suite cannot mount, but "which component draws
 * the header" is legible in the text without any of that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const source = (relativePath: string): string => readFileSync(join(SRC, relativePath), 'utf8');

describe('every hero is the same hero', () => {
  for (const [name, path] of [
    ['Review', 'app/(tabs)/captures.tsx'],
    ['Bank messages', 'app/captures/sms/index.tsx'],
  ] as const) {
    it(`${name} opens on the shared panel, not a panel of its own`, () => {
      const screen = source(path);
      expect(screen).toMatch(/import \{[^}]*ScreenHero[^}]*\} from '@\/components\/ScreenHero';/);
      expect(screen).toMatch(/<ScreenHero\b/);
      // A `Gradient` of its own would be the beginning of a second hero. The
      // shell owns the wash, the inset and the rounded bottom; a screen that
      // needs a different one passes stops, it does not draw its own panel.
      expect(screen).not.toMatch(/<Gradient\b/);
    });

    it(`${name} lets the panel run under the status bar`, () => {
      // `edges={['top']}` would inset the screen and leave a band of body
      // colour above the gradient — the bug that makes a hero look pasted on.
      expect(source(path)).toMatch(/<Screen edges=\{\[\]\}>/);
    });

    it(`${name} takes the status bar for as long as it is in front`, () => {
      const screen = source(path);
      // Running under the status bar means owning it: the root layout sets dark
      // glyphs under the light theme, which is unreadable on the wash.
      expect(screen).toMatch(/useHeroStatusBar\(\);/);
      // And it must be the focus-scoped hook, not a status bar mounted into the
      // tree — a tab screen stays mounted after you leave it, so that spelling
      // holds the bar light over the next white screen you walk to. Checked by
      // the import rather than by the element, so the prose in these files can
      // go on naming the thing it is explaining.
      expect(screen).not.toMatch(/from 'expo-status-bar'/);
    });
  }

  it('the group hero uses the shared controls rather than its own copies', () => {
    const hero = source('components/GroupHero.tsx');
    expect(hero).toMatch(
      /import \{ HeroActionCircle, HeroPillButton \} from '@\/components\/ScreenHero';/,
    );
    // The white pill and the dim disc were defined here and are now shared. A
    // local `function HeroActionCircle` reappearing means somebody has forked
    // them back apart.
    expect(hero).not.toMatch(/function Hero(ActionCircle|PillButton)\b/);
  });
});

describe("Review's list cells reserve their own spacing", () => {
  // FlashList measures a cell without its outer margins. A `marginTop` on the
  // root of a cell is therefore height the list does not know about, and it
  // draws the next cell over the top of it — which is what clipped the "READY
  // 134" heading in half, under the band above it. Padding is inside the
  // measured box and cannot do this.
  //
  // Cheap to state, and the trap is invisible in review: the code looks right,
  // and the bug only appears on a device with enough rows to scroll.
  const captures = source('app/(tabs)/captures.tsx');

  it('spaces every rendered item with padding, never margin', () => {
    const render = captures.match(/const renderItem = useCallback\([\s\S]*?\n {4}\[/);
    expect(render, 'captures should define renderItem').not.toBeNull();
    expect(render![0]).not.toMatch(/\bmargin[A-Za-z]*:/);
  });

  it('spaces the day heading with padding too', () => {
    const heading = captures.match(/case 'day':[\s\S]*?case 'batch':/);
    expect(heading, 'captures should render a day heading').not.toBeNull();
    expect(heading![0]).not.toMatch(/margin[A-Za-z]*:/);
    expect(heading![0]).toMatch(/paddingTop:/);
  });
});

describe('Review is ticked, not swiped', () => {
  const captures = source('app/(tabs)/captures.tsx');

  it('ticks by tab, with no mode to switch on first', () => {
    // The SMS pile runs a hundred deep on a phone whose messages the app reads,
    // and is answered in handfuls; the drafts somebody added themselves are a
    // handful to begin with and each wants its own destination. So the tick
    // boxes belong to one tab, derived from which tab is open — never a mode
    // somebody has to find, and never a mode they can get stuck in.
    expect(captures).toMatch(/const ticking = activeTab === 'found';/);
    expect(captures).not.toMatch(/setSelecting\(/);
  });

  it('gives the action bar the bottom of the phone to itself', () => {
    // The bar is an in-tree view and the navigation is drawn at the root over
    // the whole stack, so without this they stack up and the raised mic lands
    // on the button somebody is reaching for.
    expect(captures).toMatch(/useTabBarStandDown\(bottomBarStandsDown\)/);
    expect(captures).toMatch(/const bottomBarStandsDown = ticking && chosenRows\.length > 0;/);
  });

  it('gives it back on the way out, because a tab never unmounts', () => {
    // Held in a bare effect keyed on the selection, the claim outlived the
    // screen: this is a tab, leaving it does not unmount it, and pressing back
    // with two drafts ticked landed on the dashboard with the navigation gone
    // from every screen in the app. `useTabBarStandDown` ties the claim to
    // focus; going around it and calling the counter directly brings the bug
    // back, so the direct call is what this forbids.
    expect(captures).not.toMatch(/suppressTabBar\(\)/);
  });

  /**
   * The other half of the same disappearance, found on a device after the claim
   * was fixed: the navigation came back, and the *action bar* went instead.
   *
   * It was mounted when something was ticked and animated with `entering` /
   * `exiting`. A layout animation is driven by mount and unmount, and this
   * screen is a tab whose rendering the navigator freezes while it is blurred
   * (`(tabs)/_layout.tsx`). Going out to the voice screen and straight back ran
   * the exit and never brought the bar back: the ticks were still there, "2
   * selected" was still there, and the only way to reach "Just me" or "Add to a
   * group" again was to clear the selection and tick the rows a second time.
   *
   * So the bar is mounted for as long as the ticking tab is open and shown by
   * animating a shared value — the same crossfade the panel above it uses, and
   * the reason that one survived the same trip. Pinned here because the code
   * reads fine either way and the difference only shows on a device.
   */
  it('shows the action bar with a value, never with a layout animation', () => {
    expect(captures).not.toMatch(/entering=|exiting=/);
    expect(captures).not.toMatch(/SlideInDown|SlideOutDown/);
    // Mounted on the tab, not on the selection, and kept out of the way of the
    // list by `pointerEvents` rather than by being absent.
    expect(captures).toMatch(/\{ticking \? \(/);
    expect(captures).toMatch(/pointerEvents=\{selecting \? 'auto' : 'none'\}/);
    expect(captures).toMatch(/const actionBarAnim = useAnimatedStyle\(/);
  });

  it('has no swipe left to disagree with the tick', () => {
    // A drag that both ticks a row and files it somewhere is two answers to one
    // gesture, and the one it wins is whichever way the finger moved further.
    // Both of the swipe's answers survive as plain rows in the overflow sheet,
    // and "not an expense" also answers a whole ticked pile at once.
    expect(captures).not.toMatch(/<SwipeRow\b/);
    expect(captures).not.toMatch(/from '@\/components\/SwipeRow'/);
  });

  it('keeps "not an expense" reachable without the swipe', () => {
    expect(captures).toMatch(/t\.captures\.notAnExpense/);
    expect(captures).toMatch(/void dismissMany\(items\)/);
  });
});

describe('review can answer "not an expense" about a whole pile', () => {
  const captures = source('app/(tabs)/captures.tsx');

  it('has a bulk dismissal wired to the selection bar', () => {
    expect(captures).toMatch(/const dismissMany = useCallback\(/);
    expect(captures).toMatch(/void dismissMany\(items\)/);
  });

  it('asks once, and only when a person made one of the drafts', () => {
    // The same rule the single-row `dismiss` follows, applied to the pile: a
    // draft the app found costs nothing to drop (the message is still in the
    // phone's own Messages app), and a dialog in front of a loss-free action is
    // a dialog people learn to dismiss unread. The moment one draft carries
    // somebody's own words or a photograph of a bill, the confirm comes back —
    // once, for the lot.
    const body = captures.match(/const dismissMany = useCallback\([\s\S]*?\n {4}\[/);
    expect(body, 'captures should define dismissMany').not.toBeNull();
    expect(body![0]).toMatch(/const allFound = items\.every\(wasFound\)/);
    expect(body![0]).toMatch(/if \(!allFound\) \{[\s\S]*?await confirm\(\{/);
  });

  it('keeps the ticks when the confirm is answered "no"', () => {
    // The selection used to be cleared by the button, before the dialog had
    // even been drawn — so cancelling still cost a person every tick they had
    // made and left them to make them again. It is cleared inside, past the
    // point of no return, which is also past `guard.blockWrite()`.
    const body = captures.match(/const dismissMany = useCallback\([\s\S]*?\n {4}\[/);
    expect(body, 'captures should define dismissMany').not.toBeNull();
    expect(body![0]).toMatch(/if \(!ok\) return;[\s\S]*?setSelected\(new Set\(\)\);/);

    const bulkButton = captures.match(
      /label=\{chosenRows\.every\(wasFound\)[\s\S]*?void dismissMany\(items\);[\s\S]*?\}\}/,
    );
    expect(bulkButton, 'captures should define the bulk dismissal button').not.toBeNull();
    expect(bulkButton![0]).not.toMatch(/setSelected\(new Set\(\)\)/);
  });

  it('lets one refusal fail alone, and keeps its reason', () => {
    // Every other batch on this screen works this way: a draft the queue
    // refuses stays on the list rather than vanishing into a success message
    // that would be a lie.
    //
    // And the reason is kept. A bare `catch {}` counts the refusal and discards
    // the only thing that could explain it — which is how a failure on this
    // path reached a person as "try again in a moment" (a guess, and a wrong
    // one whenever the cause is permanent) and reached Sentry as nothing at
    // all. `catch {` with no binding is the shape that does that, so it is what
    // this forbids.
    const body = captures.match(/const dismissMany = useCallback\([\s\S]*?\n {4}\[/);
    expect(body![0]).toMatch(
      /for \(const item of items\) \{[\s\S]*?catch \(caught\) \{[\s\S]*?failed \+= 1;/,
    );
    expect(body![0]).toMatch(/firstError === undefined\) firstError = caught/);
    expect(body![0]).toMatch(/friendlyError\(firstError,/);
  });
});
