import { describe, expect, it } from 'vitest';
import { isPersonalMode, personalActiveKey } from '../src/lib/tabBar';
import { settingsRoute } from '../src/lib/settingsRoute';
import { resolveFab } from '../src/lib/fabOverride';

describe("Personal's Me tab opens Settings without leaving Personal", () => {
  it('Settings opened from Me keeps the Personal bar and highlights Me', () => {
    expect(isPersonalMode(['profile'], 'personal')).toBe(true);
    expect(personalActiveKey(['profile'])).toBe('me');
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

describe('one add control per Personal screen', () => {
  it('hides the round + where the header + is the add control', async () => {
    const { personalShowsAddFab } = await import('../src/lib/personalLayoutRules');
    for (const leaf of ['loans', 'recurring', 'budgets', 'upcoming'])
      expect(personalShowsAddFab(['personal', leaf])).toBe(false);
    expect(personalShowsAddFab(['personal', 'transactions'])).toBe(true);
    expect(personalShowsAddFab(['(tabs)', 'me'])).toBe(true);
    expect(personalShowsAddFab(['profile'])).toBe(false);
    expect(personalShowsAddFab(['settings', 'backup'])).toBe(false);
    expect(personalShowsAddFab(['personal', 'setup'])).toBe(false);
    for (const root of ['rentals', 'investments'])
      for (const rest of [[], ['add'], ['abc123'], ['tenant']])
        expect(personalShowsAddFab([root, ...rest])).toBe(false);
  });

  it('keeps Me selected on Personal settings routes', () => {
    expect(personalActiveKey(['settings', 'backup'], 'personal')).toBe('me');
    expect(personalActiveKey(['settings', 'lock'], 'personal')).toBe('me');
  });
});
