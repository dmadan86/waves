import { afterEach, describe, expect, it } from 'vitest';

import {
  createStandDown,
  resetTabBarSuppression,
  suppressTabBar,
  tabBarSuppressedSnapshot,
} from '@/lib/tabBarSuppress';

describe('tabBar suppression claims', () => {
  afterEach(() => {
    resetTabBarSuppression();
  });

  it('keeps the bar suppressed until every claimant releases', () => {
    const releaseSelection = suppressTabBar();
    const releaseSheet = suppressTabBar();

    expect(tabBarSuppressedSnapshot()).toBe(true);
    releaseSelection();
    expect(tabBarSuppressedSnapshot()).toBe(true);
    releaseSheet();
    expect(tabBarSuppressedSnapshot()).toBe(false);
  });

  it('makes release idempotent, so cleanup can run twice safely', () => {
    const release = suppressTabBar();

    release();
    release();

    expect(tabBarSuppressedSnapshot()).toBe(false);
  });

  it('forgets every outstanding claim', () => {
    suppressTabBar();
    suppressTabBar();

    resetTabBarSuppression();

    expect(tabBarSuppressedSnapshot()).toBe(false);
  });
});

describe('one screen standing the bar down', () => {
  afterEach(() => {
    resetTabBarSuppression();
  });

  it('holds the claim only while the screen is both asking and on screen', () => {
    const standDown = createStandDown();

    standDown.set(true, true);
    expect(tabBarSuppressedSnapshot()).toBe(true);

    standDown.set(false, true);
    expect(tabBarSuppressedSnapshot()).toBe(false);
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
    standDown.set(true, true);

    standDown.set(true, false);

    expect(tabBarSuppressedSnapshot()).toBe(false);
  });

  it('takes the claim back when the screen is returned to, still selecting', () => {
    const standDown = createStandDown();
    standDown.set(true, true);
    standDown.set(true, false);

    standDown.set(true, true);

    expect(tabBarSuppressedSnapshot()).toBe(true);
  });

  it('claims once however often it is told the same thing', () => {
    const standDown = createStandDown();

    standDown.set(true, true);
    standDown.set(true, true);
    standDown.set(true, true);
    standDown.dispose();

    expect(tabBarSuppressedSnapshot()).toBe(false);
  });

  it('lets go on unmount, and does not mind being disposed twice', () => {
    const standDown = createStandDown();
    standDown.set(true, true);

    standDown.dispose();
    standDown.dispose();

    expect(tabBarSuppressedSnapshot()).toBe(false);
  });

  it('keeps two screens independent — one leaving does not free the other', () => {
    const review = createStandDown();
    const messages = createStandDown();
    review.set(true, true);
    messages.set(true, true);

    review.set(true, false);
    expect(tabBarSuppressedSnapshot()).toBe(true);

    messages.set(true, false);
    expect(tabBarSuppressedSnapshot()).toBe(false);
  });
});
