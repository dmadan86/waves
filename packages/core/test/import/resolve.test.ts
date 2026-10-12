import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  draftFromSplitwise,
  draftFromText,
  draftFromWavesCsv,
  type DraftSplit,
  type ImportDraft,
  type ImportDraftRow,
} from '../../src/import/draft.js';
import { ImportProblemKind } from '../../src/import/problem.js';
import { reconstructPayers, resolveDraft } from '../../src/import/resolve.js';
import { importSplitwiseCsv } from '../../src/import/splitwise.js';
import { positiveAmounts } from '../arbitraries.js';
import { fixtureText } from './fixtures.js';

const text = fixtureText;

const sum = (record: Readonly<Record<string, bigint>>): bigint =>
  Object.values(record).reduce((total, value) => total + value, 0n);

const draftOf = (people: string[], rows: Partial<ImportDraftRow>[]): ImportDraft => ({
  source: 'csv',
  people,
  rows: rows.map((row, index) => ({
    key: `csv:${index + 2}`,
    row: index + 2,
    kind: 'expense',
    date: '2026-01-01',
    description: `Row ${index}`,
    category: null,
    rawCategory: null,
    currency: 'INR',
    amount: 10000n,
    payers: { single: people[0]! },
    split: { kind: 'equal', among: 'everyone' },
    confidence: null,
    issues: [],
    ...row,
  })),
  fileProblems: [],
  detected: null,
});

const group = { groupCurrency: 'INR', members: [] };

describe('resolveDraft', () => {
  it('splits equally among everyone, and everyone is the group plus the people the import adds', () => {
    const draft = draftOf(['Asha', 'Bharath'], [{ amount: 10000n }]);
    const resolved = resolveDraft(
      draft,
      { Asha: 'm1' },
      {
        groupCurrency: 'INR',
        members: [
          { id: 'm1', name: 'Asha K' },
          { id: 'm2', name: 'Dev' },
        ],
      },
    );
    const row = resolved.rows[0]!;
    expect(row.kind === 'expense' && Object.keys(row.shares).sort()).toEqual([
      'Asha',
      'Bharath',
      'Dev',
    ]);
    expect(resolved.people).toEqual([
      { name: 'Asha', memberId: 'm1' },
      { name: 'Bharath', memberId: null },
      { name: 'Dev', memberId: 'm2' },
    ]);
  });

  it('treats two file names mapped to one member as one person', () => {
    const draft = draftOf(
      ['Ravi', 'R. Kumar', 'Asha'],
      [
        {
          payers: { single: 'R. Kumar' },
          split: { kind: 'equal', among: ['Ravi', 'R. Kumar', 'Asha'] },
        },
      ],
    );
    const resolved = resolveDraft(draft, { Ravi: 'm1', 'R. Kumar': 'm1' }, group);
    const row = resolved.rows[0]!;
    expect(row.kind === 'expense' && row.payers).toEqual({ Ravi: 10000n });
    expect(row.kind === 'expense' && Object.keys(row.shares).sort()).toEqual(['Asha', 'Ravi']);
    expect(resolved.people.map((person) => person.name)).toEqual(['Ravi', 'Asha']);
  });

  it('defaults an unstated payer to the importer, with a warning, and refuses without one', () => {
    const draft = draftOf(['Asha', 'Bharath'], [{ payers: null }]);
    const mapped = resolveDraft(
      draft,
      { Asha: 'm1' },
      { ...group, members: [{ id: 'm1', name: 'Asha' }], importerMemberId: 'm1' },
    );
    expect(mapped.rows[0]?.kind === 'expense' && mapped.rows[0].payers).toEqual({ Asha: 10000n });
    expect(mapped.rows[0]?.issues.map((issue) => issue.code)).toEqual([
      ImportProblemKind.PayerEstimated,
    ]);
    expect(resolveDraft(draft, {}, group).rejected).toHaveLength(1);
  });

  it('computes percent, share and exact splits with the ledger’s own rules', () => {
    const people = ['A', 'B', 'C'];
    const draft = draftOf(people, [
      { amount: 10001n, split: { kind: 'percent', basisPoints: { A: 5000, B: 3000, C: 2000 } } },
      { amount: 10001n, split: { kind: 'shares', weights: { A: 2, B: 1, C: 0.5 } } },
      { amount: 10001n, split: { kind: 'exact', amounts: { A: 1n, B: 10000n } } },
    ]);
    const resolved = resolveDraft(draft, {}, group);
    expect(resolved.rejected).toEqual([]);
    for (const row of resolved.rows) {
      expect(row.kind === 'expense' && sum(row.shares)).toBe(10001n);
    }
  });

  it('rejects, rather than adjusts, a row whose parts do not add up', () => {
    const draft = draftOf(
      ['A', 'B'],
      [
        { split: { kind: 'exact', amounts: { A: 1n, B: 2n } } },
        { split: { kind: 'percent', basisPoints: { A: 5000, B: 4000 } } },
        { payers: { A: 1n, B: 2n } },
        { split: { kind: 'equal', among: ['A', 'Nobody'] } },
      ],
    );
    const resolved = resolveDraft(draft, {}, group);
    expect(resolved.rows).toEqual([]);
    expect(resolved.rejected.map((r) => r.issues.at(-1)?.code)).toEqual([
      ImportProblemKind.SplitDoesNotAddUp,
      ImportProblemKind.PercentNot100,
      ImportProblemKind.RowDoesNotBalance,
      ImportProblemKind.UnknownPerson,
    ]);
  });

  it('rejects rows that already carry an error issue', () => {
    const issue = {
      severity: 'error',
      code: ImportProblemKind.UnparseableRow,
      field: 'date',
      message: 'x',
    } as const;
    const resolved = resolveDraft(draftOf(['A'], [{ issues: [issue] }]), {}, group);
    expect(resolved.rejected).toHaveLength(1);
  });

  it('uses the group currency for a row that names none, and keeps balances per currency', () => {
    const draft = draftOf(['A', 'B'], [{ currency: null }, { currency: 'USD', amount: 500n }]);
    const resolved = resolveDraft(draft, {}, { groupCurrency: 'AED', members: [] });
    expect(resolved.rows.map((row) => row.currency)).toEqual(['AED', 'USD']);
    expect(Object.keys(resolved.balances).sort()).toEqual(['AED', 'USD']);
  });

  it('refuses a settlement between one person and themselves', () => {
    const draft = draftOf(
      ['A', 'B'],
      [
        { kind: 'settlement', split: null, payers: null, settlement: { from: 'A', to: 'A' } },
        { kind: 'settlement', split: null, payers: null, settlement: { from: 'A', to: 'B' } },
      ],
    );
    const resolved = resolveDraft(draft, {}, group);
    expect(resolved.rows).toHaveLength(1);
    expect(resolved.rejected).toHaveLength(1);
    expect(resolved.balances.INR).toEqual({ A: 10000n, B: -10000n });
  });
});

describe('resolveDraft on real files', () => {
  it('imports the Splitwise fixture to the balances the file states', () => {
    const draft = draftFromSplitwise(text('splitwise-export.csv'));
    const resolved = resolveDraft(draft, {}, group);
    expect(resolved.rejected).toEqual([]);
    expect(resolved.rows.filter((row) => row.kind === 'settlement')).toHaveLength(1);
    // Σ of each person's column, payment included: the numbers in the file's Total row,
    // recomputed (the file's own Total row is a fixture, not a promise).
    expect(resolved.balances.INR).toEqual({
      Asha: 2000000n + -61684n + -115000n + 500000n + 210000n,
      Bharath: -500000n + 123366n + -115000n + -500000n + -105000n,
      Chitra: -1500000n + -61682n + 230000n + 0n + -105000n,
    });
  });

  it('round-trips a Waves CSV export into balances that net to zero and the right payer totals', () => {
    const resolved = resolveDraft(draftFromWavesCsv(text('waves-export.csv')), {}, group);
    expect(resolved.rejected).toEqual([]);
    const book = resolved.balances.INR!;
    expect(sum(book)).toBe(0n);
    // Dinner: Asha paid 1200, each owes 400. Taxi: 300.01 paid by Asha and Bharath,
    // owed 150.00 by Asha and 150.01 by Chitra. Chitra paid Asha 200.
    expect(book.Chitra).toBe(-40000n - 15001n + 20000n);
    expect(book.Asha! + book.Bharath!).toBe(35001n);
  });

  it('resolves a generic sheet into balances that net to zero', () => {
    const draft = draftFromText(text('google-sheets.csv'), { country: 'IN' });
    const resolved = resolveDraft(draft, {}, group);
    expect(resolved.rejected).toEqual([]);
    expect(sum(resolved.balances.INR!)).toBe(0n);
  });
});

describe('Splitwise parity with the old reader', () => {
  // The reconstruction the two copies shared before they were unified.
  function oldReconstruct(nets: ReadonlyMap<string, bigint>, amount: bigint) {
    const creditors = [...nets.entries()]
      .filter(([, net]) => net > 0n)
      .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] > a[1] ? 1 : -1));
    const positive = creditors.reduce((total, [, net]) => total + net, 0n);
    const payers: Record<string, bigint> = {};
    if (positive === 0n) {
      const first = [...nets.keys()].sort()[0];
      if (first !== undefined) payers[first] = amount;
    } else {
      let handed = 0n;
      for (const [person, net] of creditors) {
        const paid = (amount * net) / positive;
        payers[person] = paid;
        handed += paid;
      }
      let remainder = amount - handed;
      const step = remainder < 0n ? -1n : 1n;
      for (let index = 0; remainder !== 0n && creditors.length > 0; index += 1) {
        const person = creditors[index % creditors.length]?.[0];
        if (person === undefined) break;
        payers[person] = (payers[person] ?? 0n) + step;
        remainder -= step;
      }
    }
    const shares: Record<string, bigint> = {};
    for (const [person, net] of nets) shares[person] = (payers[person] ?? 0n) - net;
    return { payers, shares };
  }

  it('reconstructs payers and shares exactly as before, for any nets that sum to zero', () => {
    fc.assert(
      fc.property(
        positiveAmounts(10n ** 8n),
        fc.array(fc.bigInt({ min: -(10n ** 7n), max: 10n ** 7n }), { minLength: 1, maxLength: 5 }),
        (amount, raw) => {
          const nets = new Map(raw.map((value, index) => [`P${index}`, value]));
          nets.set('Last', -raw.reduce((total, value) => total + value, 0n));
          expect(reconstructPayers(nets, amount)).toEqual(oldReconstruct(nets, amount));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('puts Payment rows in settlements and counts them in the balances', () => {
    const result = importSplitwiseCsv(text('splitwise-export.csv'));
    expect(result.problems).toEqual([]);
    expect(result.expenses.map((expense) => expense.description)).not.toContain('Payment');
    expect(result.settlements).toEqual([
      {
        from: 'Asha',
        to: 'Bharath',
        currency: 'INR',
        amount: 500000n,
        method: 'other',
        status: 'confirmed',
        note: 'Payment',
        at: '2026-02-09',
      },
    ]);
    expect(Object.values(result.balances).reduce((total, value) => total + value, 0n)).toBe(0n);
  });
});

describe('resolveDraft invariants (property)', () => {
  const splitFor = (people: string[]): fc.Arbitrary<DraftSplit> =>
    fc.oneof(
      fc.constant<DraftSplit>({ kind: 'equal', among: 'everyone' }),
      fc.subarray(people, { minLength: 1 }).map<DraftSplit>((among) => ({ kind: 'equal', among })),
      fc
        .array(fc.integer({ min: 1, max: 9 }), {
          minLength: people.length,
          maxLength: people.length,
        })
        .map<DraftSplit>((weights) => ({
          kind: 'shares',
          weights: Object.fromEntries(people.map((name, index) => [name, weights[index]!])),
        })),
      fc
        .array(fc.integer({ min: 0, max: 100 }), {
          minLength: people.length,
          maxLength: people.length,
        })
        .filter((weights) => weights.some((weight) => weight > 0))
        .map<DraftSplit>((weights) => {
          const total = weights.reduce((a, b) => a + b, 0);
          const basisPoints = weights.map((weight) => Math.floor((weight * 10000) / total));
          basisPoints[0] = basisPoints[0]! + (10000 - basisPoints.reduce((a, b) => a + b, 0));
          return {
            kind: 'percent',
            basisPoints: Object.fromEntries(
              people.map((name, index) => [name, basisPoints[index]!]),
            ),
          };
        }),
    );

  it('payers and shares always sum to the amount, and balances sum to zero', () => {
    const people = ['Asha', 'Bharath', 'Chitra', 'Dev'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amount: positiveAmounts(10n ** 9n),
            payer: fc.constantFrom(...people),
            split: splitFor(people),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        fc.boolean(),
        (specs, mergeTwo) => {
          const draft = draftOf(
            people,
            specs.map((spec) => ({
              amount: spec.amount,
              payers: { single: spec.payer },
              split: spec.split,
            })),
          );
          const mapping: Record<string, string> = mergeTwo ? { Asha: 'm1', Bharath: 'm1' } : {};
          const resolved = resolveDraft(draft, mapping, group);
          expect(resolved.rejected).toEqual([]);
          for (const row of resolved.rows) {
            if (row.kind !== 'expense') continue;
            expect(sum(row.payers)).toBe(row.amount);
            expect(sum(row.shares)).toBe(row.amount);
            expect(Object.values(row.shares).every((share) => share >= 0n)).toBe(true);
            expect(row.splitParams.amounts).toEqual(row.shares);
          }
          expect(sum(resolved.balances.INR ?? {})).toBe(0n);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('net rows reconstruct payers whose balances equal the nets', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -(10n ** 6n), max: 10n ** 6n }), { minLength: 1, maxLength: 5 }),
        (raw) => {
          const nets: Record<string, bigint> = Object.fromEntries(
            raw.map((value, index) => [`P${index}`, value]),
          );
          nets.Last = -raw.reduce((total, value) => total + value, 0n);
          const positive = Object.values(nets)
            .filter((net) => net > 0n)
            .reduce((total, net) => total + net, 0n);
          fc.pre(positive > 0n);
          const draft = draftOf(Object.keys(nets), [
            { amount: positive, payers: null, split: { kind: 'net', nets } },
          ]);
          const resolved = resolveDraft(draft, {}, group);
          expect(resolved.rejected).toEqual([]);
          const book = resolved.balances.INR!;
          for (const [name, net] of Object.entries(nets)) expect(book[name] ?? 0n).toBe(net);
        },
      ),
      { numRuns: 200 },
    );
  });
});
