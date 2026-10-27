import { describe, expect, it } from 'vitest';
import { isTabRoot, tabBarRouteForSelection, personalRouteForSelection } from '../src/lib/tabBar';

describe('tab root selection', () => {
  it.each([['group', '[id]'], ['activity']])('returns Home from %j', (...segments) => {
    expect(tabBarRouteForSelection('index', 'index', isTabRoot(segments, 'index'))).toBe('/');
  });

  it.each(['index', 'friends', 'captures', 'me'])('suppresses %s only at its root', (key) => {
    expect(tabBarRouteForSelection(key, key, isTabRoot(['(tabs)', key], key))).toBeNull();
    expect(
      tabBarRouteForSelection(key, key, isTabRoot(['(tabs)', key, 'detail'], key)),
    ).not.toBeNull();
  });

  it('returns nested Personal screens to their owning destination', () => {
    expect(
      personalRouteForSelection(
        'transactions',
        'transactions',
        isTabRoot(['personal', 'entry', '[id]'], 'transactions'),
      ),
    ).toBe('/personal/transactions');
    expect(personalRouteForSelection('me', 'me', isTabRoot(['personal', 'budgets'], 'me'))).toBe(
      '/me',
    );
    expect(
      personalRouteForSelection(
        'transactions',
        'transactions',
        isTabRoot(['personal', 'transactions'], 'transactions'),
      ),
    ).toBeNull();
    expect(isTabRoot(['(tabs)'], 'index')).toBe(true);
  });
});
