import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { INVESTMENT_TYPES, PROPERTY_TYPES } from '@waves/core';

import * as icons from '@/lib/wizardIcons';

const glyphs = JSON.parse(
  readFileSync(
    'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
    'utf8',
  ),
) as Record<string, number>;

describe('wizard icons', () => {
  it('has an icon for every property and investment type', () => {
    for (const v of PROPERTY_TYPES) expect(icons.PROPERTY_ICON[v], v).toBeTruthy();
    for (const v of INVESTMENT_TYPES) expect(icons.INVESTMENT_ICON[v], v).toBeTruthy();
    expect(Object.keys(icons.YES_NO_ICON).sort()).toEqual(['no', 'yes']);
  });
  it('covers every personal setup answer', () => {
    expect(Object.keys(icons.INCOME_ICON).sort()).toEqual([
      'business',
      'freelance',
      'none',
      'pension',
      'salary',
    ]);
    expect(Object.keys(icons.HOME_ICON).sort()).toEqual(['home_loan', 'none', 'rent']);
    expect(Object.keys(icons.LOAN_ICON).sort()).toEqual([
      'car',
      'card',
      'education',
      'personal',
      'secured_other',
    ]);
    expect(Object.keys(icons.EAT_ICON).sort()).toEqual(['daily', 'rarely', 'week12', 'week34']);
    expect(Object.keys(icons.SAVINGS_ICON).sort()).toEqual([
      '1to3',
      '3to6',
      '6plus',
      'none',
      'under1',
    ]);
  });
  it('only uses icons that exist in Ionicons', () => {
    const all = [
      ...Object.values(icons.PROPERTY_ICON),
      ...Object.values(icons.INVESTMENT_ICON),
      ...Object.values(icons.YES_NO_ICON),
      ...Object.values(icons.INCOME_ICON),
      ...Object.values(icons.HOME_ICON),
      ...Object.values(icons.LOAN_ICON),
      ...Object.values(icons.EAT_ICON),
      ...Object.values(icons.SAVINGS_ICON),
      ...Object.values(icons.STEP_ICON),
      icons.ESCALATION_ICON,
      icons.EATEN_EACH_ICON,
    ];
    for (const name of all) expect(glyphs[name], name).toBeDefined();
  });
  it('draws tiles only when every option has an icon', () => {
    expect(icons.usesTiles([{ icon: 'home-outline' }, { icon: 'key-outline' }])).toBe(true);
    expect(icons.usesTiles([{ icon: 'home-outline' }, {}])).toBe(false);
    expect(icons.usesTiles([{}, {}])).toBe(false);
    expect(icons.usesTiles([])).toBe(false);
  });
});
