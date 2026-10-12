/**
 * The per-group import's pure parts: the step machine, the name matching, the
 * review model and the payload it turns into. No renderer: the screens only draw
 * what these decide.
 */

import { describe, expect, it } from 'vitest';

import { detectLayout, draftFromTable, readTable, type CurrencyCode } from '@waves/core';

import { choiceForColumn, remapColumn } from '@/lib/groupImport/columns';
import { EXAMPLE_IDS, EXAMPLES } from '@/lib/groupImport/examples';
import { formatIsoDate, isIsoDay, minorToPlain } from '@/lib/groupImport/format';
import {
  INITIAL_STATE,
  reduce,
  stepBefore,
  type ImportAction,
  type ImportState,
} from '@/lib/groupImport/machine';
import { allMapped, matchByName, mergedGroups, type PersonOption } from '@/lib/groupImport/people';
import {
  applyRowEdit,
  buildPayload,
  buildReview,
  ensureIds,
  existingFromExpenses,
  rowsFor,
  type ReviewInput,
} from '@/lib/groupImport/review';
import type { ExpenseRow } from '@/data/types';

const INR = 'INR' as CurrencyCode;

const MEMBERS: PersonOption[] = [
  { id: 'm-me', name: 'Madan', isYou: true },
  { id: 'm-asha', name: 'Asha', isYou: false },
  { id: 'm-ravi', name: 'Ravi', isYou: false },
];

function load(text: string) {
  const table = readTable(text);
  const layout = detectLayout(table, { members: MEMBERS.map((m) => m.name) });
  const draft = draftFromTable(table, layout, { defaultCurrency: INR, today: '2026-10-12' });
  return { table, layout, draft };
}

const run = (actions: ImportAction[], from: ImportState = INITIAL_STATE): ImportState =>
  actions.reduce(reduce, from);

function reviewOf(text: string, overrides: Partial<ReviewInput> = {}) {
  const { draft } = load(text);
  const mapping: Record<string, string> = {};
  for (const person of draft.people) {
    mapping[person] = MEMBERS.find((m) => m.name === person)?.id ?? 'ghost';
  }
  return buildReview({
    draft,
    edits: {},
    mapping,
    members: MEMBERS.map((m) => ({ id: m.id, name: m.name })),
    groupCurrency: INR,
    importerMemberId: 'm-me',
    existing: [],
    ticks: {},
    ...overrides,
  });
}

describe('the examples', () => {
  it('every example reads back through the same pipeline a picked file takes', () => {
    for (const id of EXAMPLE_IDS) {
      const { draft } = load(EXAMPLES[id]);
      expect(draft.fileProblems, id).toEqual([]);
      expect(draft.rows.length, id).toBe(2);
      expect(
        draft.rows.every((row) => row.issues.every((issue) => issue.severity !== 'error')),
        id,
      ).toBe(true);
    }
  });

  it('the Splitwise example is recognised as a Splitwise file, so Columns is skipped', () => {
    expect(load(EXAMPLES.splitwise).layout.kind).toBe('splitwise');
    expect(load(EXAMPLES.simple).layout.kind).toBe('generic');
  });
});

describe('the step machine', () => {
  const loadedGeneric = () => {
    const { table, layout } = load(EXAMPLES.simple);
    return run([{ type: 'loaded', fileName: 'a.csv', fileKind: 'csv', table, layout }]);
  };

  it('starts a plain spreadsheet at Columns and a Splitwise export at People', () => {
    expect(loadedGeneric().step).toBe('columns');
    const { table, layout } = load(EXAMPLES.splitwise);
    const state = run([{ type: 'loaded', fileName: 's.csv', fileKind: 'csv', table, layout }]);
    expect(state.step).toBe('people');
    expect(state.needsColumns).toBe(false);
  });

  it('goes back the way the person came, skipping Columns when it was skipped', () => {
    const { table, layout } = load(EXAMPLES.splitwise);
    const splitwise = run([
      { type: 'loaded', fileName: 's.csv', fileKind: 'csv', table, layout },
      { type: 'toReview' },
      { type: 'back' },
    ]);
    expect(splitwise.step).toBe('people');
    expect(reduce(splitwise, { type: 'back' }).step).toBe('source');

    const generic = run(
      [{ type: 'toPeople', people: ['Asha'], matches: {} }, { type: 'back' }],
      loadedGeneric(),
    );
    expect(generic.step).toBe('columns');
  });

  it('keeps an answer when the columns change under it, and drops names that are gone', () => {
    const state = run(
      [
        { type: 'toPeople', people: ['Asha', 'Ravi'], matches: { Asha: 'm-asha' } },
        { type: 'mapPerson', name: 'Ravi', target: 'ghost' },
        { type: 'toPeople', people: ['Asha', 'Meera'], matches: { Asha: 'm-asha' } },
      ],
      loadedGeneric(),
    );
    expect(state.mapping).toEqual({ Asha: 'm-asha' });
    expect(state.matched).toEqual({ Asha: true });
  });

  it('badges only the names the app matched, and clears the badge on a manual choice', () => {
    const matched = run(
      [{ type: 'toPeople', people: ['Asha', 'Ravi'], matches: { Asha: 'm-asha' } }],
      loadedGeneric(),
    );
    expect(matched.matched).toEqual({ Asha: true });
    expect(allMapped(['Asha', 'Ravi'], matched.mapping)).toBe(false);

    const chosen = run(
      [
        { type: 'mapPerson', name: 'Asha', target: 'm-ravi' },
        { type: 'mapRestAsNew', people: ['Asha', 'Ravi'] },
      ],
      matched,
    );
    expect(chosen.matched).toEqual({});
    expect(chosen.mapping).toEqual({ Asha: 'm-ravi', Ravi: 'ghost' });
    expect(allMapped(['Asha', 'Ravi'], chosen.mapping)).toBe(true);
  });

  it('keeps the batch and row ids once an import has started, so a retry replays', () => {
    const first = run(
      [{ type: 'commitStarted', batchId: 'batch-1', ids: { a: 'id-a' } }],
      loadedGeneric(),
    );
    const again = reduce(first, {
      type: 'commitStarted',
      batchId: 'batch-2',
      ids: { a: 'other', b: 'id-b' },
    });
    expect(again.batchId).toBe('batch-1');
    expect(again.ids).toEqual({ a: 'id-a', b: 'id-b' });
    expect(again.step).toBe('commit');
  });

  it('forgets the batch when the person leaves a failed import for the review', () => {
    const state = run(
      [
        { type: 'commitStarted', batchId: 'batch-1', ids: { a: 'id-a' } },
        { type: 'commitAbandoned' },
      ],
      loadedGeneric(),
    );
    expect(state.step).toBe('review');
    expect(state.batchId).toBeNull();
    expect(state.ids).toEqual({});
  });

  it('offers an edited row ticked, and lets the person clear their edit', () => {
    const edited = run(
      [{ type: 'editRow', key: 'csv:2', edit: { description: 'Fixed' } }],
      loadedGeneric(),
    );
    expect(edited.ticks['csv:2']).toBe(true);
    expect(edited.edits['csv:2']).toEqual({ description: 'Fixed' });
    expect(reduce(edited, { type: 'clearEdit', key: 'csv:2' }).edits).toEqual({});
  });

  it('does not go back from the commit or result steps, and restart returns to the start', () => {
    const committing = run([{ type: 'commitStarted', batchId: 'b', ids: {} }], loadedGeneric());
    expect(reduce(committing, { type: 'back' }).step).toBe('commit');
    expect(stepBefore({ ...committing, step: 'review' })).toBe('people');
    expect(reduce(committing, { type: 'restart' })).toEqual(INITIAL_STATE);
  });

  it('opens and closes the sheets without touching the step', () => {
    const open = reduce(INITIAL_STATE, { type: 'openSheet', sheet: 'upsell' });
    expect(open).toMatchObject({ sheet: 'upsell', step: 'source' });
    expect(reduce(open, { type: 'closeSheet' }).sheet).toBeNull();
  });
});

describe('the columns step', () => {
  const simple = () => load(EXAMPLES.simple);

  it('reports what the layout says about each column', () => {
    const { layout } = simple();
    expect(choiceForColumn(layout, 0)).toBe('date');
    expect(choiceForColumn(layout, 2)).toBe('amount');
    expect(choiceForColumn(layout, 3)).toBe('paid_by');
  });

  it('moves a job to the new column and frees the old one', () => {
    const { table, layout } = simple();
    const header = table.rows[layout.headerRow]!;
    const moved = remapColumn(layout, header, 1, 'amount');
    expect(choiceForColumn(moved, 1)).toBe('amount');
    expect(choiceForColumn(moved, 2)).toBe('ignore');
  });

  it('can turn a column into a person column, named by its heading', () => {
    const { table, layout } = simple();
    const header = table.rows[layout.headerRow]!;
    const next = remapColumn(layout, header, 3, 'person');
    expect(next.personColumns).toEqual([{ name: 'Paid by', column: 3 }]);
    expect(choiceForColumn(next, 3)).toBe('person');
  });

  it('a corrected layout changes what the reader makes of the file', () => {
    const text = 'When,Thing,Spent,Who\n2026-10-01,Tea,50,Asha';
    const table = readTable(text);
    const layout = detectLayout(table, {});
    const fixed = remapColumn(layout, table.rows[0]!, 3, 'paid_by');
    const draft = draftFromTable(table, fixed, { defaultCurrency: INR });
    expect(draft.people).toEqual(['Asha']);
  });
});

describe('matching names to members', () => {
  it('matches only an exact, unique name, ignoring case, spacing and accents', () => {
    expect(matchByName(['asha ', 'RAVI', 'Meera', 'Mádan'], MEMBERS)).toEqual({
      'asha ': 'm-asha',
      RAVI: 'm-ravi',
      Mádan: 'm-me',
    });
  });

  it('leaves a name unmatched when two members share it', () => {
    const twins: PersonOption[] = [
      { id: 'a', name: 'Sam', isYou: false },
      { id: 'b', name: 'Sam', isYou: false },
    ];
    expect(matchByName(['Sam'], twins)).toEqual({});
  });

  it('never gives one member to two names on its own', () => {
    expect(matchByName(['Asha', 'asha'], MEMBERS)).toEqual({ Asha: 'm-asha' });
  });

  it('names the people who will be merged', () => {
    expect(
      mergedGroups(['Ravi', 'R. Kumar', 'Meera'], {
        Ravi: 'm-ravi',
        'R. Kumar': 'm-ravi',
        Meera: 'ghost',
      }),
    ).toEqual([['Ravi', 'R. Kumar']]);
  });
});

describe('the review', () => {
  const FILE = [
    'Date,Description,Amount,Paid by,Split between',
    '2026-10-01,Dinner,900,Asha,"Asha; Ravi; Madan"',
    '2026-10-02,Cab,300,Ravi,',
    '2026-10-03,Broken,abc,Ravi,',
  ].join('\n');

  it('splits the rows into those that will import and those that will not', () => {
    const review = reviewOf(FILE);
    expect(review.rows.map((row) => [row.description, row.status])).toEqual([
      ['Dinner', 'ok'],
      ['Cab', 'ok'],
      ['Broken', 'wont'],
    ]);
    expect(review.counts).toMatchObject({ all: 3, wont: 1, attention: 0, duplicates: 0 });
    const broken = review.rows[2]!;
    expect(broken.selectable).toBe(false);
    expect(broken.ticked).toBe(false);
    expect(broken.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('never selects an error row, even when it is asked to', () => {
    const review = reviewOf(FILE, { ticks: { 'csv:4': true } });
    expect(review.rows[2]!.ticked).toBe(false);
    expect(review.selected.map((row) => row.key)).toEqual(['csv:2', 'csv:3']);
  });

  it('summarises only what is ticked', () => {
    const all = reviewOf(FILE);
    expect(all.summary).toMatchObject({
      expenses: 2,
      settlements: 0,
      total: 120000n,
      firstDate: '2026-10-01',
      lastDate: '2026-10-02',
      left: 1,
    });
    const fewer = reviewOf(FILE, { ticks: { 'csv:3': false } });
    expect(fewer.summary.expenses).toBe(1);
    expect(fewer.summary.total).toBe(90000n);
  });

  it('shows what the import does to each balance, and the changes sum to zero', () => {
    const review = reviewOf(FILE);
    const byName = Object.fromEntries(review.changes.map((change) => [change.name, change.net]));
    // Dinner 900 paid by Asha, 300 each: Asha +600, Ravi -300, Madan -300.
    // Cab 300 paid by Ravi, split three ways, 100 each: Ravi +200, Asha -100, Madan -100.
    expect(byName).toEqual({ Asha: 50000n, Ravi: -10000n, Madan: -40000n });
    expect(review.changes.reduce((sum, change) => sum + change.net, 0n)).toBe(0n);
  });

  it('flags a row that looks like one already in the group, and leaves a likely one unticked', () => {
    const existing = existingFromExpenses([
      {
        id: 'e1',
        group_id: 'g',
        deleted_at: null,
        created_at: '2026-10-01',
        currentVersion: {
          expense_date: '2026-10-01',
          currency: 'INR',
          amount: '90000',
          description: 'Dinner',
        },
      },
      {
        id: 'gone',
        group_id: 'g',
        deleted_at: '2026-10-02',
        created_at: '2026-10-01',
        currentVersion: {
          expense_date: '2026-10-02',
          currency: 'INR',
          amount: '30000',
          description: 'Cab',
        },
      },
    ] as unknown as ExpenseRow[]);
    expect(existing.map((e) => e.id)).toEqual(['e1']);

    const review = reviewOf(FILE, { existing });
    const dinner = review.rows[0]!;
    expect(dinner.status).toBe('duplicate');
    expect(dinner.duplicate?.level).toBe('likely');
    expect(dinner.ticked).toBe(false);
    expect(rowsFor(review, 'duplicates').map((row) => row.description)).toEqual(['Dinner']);
    // The person can still tick it.
    expect(reviewOf(FILE, { existing, ticks: { 'csv:2': true } }).rows[0]!.ticked).toBe(true);
  });

  it('marks a bill in another currency as needing attention', () => {
    const review = reviewOf(
      'Date,Description,Amount,Currency,Paid by\n2026-10-01,Taxi,20,USD,Asha',
    );
    expect(review.rows[0]).toMatchObject({ status: 'attention', foreign: true });
    expect(review.summary.otherCurrency).toBe(1);
    expect(review.summary.total).toBe(0n);
    expect(review.changes).toEqual([]);
  });

  it('applies an edit so a row that could not be read can be fixed', () => {
    const { draft } = load(FILE);
    const broken = draft.rows[2]!;
    const fixed = applyRowEdit(broken, { amount: 5000n, description: 'Snacks' });
    expect(fixed.issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(fixed.description).toBe('Snacks');

    const review = reviewOf(FILE, { edits: { [broken.key]: { amount: 5000n } } });
    // Fixed, but the file never said who paid, so it is recorded as the importer and flagged.
    expect(review.rows[2]).toMatchObject({ status: 'attention', ticked: true, edited: true });
    expect(review.counts.wont).toBe(0);
  });

  it('turns an exact split into an equal one when the amount is edited, so it still adds up', () => {
    const { draft } = load(
      'Date,Description,Amount,Paid by,Split between\n2026-10-01,Meal,600,Asha,Asha:200;Ravi:400',
    );
    const row = draft.rows[0]!;
    expect(row.split?.kind).toBe('exact');
    const edited = applyRowEdit(row, { amount: 900n });
    expect(edited.split).toEqual({ kind: 'equal', among: ['Asha', 'Ravi'] });
  });
});

describe('the payload', () => {
  const FILE = [
    'Date,Description,Amount,Paid by,Split between',
    '2026-10-01,Dinner,900,Asha,"Asha; Ravi; Meera"',
    '2026-10-02,Lunch,300,Meera,',
  ].join('\n');

  let counter = 0;
  const make = (): string => `id-${(counter += 1)}`;

  it('carries only the ticked rows, with new people only where a ticked row needs them', () => {
    const review = reviewOf(FILE, { ticks: { 'csv:2': false } });
    const ids = ensureIds(
      review.selected.map((row) => row.key),
      {},
      make,
    );
    const payload = buildPayload(review, ids, make);

    expect(payload.expenses.map((e) => e.description)).toEqual(['Lunch']);
    // Meera paid Lunch, and "everyone" is the group plus Meera.
    expect(payload.people.find((p) => p.name === 'Meera')).toEqual({
      name: 'Meera',
      memberId: null,
    });
    expect(payload.people.find((p) => p.name === 'Asha')).toEqual({
      name: 'Asha',
      memberId: 'm-asha',
    });
    const lunch = payload.expenses[0]!;
    expect(lunch.amount).toBe(30000n);
    expect(Object.values(lunch.shares).reduce((a, b) => a + b, 0n)).toBe(30000n);
    expect(Object.values(lunch.payers).reduce((a, b) => a + b, 0n)).toBe(30000n);
  });

  it('leaves out a new person that only the unticked rows mention', () => {
    const only =
      'Date,Description,Amount,Paid by,Split between\n2026-10-01,Dinner,900,Asha,"Asha; Ravi"\n2026-10-02,Gift,300,Zed,"Zed; Asha"';
    const review = reviewOf(only, { ticks: { 'csv:3': false } });
    const payload = buildPayload(review, ensureIds(['csv:2'], {}, make), make);
    expect(payload.people.map((p) => p.name).sort()).toEqual(['Asha', 'Ravi']);
  });

  it('marks an equal split so the server can store it as one', () => {
    const payload = buildPayload(reviewOf(FILE), ensureIds(['csv:2', 'csv:3'], {}, make), make);
    expect(payload.expenses.map((e) => e.splitHint)).toEqual(['equal', 'equal']);
  });

  it('records a Splitwise payment as a settlement, with the people on both sides named', () => {
    const text = [
      'Date,Description,Category,Cost,Currency,Asha,Ravi',
      '2026-10-01,Dinner,Dining out,1000.00,INR,500.00,-500.00',
      '2026-10-02,Asha paid Ravi,Payment,500.00,INR,500.00,-500.00',
    ].join('\n');
    const review = reviewOf(text);
    const payload = buildPayload(
      review,
      ensureIds(
        review.selected.map((r) => r.key),
        {},
        make,
      ),
      make,
    );
    expect(payload.expenses).toHaveLength(1);
    expect(payload.expenses[0]!.splitHint).toBeUndefined();
    expect(payload.settlements).toHaveLength(1);
    expect(payload.settlements[0]).toMatchObject({
      from: 'Asha',
      to: 'Ravi',
      amount: 50000n,
      method: 'other',
      status: 'confirmed',
    });
  });

  it('reuses the ids it was given, so a retry sends the same rows', () => {
    const review = reviewOf(FILE);
    const keys = review.selected.map((row) => row.key);
    const first = ensureIds(keys, {}, make);
    const second = ensureIds(keys, first, make);
    expect(second).toEqual(first);
    const a = buildPayload(review, first, make).expenses.map((e) => e.clientMutationId);
    const b = buildPayload(review, second, make).expenses.map((e) => e.clientMutationId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('formatting', () => {
  it('reads an ISO day as a calendar day, in any zone', () => {
    expect(formatIsoDate('2026-10-01', 'en-IN')).toBe('1 Oct');
    expect(formatIsoDate('2026-10-01', 'en-IN', true)).toBe('1 Oct 2026');
    expect(formatIsoDate('nonsense', 'en-IN')).toBe('nonsense');
  });

  it('writes minor units back as plain digits for an amount field', () => {
    expect(minorToPlain(123456n, INR)).toBe('1234.56');
    expect(minorToPlain(5n, INR)).toBe('0.05');
    expect(minorToPlain(1200n, 'JPY' as CurrencyCode)).toBe('1200');
  });

  it('knows a real day from an impossible one', () => {
    expect(isIsoDay('2026-02-28')).toBe(true);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('1/2/2026')).toBe(false);
  });
});
