/**
 * The words the navigation flows tap on, pinned to the strings they come from.
 *
 * The Maestro flows under `e2e/` are the only tests that exercise rendering,
 * navigation and the back button — and the CI job that runs them is gated off
 * on an `E2E_ENABLED` repo variable that has never been set (see
 * `e2e/README-e2e.md`). So a flow can rot for months without anybody hearing
 * about it, and the way it rots is the quiet way: somebody rewords a button,
 * `tapOn: 'Add expense'` stops matching, and the flow fails on the first person
 * to finally turn the job on — long after the change that broke it.
 *
 * This is the cheap half of that problem solved in a test that *does* run. It
 * does not prove the flows pass; it proves the English words they are written
 * against are still the words the app renders. When one of these fails, the fix
 * is to update the flow, not to reword the assertion back.
 *
 * Only the navigation flows are covered — `review-selection-back`,
 * `tab-bar-returns` and `back-through-the-stack` — because those are the ones
 * that exist to catch a class of bug (a screen that never gives the navigation
 * back) rather than a feature, and a silent failure there is a silent hole in
 * the only cover that class has.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');

const en = STRINGS_BY_LANGUAGE.en;

/**
 * Each entry is a word one of the flows types into `tapOn:` or `assertVisible:`,
 * and where the app gets it from. Written as a pair so a rename shows up here as
 * a failing comparison naming both sides, rather than as a flow that silently
 * matches nothing.
 */
const TAPPED: readonly (readonly [flowText: string, fromStrings: unknown])[] = [
  // The bottom bar. "Friends" is the discriminator all three flows use for
  // "the navigation is on screen", so it is the single most load-bearing word
  // in the set.
  ['Home', en.home],
  ['Friends', en.friends],
  ['Review', en.review],
  ['Personal', en.personal.tab],

  // Routes that hide the bar, and the controls that open them.
  ['Add expense', en.addExpense],
  ['New group', en.newGroup],

  // The group header's overflow menu, and a row inside it — the overlay that
  // has to take the back press without letting it fall through to the stack.
  ['More', en.group.more],
  ['Group settings', en.group.settings],

  // Review's two segments. Ticking belongs to the SMS one.
  ['Added by you', en.captures.tabAdded],
  ['SMS', en.captures.tabSms],

  // Review's selection bar.
  ['Just me', en.voice.justMe],
  ['Add to a group', en.captures.assignTitle],

  // The bank-message paste screen, which is how a device with no inbox gets
  // SMS-sourced drafts into Review.
  ['Add from bank messages', en.smsImport.title],
  ['Paste bank messages', en.smsImport.pasteLabel],
  ['Paste', en.smsImport.paste],
  ['Open Review', en.smsImport.openReview],

  // The expense detail screen's own words — what tells a real push apart from
  // a tap that did nothing.
  ['Delete expense', en.expense.deleteAction],
];

describe('the words the navigation flows tap on', () => {
  for (const [flowText, fromStrings] of TAPPED) {
    it(`still renders "${flowText}"`, () => {
      expect(fromStrings).toBe(flowText);
    });
  }
});

describe('the failure the Review flow asserts never appears', () => {
  it('is still worded the way the flow spells it', () => {
    // `review-selection-back.yaml` asserts this string is *absent* after "Just
    // me". An assertNotVisible against a string the app no longer uses passes
    // for free, which is the worst way for this particular guard to fail.
    expect(en.captures.couldNotSave).toBe("Couldn't save this — please try again in a moment.");
  });
});
