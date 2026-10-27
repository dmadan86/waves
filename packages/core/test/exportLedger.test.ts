import { describe, expect, it } from 'vitest';

import {
  exportDescription,
  exportMemberName,
  familyName,
  familySubtotals,
  memberAmounts,
  PdfBuilder,
  splitMethodLabel,
  wrapText,
} from '../src/export';

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

describe('export families', () => {
  const units = {
    sharma: { name: 'Sharma family', members: ['m', 'r'], head: 'm' },
    rao: { name: 'Rao', members: ['h'] },
  };

  it('names the family beside a member, and nothing without families', () => {
    expect(familyName(units, 'r')).toBe('Sharma family');
    expect(familyName(units, 'x')).toBe('');
    expect(familyName(null, 'r')).toBe('');
    expect(familyName(units, null)).toBe('');
  });

  it('totals what each family paid, its share and the net, per currency', () => {
    const expenses = [
      {
        currency: 'INR',
        payers: [{ member_id: 'm', amount: '30000' }],
        shares: [
          { member_id: 'm', amount: '10000' },
          { member_id: 'r', amount: '10000' },
          { member_id: 'h', amount: '5000' },
          { member_id: 'x', amount: '5000' },
        ],
      },
      {
        currency: 'USD',
        payers: [{ member_id: 'h', amount: 900n }],
        shares: [{ member_id: 'h', amount: 900n }],
      },
    ];
    expect(familySubtotals(units, expenses)).toEqual([
      { family: 'Sharma family', currency: 'INR', paid: 30000n, share: 20000n, net: 10000n },
      { family: 'Rao', currency: 'INR', paid: 0n, share: 5000n, net: -5000n },
      { family: 'Rao', currency: 'USD', paid: 900n, share: 900n, net: 0n },
    ]);
  });

  it('is empty for a group without families', () => {
    expect(familySubtotals(null, [{ currency: 'INR', payers: [], shares: [] }])).toEqual([]);
  });
});

describe('shared export labels', () => {
  it('uses a hyphen for missing or blank descriptions', () => {
    for (const description of [undefined, null, '', '  \n ']) {
      expect(exportDescription(description)).toBe('-');
    }
    expect(exportDescription(' Dinner ')).toBe('Dinner');
    expect(exportDescription('Untitled')).toBe('Untitled');
  });

  it('names the viewer in balances, payers, shares and settlements', () => {
    const viewer = { profile: { display_name: 'Madan' }, ghost_name: null };
    const name = exportMemberName(viewer);
    expect(name).toBe('Madan');
    const amounts = memberAmounts([{ member_id: 'viewer', amount: 100n }], 'USD', () => name);
    const pdf = new PdfBuilder()
      .body(`Balance: ${name}`)
      .body(`Paid by: ${amounts}`)
      .body(`Shares: ${amounts}`)
      .body(`Settlement: ${name} -> Renny`)
      .build();
    expect(pdf).toContain('(Balance: Madan) Tj');
    expect(pdf).toContain('(Paid by: Madan 1.00) Tj');
    expect(pdf).toContain('(Shares: Madan 1.00) Tj');
    expect(pdf).toContain('(Settlement: Madan -> Renny) Tj');
    expect(pdf).not.toContain('You');
    expect(exportMemberName({ ghost_name: 'Guest' })).toBe('Guest');
    expect(exportMemberName({}, 'Unknown')).toBe('Unknown');
  });
});
