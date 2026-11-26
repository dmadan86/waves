/**
 * Owner rule: several priced items in one sentence are ONE expense per currency
 * (summed, items listed), on the phone and from the server agent alike; plus the
 * parse fixes found in the typed-voice QA round.
 */

import { describe, expect, it } from 'vitest';
import type { VoiceAgentAction } from '@waves/core';

import { leaveUpdatesDraft, worthFiling } from '@/lib/voiceDraftPure';
import { mergeAgentExpenses } from '@/lib/voiceAgentPlan';
import { parseVoiceExpenses } from '@/lib/voiceExpense';
import { payerRowEntries, payerRowValue } from '@/lib/voiceReviewRows';

const groups = [
  { id: 'g1', name: 'QA Goa Trip', currency: 'INR' },
  { id: 'g2', name: 'QA Goa Trip 2', currency: 'INR' },
];
const members = [
  { id: 'm-me', name: 'Madan', isMe: true },
  { id: 'm-alice', name: 'Alice' },
];

const rows = (say: string) =>
  parseVoiceExpenses(say, groups).items.map((i) => [i.amountMajor, i.currency, i.note]);

describe('one currency: one expense, items listed', () => {
  it.each([
    '20 rupees for food, 30 rupees for tea, 1000 rupees for dress, 800 rupees for shoes',
    '20 rupees food, 30 rupees tea, 1000 rupees dress and 800 rupees shoes',
  ])('%s', (say) => {
    expect(rows(say)).toEqual([[1850, 'INR', 'food 20, tea 30, dress 1000, shoes 800']]);
  });

  it('without a currency word, with "and"', () => {
    expect(rows('food 20, tea 30, dress 1000, shoes 800')).toEqual([
      [1850, null, 'food 20, tea 30, dress 1000, shoes 800'],
    ]);
    expect(rows('food 20 and tea 30 and dress 1000')).toEqual([
      [1050, null, 'food 20, tea 30, dress 1000'],
    ]);
  });

  it('takes the category of the largest item', () => {
    const [item] = parseVoiceExpenses('food 20, tea 30, dress 1000', groups).items;
    expect(item.category).toBe('other');
    expect(parseVoiceExpenses('dinner 500, tea 30', groups).items[0].category).toBe('food');
  });

  it('keeps the exact minor amount', () => {
    const [item] = parseVoiceExpenses('tea 20.55, cab 10.10', groups).items;
    expect(item.amountMinor).toBe(3065n);
  });
});

describe('mixed currencies: one expense per currency, never summed across', () => {
  it('$10 dress, 16 rupees tea', () => {
    expect(rows('$10 for dress, 16 rupees for tea')).toEqual([
      [10, 'USD', 'dress'],
      [16, 'INR', 'tea'],
    ]);
  });

  it('10 dollars dress, 16 rupees tea, 5 dollars cab', () => {
    expect(rows('10 dollars dress, 16 rupees tea, 5 dollars cab')).toEqual([
      [15, 'USD', 'dress 10, cab 5'],
      [16, 'INR', 'tea'],
    ]);
  });
});

describe('who owes what stays one split, not a list', () => {
  it('"I paid 900, Alice owes 300" is one expense with Alice\'s share', () => {
    const result = parseVoiceExpenses('I paid 900, Alice owes 300', groups, { members });
    expect(result.items.map((i) => i.amountMajor)).toEqual([900]);
    expect(result.intent?.splitMode).toBe('exact');
    expect(result.intent?.participants?.find((p) => p.memberId === 'm-alice')?.exactMinor).toBe(
      30000n,
    );
  });
});

describe("the agent's actions are merged the same way", () => {
  const add = (description: string, amountMinor: string, over: Partial<VoiceAgentAction> = {}) =>
    ({
      type: 'add_expense',
      groupId: 'g1',
      description,
      amountMinor,
      currency: 'INR',
      paidByMemberId: 'm-me',
      split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-alice' }] },
      ...over,
    }) as VoiceAgentAction;

  it('sums one currency, lists the items, one expense per currency', () => {
    const merged = mergeAgentExpenses([
      add('dress', '1000'),
      add('tea', '1600', { currency: 'USD' }),
      add('cab', '500'),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ amountMinor: '1500', description: 'dress 10, cab 5' });
    expect(merged[1]).toMatchObject({ amountMinor: '1600', currency: 'USD' });
  });

  it('does not merge different payers or split modes', () => {
    const actions = [
      add('a', '1000'),
      add('b', '2000', { paidByMemberId: 'm-alice' }),
      add('c', '3000', { split: { mode: 'exact', shares: [{ memberId: 'm-me', value: '3000' }] } }),
    ];
    expect(mergeAgentExpenses(actions)).toHaveLength(3);
  });
});

describe('amount forms', () => {
  it('"lunch fifty" is 50, and a number word after a noun in a list', () => {
    expect(rows('lunch fifty')).toEqual([[50, null, 'lunch']]);
    expect(rows('tea twenty and cab fifty')).toEqual([[70, null, 'tea 20, cab 50']]);
  });

  it('a small number word stays a word ("lunch for two")', () => {
    expect(parseVoiceExpenses('lunch for two', groups).items).toEqual([]);
  });

  it('"one lakh twenty" is flagged as unclear', () => {
    const { amount } = parseVoiceExpenses('one lakh twenty', groups);
    expect(amount?.ambiguity).toBe('decimal-or-hundreds');
    expect(amount?.options.map((o) => o.minor)).toEqual([10002000n, 12000000n]);
    expect(parseVoiceExpenses('one lakh twenty thousand', groups).amount?.ambiguity).toBe('none');
  });

  it('very long text still finds the amount', () => {
    const result = parseVoiceExpenses(`dinner 500 ${'x '.repeat(220)}`, groups);
    expect(result.items.map((i) => i.amountMajor)).toEqual([500]);
  });
});

describe('group names stay out of descriptions', () => {
  it('a name the sentence could not settle on is not a title', () => {
    const items = parseVoiceExpenses('tea 20, mpq snacks 50 qa goa trip', groups).items;
    expect(items[0].note).not.toMatch(/goa|trip/i);
    expect(items[0].note).toContain('mpq snacks 50');
  });
});

describe("typed text is not filed behind the reader's back", () => {
  it('worthFiling and leaving skip typed text', () => {
    expect(worthFiling('coffee 80')).toBe(true);
    expect(worthFiling('coffee 80', true)).toBe(false);
    expect(leaveUpdatesDraft('review', 1, true)).toBe(true);
    expect(leaveUpdatesDraft('review', 1, true, true)).toBe(false);
  });
});

describe('Paid by shows the name', () => {
  it('maps member ids to names, never ids', () => {
    const entries = payerRowEntries(['m-alice'], members);
    expect(payerRowValue(entries, 'You', '{count} people')).toBe('Alice');
    expect(payerRowValue(payerRowEntries(['m-me'], members), 'You', '{count} people')).toBe('You');
  });
});
