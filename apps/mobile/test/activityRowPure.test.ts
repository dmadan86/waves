import { describe, expect, it } from 'vitest';

import {
  activityAmountStyle,
  activityCategory,
  activityTileGlyph,
  heroWantsDarkInk,
} from '../src/lib/activityRowPure';

const labels = (id: string): string | undefined =>
  ({ food: 'Food & drink', travel: 'Travel', shopping: 'Shopping' })[id];

describe('activityCategory', () => {
  it('follows a stored built-in key', () => {
    const c = activityCategory('Lunch', { key: 'food', meta: null }, labels);
    expect(c?.label).toBe('Food & drink');
    expect(c?.glyph.name).toBe('restaurant-outline');
  });

  it('guesses from the description when nothing is stored', () => {
    expect(activityCategory('Uber ride', null, labels)?.label).toBe('Travel');
  });

  it('draws fuel as a pump on mint, even over a stored food key', () => {
    const c = activityCategory('Petrol', { key: 'food', meta: null }, labels);
    expect(c?.glyph).toEqual({ family: 'mci', name: 'gas-station-outline', tint: 'mint' });
    expect(c?.label).toBe('Travel');
  });

  it('keeps a custom tag exactly as its author made it', () => {
    const meta = { label: 'Petrol', icon: 'car-sport-outline', tint: 'mint' as const };
    const c = activityCategory('Fuel', { key: 'petrol', meta }, labels);
    expect(c?.label).toBe('Petrol');
    expect(c?.glyph.name).toBe('car-sport-outline');
  });

  it('is null when there is nothing to say', () => {
    expect(activityCategory('', null, labels)).toBeNull();
  });
});

describe('activityTileGlyph', () => {
  const food = activityCategory('Lunch', { key: 'food', meta: null }, labels);

  it('shows the category on an added expense', () => {
    expect(activityTileGlyph('added', 'expense', food)).toEqual(food?.glyph);
  });

  it('shows the red bin on a deleted expense, whatever it was for', () => {
    const g = activityTileGlyph('deleted', 'expense', food);
    expect(g.name).toBe('trash-outline');
    expect(g.tint).toBe('coral');
  });

  it('shows a check on a settlement', () => {
    const g = activityTileGlyph('auto_confirmed', 'settlement', null);
    expect(g.name).toBe('checkmark-circle-outline');
    expect(g.tint).toBe('mint');
  });

  it('falls back to the receipt for an uncategorised expense', () => {
    expect(activityTileGlyph('added', 'expense', null).name).toBe('receipt-outline');
  });
});

describe('activityAmountStyle', () => {
  it('is positive for a normal bill', () => {
    expect(activityAmountStyle('added')).toEqual({ tone: 'positive', strike: false });
  });
  it('is red and struck through for a deleted bill', () => {
    expect(activityAmountStyle('deleted')).toEqual({ tone: 'negative', strike: true });
  });
  it('is positive for a settlement', () => {
    expect(activityAmountStyle('auto_confirmed').tone).toBe('positive');
    expect(activityAmountStyle('settled').tone).toBe('positive');
  });
});

describe('heroWantsDarkInk', () => {
  it('uses dark ink on pale skies and white on deep ones', () => {
    expect(heroWantsDarkInk('morning')).toBe(true);
    expect(heroWantsDarkInk('night')).toBe(false);
  });
});

describe('activityTileGlyph, a group settings change', () => {
  it('draws the setting that moved, on the edit tint', () => {
    expect(activityTileGlyph('group_updated', 'group', null, 'dates')).toEqual({
      family: 'ion',
      name: 'calendar-outline',
      tint: 'lilac',
    });
    expect(activityTileGlyph('group_updated', 'group', null, 'cover').name).toBe('image-outline');
  });

  it('keeps the cog for a field it has not met, and for no field at all', () => {
    expect(activityTileGlyph('group_updated', 'group', null, 'newer').name).toBe(
      'settings-outline',
    );
    expect(activityTileGlyph('group_updated', 'group', null).name).toBe('settings-outline');
  });

  it('draws a person added or removed by the verb, not a field', () => {
    expect(activityTileGlyph('member_added', 'member', null).name).toBe('person-add-outline');
    expect(activityTileGlyph('member_removed', 'member', null).tint).toBe('coral');
  });
});

it('uses a red person-remove glyph for removed and departed members', () => {
  for (const verb of ['member_removed', 'member_left']) {
    expect(activityTileGlyph(verb, 'member', null)).toEqual({
      family: 'ion',
      name: 'person-remove-outline',
      tint: 'coral',
    });
  }
});
