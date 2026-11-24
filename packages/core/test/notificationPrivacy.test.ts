import { describe, expect, it } from 'vitest';

import { buildPushBatch, isPrivateSpaceType, renderPrivateNotification } from '../src/index';

const facts = {
  amount: '42000',
  currency: 'INR',
  counterparty: 'Priya',
  group: 'Home',
  description: 'Dinner at Taj',
};

describe('isPrivateSpaceType', () => {
  it('is couple and home only', () => {
    expect(isPrivateSpaceType('couple')).toBe(true);
    expect(isPrivateSpaceType('home')).toBe(true);
    expect(isPrivateSpaceType('trip')).toBe(false);
    expect(isPrivateSpaceType(null)).toBe(false);
  });
});

describe('renderPrivateNotification', () => {
  it.each(['expense_added', 'expense_edited', 'you_owe', 'settlement_initiated'])(
    'leaks no amount or description for %s',
    (kind) => {
      for (const locale of ['en', 'ta', 'hi', 'ar']) {
        const { title, body } = renderPrivateNotification(kind, facts, locale);
        const text = `${title} ${body}`;
        expect(text).not.toMatch(/420|Taj|\{/);
      }
    },
  );

  it('says who added an expense and where', () => {
    expect(renderPrivateNotification('expense_added', facts, 'en').title).toBe(
      'Priya added an expense in Home',
    );
  });

  it('is used by buildPushBatch only when private', () => {
    const row = {
      id: 'n1',
      kind: 'expense_added',
      title: 't',
      body: 'b',
      facts,
      tokens: ['tok'],
    };
    expect(buildPushBatch([row]).messages[0]?.body).toContain('Taj');
    expect(buildPushBatch([{ ...row, private: true }]).messages[0]?.body).not.toContain('Taj');
  });
});
