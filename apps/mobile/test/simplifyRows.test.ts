/**
 * The who-pays-whom list's shape.
 *
 * Pinned because the two things this decides — which section a row falls in,
 * and who the row points at — are invisible in a screenshot until they are
 * wrong, and getting the second one wrong points somebody at a stranger's
 * ledger.
 */

import { describe, expect, it } from 'vitest';

import { SimplifySide, simplifyItems, type SimplifyTransfer } from '@/lib/simplifyRows';

const transfer = (from: string, to: string, amount = 500n): SimplifyTransfer => ({
  from,
  to,
  currency: 'INR',
  amount,
});

describe('simplifyItems', () => {
  it('puts your own payments first, under headings', () => {
    const items = simplifyItems([transfer('asha', 'ravi'), transfer('me', 'ravi')], 'me');

    expect(items.map((item) => item.kind)).toEqual(['heading', 'transfer', 'heading', 'transfer']);
    expect(items[0]).toMatchObject({ kind: 'heading', section: 'yours' });
    expect(items[1]).toMatchObject({ side: SimplifySide.YouPay, personId: 'ravi' });
    expect(items[2]).toMatchObject({ kind: 'heading', section: 'others' });
    expect(items[3]).toMatchObject({ side: SimplifySide.Others, personId: 'asha' });
  });

  it('drops the headings when every row is on one side', () => {
    const onlyMine = simplifyItems([transfer('me', 'ravi'), transfer('asha', 'me')], 'me');
    expect(onlyMine.every((item) => item.kind === 'transfer')).toBe(true);

    const onlyTheirs = simplifyItems([transfer('asha', 'ravi')], 'me');
    expect(onlyTheirs.every((item) => item.kind === 'transfer')).toBe(true);
  });

  it('points a row at the person on it who is not you', () => {
    const [pay, receive] = simplifyItems([transfer('me', 'ravi'), transfer('asha', 'me')], 'me');

    expect(pay).toMatchObject({ side: SimplifySide.YouPay, personId: 'ravi' });
    expect(receive).toMatchObject({ side: SimplifySide.YouReceive, personId: 'asha' });
  });

  it('treats everything as somebody else’s before the members land', () => {
    const items = simplifyItems([transfer('me', 'ravi')], null);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ side: SimplifySide.Others, personId: 'me' });
  });

  it('marks the last row of each section, so a hairline never meets a heading', () => {
    const items = simplifyItems(
      [transfer('me', 'ravi'), transfer('me', 'asha'), transfer('asha', 'ravi')],
      'me',
    );
    const rows = items.filter((item) => item.kind === 'transfer');

    expect(rows.map((row) => row.isLast)).toEqual([false, true, true]);
  });

  it('keeps two currencies between the same pair apart', () => {
    const items = simplifyItems(
      [transfer('asha', 'ravi'), { ...transfer('asha', 'ravi'), currency: 'USD' }],
      'me',
    );

    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });
});
