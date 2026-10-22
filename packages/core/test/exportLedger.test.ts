import { describe, expect, it } from 'vitest';

import { memberAmounts, PdfBuilder, splitMethodLabel, wrapText } from '../src/export';

const names: Record<string, string> = { m: 'Madan', r: 'Renny', h: 'Hethu', x: 'Left Lee' };
const nameOf = (id: string | null): string => names[id ?? ''] ?? 'unknown';

describe('export paid-by / split text', () => {
  it('equal split: every share named with its amount', () => {
    const shares = [
      { member_id: 'm', amount: '20000' },
      { member_id: 'r', amount: '20000' },
      { member_id: 'h', amount: '20000' },
    ];
    expect(splitMethodLabel('equal')).toBe('Equally');
    expect(memberAmounts(shares, 'INR', nameOf, '; ')).toBe(
      'Madan 200.00; Renny 200.00; Hethu 200.00',
    );
  });

  it('several payers', () => {
    const payers = [
      { member_id: 'm', amount: '40000' },
      { member_id: 'r', amount: '20000' },
    ];
    expect(memberAmounts(payers, 'INR', nameOf)).toBe('Madan 400.00, Renny 200.00');
  });

  it('exact amounts and a member who left keep their names', () => {
    expect(splitMethodLabel('exact')).toBe('By exact amounts');
    expect(
      memberAmounts(
        [
          { member_id: 'x', amount: 1050n },
          { member_id: 'm', amount: 950n },
        ],
        'USD',
        nameOf,
        '; ',
      ),
    ).toBe('Left Lee 10.50; Madan 9.50');
  });

  it('labels the other modes and tolerates a missing one', () => {
    expect(splitMethodLabel('percent')).toBe('By percentage');
    expect(splitMethodLabel('shares')).toBe('By shares');
    expect(splitMethodLabel('adjustment')).toBe('Adjusted');
    expect(splitMethodLabel(null)).toBe('');
    expect(memberAmounts(undefined, 'INR', nameOf)).toBe('');
  });

  it('wraps long lists on word boundaries', () => {
    const lines = wrapText('Paid by: Madan 400.00, Renny 200.00, Hethu 100.00', 24);
    expect(lines).toEqual(['Paid by: Madan 400.00,', 'Renny 200.00, Hethu', '100.00']);
  });

  it('PDF carries the paid-by and split lines', () => {
    const pdf = new PdfBuilder()
      .body(`Paid by: ${memberAmounts([{ member_id: 'm', amount: 60000n }], 'INR', nameOf)}`, 7)
      .body('Split - Equally: Madan 300.00, Renny 300.00', 7)
      .build();
    expect(pdf).toContain('(Paid by: Madan 600.00) Tj');
    expect(pdf).toContain('(Split - Equally: Madan 300.00, Renny 300.00) Tj');
  });
});
