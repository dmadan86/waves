/**
 * Which currency a budget's amount is read in.
 *
 * The rule is one line. The test is here because the failure is silent and
 * large: the edit field is prefilled in the budget's own currency, so parsing
 * it in the group's applies the wrong minor-unit exponent, and the saved row
 * comes out a hundredfold wrong under a denomination nobody picked. Nothing
 * errors, and the number on screen afterwards looks like a number somebody
 * could have typed.
 */

import { describe, expect, it } from 'vitest';

import { parseMajor, toMajorString, money as coreMoney } from '@waves/core';

import { budgetDenomination } from '../src/lib/budgets';

describe('budgetDenomination', () => {
  it('keeps an existing budget in its own currency', () => {
    expect(budgetDenomination({ currency: 'JPY' }, 'INR')).toBe('JPY');
  });

  it('gives a new budget the group’s default', () => {
    expect(budgetDenomination(null, 'INR')).toBe('INR');
    expect(budgetDenomination(undefined, 'INR')).toBe('INR');
  });
});

describe('why it matters', () => {
  it('shows what reading the group’s currency instead would have cost', () => {
    // A ¥15,000 cap. Yen has no minor unit, so the row holds 15000.
    const stored = 15000n;
    const shown = toMajorString(coreMoney(stored, 'JPY'));
    expect(shown).toBe('15000');

    // Read back in its own currency: unchanged, which is the whole point —
    // saving without editing must not move the number.
    expect(parseMajor(shown, budgetDenomination({ currency: 'JPY' }, 'INR')).minor).toBe(stored);

    // Read back as rupees, which have two: a hundredfold error, silently.
    expect(parseMajor(shown, 'INR').minor).toBe(1_500_000n);
  });

  it('round-trips a two-decimal budget under a group that uses none', () => {
    // The same trap in the other direction.
    const stored = 250050n; // ₹2,500.50
    const shown = toMajorString(coreMoney(stored, 'INR'));
    expect(parseMajor(shown, budgetDenomination({ currency: 'INR' }, 'JPY')).minor).toBe(stored);
  });
});
