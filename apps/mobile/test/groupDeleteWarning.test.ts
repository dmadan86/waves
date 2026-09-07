import { describe, expect, it } from 'vitest';

import { groupDeleteBody, MAX_DELETE_DEBT_LINES } from '../src/lib/groupDeleteWarning';

const text = {
  deleteBody: 'It goes for everyone in it, immediately, and this cannot be undone.',
  deleteUnsettledIntro: 'This group is not settled. Right now:',
  deleteUnsettledWarning:
    'Deleting it wipes that record for everyone in the group, not just for you.',
  deleteMoreDebts: { one: 'and {n} more', other: 'and {n} more' },
};

describe('groupDeleteBody', () => {
  it('uses the short confirmation for a settled group', () => {
    expect(
      groupDeleteBody({
        groupSettled: true,
        debtLines: ['Rider owes Financer ₹500'],
        locale: 'en',
        text,
      }),
    ).toBe(text.deleteBody);
  });

  it('names outstanding rider, traveller, and financer debts before counting the rest', () => {
    const debtLines = [
      'Rider owes Financer ₹500',
      'Traveller owes Financer AED 25.00',
      'User owes Rider ₹120',
      'Traveller owes User $8.50',
      'Financer owes Traveller €3.00',
    ];

    const body = groupDeleteBody({ groupSettled: false, debtLines, locale: 'en', text });

    for (const line of debtLines.slice(0, MAX_DELETE_DEBT_LINES)) {
      expect(body).toContain(line);
    }
    expect(body).not.toContain(debtLines[MAX_DELETE_DEBT_LINES]);
    expect(body).toContain('and 1 more');
    expect(body).toContain(text.deleteUnsettledWarning);
  });
});
