import { afterEach, describe, expect, it } from 'vitest';

import {
  createStandDown,
  resetTabBarSuppression,
  suppressTabBar,
  tabBarSuppressedSnapshot,
} from '@/lib/tabBarSuppress';

/** What the bar asks: "is the screen I am painted over asking me to go?" */
function suppressedOn(scope: string): boolean {
  return tabBarSuppressedSnapshot().includes(scope);
}

const REVIEW = '(tabs)/captures';
const HOME = '(tabs)';
const MESSAGES = 'captures/sms';

describe('tabBar suppression claims', () => {
  afterEach(() => {
    resetTabBarSuppression();
  });

  it('keeps the bar suppressed until every claimant releases', () => {
    const releaseSelection = suppressTabBar(REVIEW);
    const releaseSheet = suppressTabBar(REVIEW);

    expect(suppressedOn(REVIEW)).toBe(true);
    releaseSelection();
    expect(suppressedOn(REVIEW)).toBe(true);
    releaseSheet();
    expect(suppressedOn(REVIEW)).toBe(false);
  });

  it('makes release idempotent, so cleanup can run twice safely', () => {
    const release = suppressTabBar(REVIEW);

    release();
    release();

    expect(suppressedOn(REVIEW)).toBe(false);
  });

  /**
   * The guarantee this module exists for, and the one the old counter could not
   * make. A claim is only good on the screen that made it, so a screen that
   * fails to let go — Review is a tab, so it neither unmounts nor re-renders
   * once you have left it — cannot take the navigation away from anywhere else.
   *
   * Without this, the app is one missed release away from having no navigation
   * at all, on every screen, with nothing left able to put it back.
   */
  it('never hides the bar on a screen that did not ask', () => {
    suppressTabBar(REVIEW);

    expect(suppressedOn(REVIEW)).toBe(true);
    expect(suppressedOn(HOME)).toBe(false);
    expect(suppressedOn(MESSAGES)).toBe(false);
  });

  it('releases one claim of a scope, not every claim sharing it', () => {
    const releaseSelection = suppressTabBar(REVIEW);
    suppressTabBar(REVIEW);

    releaseSelection();

    expect(suppressedOn(REVIEW)).toBe(true);
  });

  it('forgets every outstanding claim', () => {
    suppressTabBar(REVIEW);
    suppressTabBar(MESSAGES);

    resetTabBarSuppression();

    expect(tabBarSuppressedSnapshot()).toEqual([]);
  });

  it('keeps the snapshot stable between changes, as useSyncExternalStore needs', () => {
    const release = suppressTabBar(REVIEW);
    const first = tabBarSuppressedSnapshot();

    expect(tabBarSuppressedSnapshot()).toBe(first);

    release();
    expect(tabBarSuppressedSnapshot()).not.toBe(first);
  });
});

describe('one screen standing the bar down', () => {
  afterEach(() => {
    resetTabBarSuppression();
  });

  it('holds the claim only while the screen is both asking and on screen', () => {
    const standDown = createStandDown();

    standDown.set(true, true, REVIEW);
    expect(suppressedOn(REVIEW)).toBe(true);

    standDown.set(false, true, REVIEW);
    expect(suppressedOn(REVIEW)).toBe(false);
  });

  /**
   * The bug this file exists to keep out. Review is a *tab*, so leaving it does
   * not unmount it: with the claim keyed on the selection alone, walking away
   * with rows still ticked left the navigation hidden everywhere else in the
   * app. Losing focus has to release it even though nothing about the
   * selection changed.
   */
  it('releases when the screen loses focus with the selection still live', () => {
    const standDown = createStandDown();
    standDown.set(true, true, REVIEW);

    standDown.set(true, false, REVIEW);

    expect(suppressedOn(REVIEW)).toBe(false);
  });

  it('takes the claim back when the screen is returned to, still selecting', () => {
    const standDown = createStandDown();
    standDown.set(true, true, REVIEW);
    standDown.set(true, false, REVIEW);

    standDown.set(true, true, REVIEW);

    expect(suppressedOn(REVIEW)).toBe(true);
  });

  it('claims once however often it is told the same thing', () => {
    const standDown = createStandDown();

    standDown.set(true, true, REVIEW);
    standDown.set(true, true, REVIEW);
    standDown.set(true, true, REVIEW);
    standDown.dispose();

    expect(suppressedOn(REVIEW)).toBe(false);
  });

  /**
   * A screen whose own route changed under it (a param it navigated to itself)
   * must not be left holding a claim under the route it used to be, which the
   * bar would never ask about again.
   */
  it('moves its claim when the screen it is on changes route', () => {
    const standDown = createStandDown();
    standDown.set(true, true, 'group/1');

    standDown.set(true, true, 'group/2');

    expect(suppressedOn('group/1')).toBe(false);
    expect(suppressedOn('group/2')).toBe(true);
  });

  it('lets go on unmount, and does not mind being disposed twice', () => {
    const standDown = createStandDown();
    standDown.set(true, true, MESSAGES);

    standDown.dispose();
    standDown.dispose();

    expect(suppressedOn(MESSAGES)).toBe(false);
  });

  it('keeps two screens independent — one leaving does not free the other', () => {
    const review = createStandDown();
    const messages = createStandDown();
    review.set(true, true, REVIEW);
    messages.set(true, true, MESSAGES);

    review.set(true, false, REVIEW);
    expect(suppressedOn(MESSAGES)).toBe(true);

    messages.set(true, false, MESSAGES);
    expect(suppressedOn(MESSAGES)).toBe(false);
  });
});
