import { describe, expect, it } from 'vitest';
import { isPersonalMode, personalActiveKey } from '../src/lib/tabBar';
import { settingsRoute } from '../src/lib/settingsRoute';
import { resolveFab } from '../src/lib/fabOverride';

describe("Personal's Me tab opens Settings without leaving Personal", () => {
  it('Settings opened from the Personal Home menu keeps the Personal bar and highlights nothing', () => {
    expect(isPersonalMode(['profile'], 'personal')).toBe(true);
    expect(personalActiveKey(['profile'])).toBe('');
  });

  it('Settings opened from Groups keeps the Groups bar', () => {
    expect(isPersonalMode(['profile'])).toBe(false);
    expect(isPersonalMode(['settings', 'lock'])).toBe(false);
  });

  it('every page a Personal settings list opens carries the Personal marker', () => {
    expect(settingsRoute('/settings/lock', 'personal')).toBe('/settings/lock?space=personal');
    expect(settingsRoute('/settings/x?tab=a', 'personal')).toBe('/settings/x?tab=a&space=personal');
    expect(settingsRoute('/settings/lock?space=personal', 'personal')).toBe(
      '/settings/lock?space=personal',
    );
    expect(settingsRoute('/settings/lock', undefined)).toBe('/settings/lock');
    expect(isPersonalMode(['settings', 'lock'], 'personal')).toBe(true);
  });
});

describe('the round add button', () => {
  const fallback = { label: 'Add expense', run: () => 'expense' };
  it('does what the screen asked for (Recurring: Add recurring)', () => {
    const recurring = { label: 'Add recurring', run: () => 'recurring' };
    expect(resolveFab(recurring, fallback).label).toBe('Add recurring');
    expect(resolveFab(recurring, fallback).run()).toBe('recurring');
  });
  it('falls back to Add expense on other screens', () => {
    expect(resolveFab(null, fallback).label).toBe('Add expense');
  });
});

describe('no floating + in Personal or household', () => {
  it('draws no round + on any Personal route', async () => {
    const { personalShowsAddFab } = await import('../src/lib/personalLayoutRules');
    for (const segs of [
      ['(tabs)', 'me'],
      ['personal', 'transactions'],
      ['personal', 'recurring'],
      ['personal', 'spending'],
      ['personal', 'accounts'],
      ['personal', 'loans'],
      ['rentals'],
      ['investments'],
      ['profile'],
    ])
      expect(personalShowsAddFab(segs)).toBe(false);
  });

  it('highlights no tab on Personal settings routes', () => {
    expect(personalActiveKey(['settings', 'backup'], 'personal')).toBe('');
    expect(personalActiveKey(['settings', 'lock'], 'personal')).toBe('');
  });
});

describe('room for the round + only where it is drawn', () => {
  it('reserves space only when a button actually shows', async () => {
    const { fabDrawn } = await import('../src/lib/personalLayoutRules');
    // Personal screens that hide the + must not keep an empty band above the tab bar.
    expect(
      fabDrawn({ personal: true, company: false, noAdd: false, segments: ['rentals', 'abc'] }),
    ).toBe(false);
    expect(
      fabDrawn({ personal: true, company: false, noAdd: false, segments: ['personal', 'loans'] }),
    ).toBe(false);
    expect(
      fabDrawn({ personal: true, company: false, noAdd: false, segments: ['(tabs)', 'me'] }),
    ).toBe(false);
    expect(
      fabDrawn({ personal: false, company: true, noAdd: true, segments: ['group', 'g1'] }),
    ).toBe(false);
    expect(
      fabDrawn({ personal: false, company: true, noAdd: false, segments: ['group', 'g1'] }),
    ).toBe(true);
    // A household group (neither Personal nor company) floats nothing either.
    expect(
      fabDrawn({ personal: false, company: false, noAdd: false, segments: ['group', 'g1'] }),
    ).toBe(false);
  });
});
