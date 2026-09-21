/**
 * Per-field merge for the personal ledger.
 *
 * The scenario every test here is really about: one ledger, two devices, both
 * of them right. Somebody fixes an amount on their phone while the same record
 * is being re-categorised on a tablet. Today the second sync to land replaces
 * the whole blob and one of those edits is gone — no conflict, no warning, no
 * trace. These pin the rule that keeps both.
 *
 * The three properties at the end are the ones that actually matter. A merge
 * that is not commutative, associative and idempotent does not converge, which
 * means two devices holding the same history can show different numbers, and a
 * replayed offline queue can change the answer. They are checked with
 * fast-check rather than examples because the failures live in the orderings
 * nobody thinks to write down.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  adoptUnstampedEdits,
  CLOCK_SKEW_TOLERANCE_MS,
  emptyTwoPhaseSet,
  FIELD_META_KEY,
  mergeAllFields,
  mergeFields,
  mergeTwoPhaseSets,
  readFieldMeta,
  stampFields,
  stripFieldMeta,
  twoPhaseAdd,
  twoPhaseHas,
  twoPhaseMembers,
  twoPhaseRemove,
  readTwoPhaseSet,
  type StampedData,
} from '../src/sync/lww';
import { decodeTxn, encodeTxn } from '../src/personal/types';

/** A blob with stamps, written out the way the tests read best. */
function blob(
  fields: Record<string, unknown>,
  meta: Record<string, { t: number; d: string }> = {},
): StampedData {
  return Object.keys(meta).length > 0 ? { ...fields, [FIELD_META_KEY]: meta } : { ...fields };
}

describe('the collision this exists for', () => {
  it('keeps both edits when two devices changed different fields', () => {
    // The stored record, as both devices last saw it.
    const stored = blob(
      { amount: '649.00', note: 'Netflix', kind: 'expense' },
      {
        amount: { t: 1000, d: 'phone' },
        note: { t: 1000, d: 'phone' },
        kind: { t: 1000, d: 'phone' },
      },
    );

    // The phone corrects the amount.
    const fromPhone = stampFields(
      stored,
      { ...stripFieldMeta(stored), amount: '699.00' },
      {
        now: 2000,
        deviceId: 'phone',
      },
    );
    // The tablet, in the same minute, re-categorises it.
    const fromTablet = stampFields(
      stored,
      { ...stripFieldMeta(stored), kind: 'subscription' },
      {
        now: 2001,
        deviceId: 'tablet',
      },
    );

    const merged = mergeFields(fromPhone, fromTablet);

    expect(merged.amount).toBe('699.00');
    expect(merged.kind).toBe('subscription');
    expect(merged.note).toBe('Netflix');
  });

  it('is the whole-record overwrite it replaces, if you merge without stamps', () => {
    // Stated as a test so the bug being fixed is in the file too. Without any
    // meta every field ties at time zero and the merge falls through to the
    // value tiebreak — deterministic, but arbitrary, which is exactly the
    // behaviour the stamps buy their way out of.
    const a = blob({ amount: '699.00', kind: 'expense' });
    const b = blob({ amount: '649.00', kind: 'subscription' });
    expect(mergeFields(a, b)).toEqual(mergeFields(b, a));
  });
});

describe('the merge rule, field by field', () => {
  it('newest wins', () => {
    const older = blob({ amount: '1' }, { amount: { t: 10, d: 'a' } });
    const newer = blob({ amount: '2' }, { amount: { t: 11, d: 'a' } });
    expect(mergeFields(older, newer).amount).toBe('2');
    expect(mergeFields(newer, older).amount).toBe('2');
  });

  it('the same instant is broken by the higher device id', () => {
    const fromA = blob({ amount: '1' }, { amount: { t: 10, d: 'device-a' } });
    const fromB = blob({ amount: '2' }, { amount: { t: 10, d: 'device-b' } });
    expect(mergeFields(fromA, fromB).amount).toBe('2');
    expect(mergeFields(fromB, fromA).amount).toBe('2');
  });

  it('the same instant AND the same device falls through to the value', () => {
    // One device writing twice inside a millisecond. Rare, and still not
    // allowed to make two peers disagree.
    const first = blob({ note: 'aaa' }, { note: { t: 10, d: 'a' } });
    const second = blob({ note: 'bbb' }, { note: { t: 10, d: 'a' } });
    expect(mergeFields(first, second)).toEqual(mergeFields(second, first));
  });

  it('a field present on one side only survives', () => {
    const withIt = blob({ amount: '1', merchantId: 'svc.netflix' }, { amount: { t: 5, d: 'a' } });
    const without = blob({ amount: '1' }, { amount: { t: 5, d: 'a' } });
    expect(mergeFields(withIt, without).merchantId).toBe('svc.netflix');
    expect(mergeFields(without, withIt).merchantId).toBe('svc.netflix');
  });

  it('a field with no stamp is treated as time zero, so a real write beats it', () => {
    // The migration case: one device is still writing blobs with no `_meta`.
    const unstamped = blob({ amount: 'old' });
    const stamped = blob({ amount: 'new' }, { amount: { t: 1, d: 'a' } });
    expect(mergeFields(unstamped, stamped).amount).toBe('new');
    expect(mergeFields(stamped, unstamped).amount).toBe('new');
  });

  it('but an unstamped field still beats a field that is not there at all', () => {
    const unstamped = blob({ note: 'kept' });
    expect(mergeFields(unstamped, blob({})).note).toBe('kept');
    expect(mergeFields(blob({}), unstamped).note).toBe('kept');
  });

  it('carries the winner’s stamp, not the loser’s', () => {
    const a = blob({ amount: '1' }, { amount: { t: 10, d: 'a' } });
    const b = blob({ amount: '2' }, { amount: { t: 20, d: 'b' } });
    expect(readFieldMeta(mergeFields(a, b)).amount).toEqual({ t: 20, d: 'b' });
  });

  it('never keeps a stamp for a field that is not in the result', () => {
    const orphaned = { amount: '1', [FIELD_META_KEY]: { gone: { t: 99, d: 'a' } } };
    const merged = mergeFields(orphaned, blob({}));
    expect(readFieldMeta(merged).gone).toBeUndefined();
    expect(merged.amount).toBe('1');
  });

  it('an explicit null is a value that can win, not an absence', () => {
    const cleared = blob({ note: null }, { note: { t: 20, d: 'a' } });
    const written = blob({ note: 'something' }, { note: { t: 10, d: 'a' } });
    expect(mergeFields(cleared, written).note).toBeNull();
  });

  it('merges a list in any order to the same answer', () => {
    const one = blob({ a: 1 }, { a: { t: 1, d: 'x' } });
    const two = blob({ b: 2 }, { b: { t: 2, d: 'y' } });
    const three = blob({ a: 9 }, { a: { t: 3, d: 'z' } });
    expect(mergeAllFields([one, two, three])).toEqual(mergeAllFields([three, one, two]));
    expect(mergeAllFields([one, two, three]).a).toBe(9);
  });
});

describe('clocks that are wrong', () => {
  const NOW = 1_800_000_000_000;
  const YEAR = 365 * 24 * 60 * 60 * 1000;

  it('a device a year fast would otherwise own the field forever', () => {
    const skewed = blob({ amount: 'from the future' }, { amount: { t: NOW + YEAR, d: 'broken' } });
    const honest = blob({ amount: 'correct' }, { amount: { t: NOW, d: 'good' } });

    // Unclamped — no `now` supplied — the broken clock simply wins.
    expect(mergeFields(skewed, honest).amount).toBe('from the future');
  });

  it('clamps an implausible future to now + the tolerance', () => {
    const skewed = blob({ amount: 'from the future' }, { amount: { t: NOW + YEAR, d: 'broken' } });
    const merged = mergeFields(skewed, blob({}), { now: NOW });
    expect(readFieldMeta(merged).amount).toEqual({
      t: NOW + CLOCK_SKEW_TOLERANCE_MS,
      d: 'broken',
    });
  });

  it('so an honest device takes the field back within the tolerance window', () => {
    const skewed = blob({ amount: 'from the future' }, { amount: { t: NOW + YEAR, d: 'broken' } });
    const folded = mergeFields(skewed, blob({}), { now: NOW });

    const later = blob(
      { amount: 'correct' },
      { amount: { t: NOW + CLOCK_SKEW_TOLERANCE_MS + 1, d: 'good' } },
    );
    expect(mergeFields(folded, later, { now: NOW + CLOCK_SKEW_TOLERANCE_MS + 1 }).amount).toBe(
      'correct',
    );
  });

  it('and the very next local edit beats it without waiting at all', () => {
    // The real cure for skew is not the clamp on its own — it is that a device
    // editing a record always stamps above that record's high water mark.
    const skewed = blob({ amount: 'from the future' }, { amount: { t: NOW + YEAR, d: 'broken' } });
    const folded = mergeFields(skewed, blob({}), { now: NOW });

    const edited = stampFields(
      folded,
      { amount: 'corrected by hand' },
      {
        now: NOW,
        deviceId: 'good',
      },
    );
    expect(mergeFields(folded, edited, { now: NOW }).amount).toBe('corrected by hand');
  });

  it('a device whose clock is BEHIND still wins its own edit', () => {
    // The phone that was in a drawer and thinks it is an hour ago. Its edit
    // must not lose to the value it is editing, or the app looks like it threw
    // the change away.
    const stored = blob({ amount: 'stored' }, { amount: { t: NOW, d: 'other' } });
    const edited = stampFields(
      stored,
      { amount: 'edited on the slow phone' },
      {
        now: NOW - 60 * 60 * 1000,
        deviceId: 'slow',
      },
    );
    expect(readFieldMeta(edited).amount?.t).toBe(NOW + 1);
    expect(mergeFields(stored, edited).amount).toBe('edited on the slow phone');
  });
});

describe('stamping an edit', () => {
  const stored = blob(
    { amount: '100', note: 'lunch', date: '2026-09-01' },
    {
      amount: { t: 500, d: 'old' },
      note: { t: 500, d: 'old' },
      date: { t: 500, d: 'old' },
    },
  );

  it('only restamps what actually changed', () => {
    const next = stampFields(
      stored,
      { ...stripFieldMeta(stored), amount: '120' },
      {
        now: 9000,
        deviceId: 'phone',
      },
    );
    const meta = readFieldMeta(next);
    expect(meta.amount).toEqual({ t: 9000, d: 'phone' });
    expect(meta.note).toEqual({ t: 500, d: 'old' });
    expect(meta.date).toEqual({ t: 500, d: 'old' });
  });

  it('stamps a field that is new, and one that was cleared', () => {
    const next = stampFields(
      stored,
      { ...stripFieldMeta(stored), note: null, category: 'food' },
      { now: 9000, deviceId: 'phone' },
    );
    const meta = readFieldMeta(next);
    expect(meta.note).toEqual({ t: 9000, d: 'phone' });
    expect(meta.category).toEqual({ t: 9000, d: 'phone' });
    expect(meta.amount).toEqual({ t: 500, d: 'old' });
  });

  it('stamps everything on a create', () => {
    const created = stampFields(
      null,
      { amount: '100', note: 'lunch' },
      {
        now: 9000,
        deviceId: 'phone',
      },
    );
    expect(readFieldMeta(created)).toEqual({
      amount: { t: 9000, d: 'phone' },
      note: { t: 9000, d: 'phone' },
    });
  });

  it('takes the newer of the stored meta and the meta the payload carried', () => {
    // `next` usually came out of decode-then-encode, which round-trips `_meta`
    // through `carried`. If that copy is fresher than the stored row's, it wins.
    const fresher = blob(
      { amount: '100', note: 'lunch', date: '2026-09-01' },
      {
        note: { t: 4000, d: 'tablet' },
      },
    );
    const next = stampFields(stored, fresher, { now: 9000, deviceId: 'phone' });
    expect(readFieldMeta(next).note).toEqual({ t: 4000, d: 'tablet' });
  });

  it('drops a field the edit left out, along with its stamp', () => {
    const next = stampFields(stored, { amount: '100' }, { now: 9000, deviceId: 'phone' });
    expect('note' in next).toBe(false);
    expect(readFieldMeta(next).note).toBeUndefined();
  });
});

describe('an app version that has never heard of _meta', () => {
  it('round-trips the stamps through `carried` instead of deleting them', () => {
    // This is the claim the storage shape rests on. `personal/types.ts` keeps
    // unrecognised keys in `carried` and writes them back, so `_meta` survives
    // a decode/edit/encode on an older build — which is what makes rolling this
    // out without a flag day possible.
    const written = stampFields(
      null,
      { kind: 'expense', amount: '649.00', currency: 'INR', note: 'Netflix', date: '2026-09-21' },
      { now: 7000, deviceId: 'new-phone' },
    );

    const decoded = decodeTxn('t1', written);
    const reencoded = encodeTxn({ ...decoded, note: 'Netflix (old phone edited this)' });

    expect(readFieldMeta(reencoded)).toEqual(readFieldMeta(written));
  });
});

describe('reading a blob defensively', () => {
  it('ignores meta that is not a map of stamps', () => {
    expect(readFieldMeta({ [FIELD_META_KEY]: 'nonsense' })).toEqual({});
    expect(readFieldMeta({ [FIELD_META_KEY]: [1, 2] })).toEqual({});
    expect(readFieldMeta(null)).toEqual({});
    expect(readFieldMeta(undefined)).toEqual({});
  });

  it('drops individual entries that are malformed', () => {
    const meta = readFieldMeta({
      [FIELD_META_KEY]: {
        good: { t: 5, d: 'a' },
        noTime: { d: 'a' },
        notFinite: { t: Number.NaN, d: 'a' },
        notAnObject: 7,
        noDevice: { t: 9 },
      },
    });
    expect(meta).toEqual({ good: { t: 5, d: 'a' }, noDevice: { t: 9, d: '' } });
  });

  it('strips the stamps when a caller wants the record alone', () => {
    const data = blob({ amount: '1' }, { amount: { t: 5, d: 'a' } });
    expect(stripFieldMeta(data)).toEqual({ amount: '1' });
  });
});

// ─────────────────────────────────────────────────────── the properties ──

const fieldName = fc.constantFrom('amount', 'note', 'kind', 'date', 'category');
const fieldValue = fc.oneof(
  fc.string({ maxLength: 6 }),
  fc.integer({ min: -5, max: 5 }),
  fc.boolean(),
  fc.constant(null),
);
const stampArb = fc.record({
  t: fc.integer({ min: 0, max: 30 }),
  d: fc.constantFrom('a', 'b', 'c'),
});

/** A record's `data` as some device might hold it: a few fields, some of them
 *  stamped and some of them not, because half the fleet is still on a build
 *  that writes no `_meta` at all. */
const blobArb: fc.Arbitrary<StampedData> = fc
  .dictionary(fieldName, fc.record({ v: fieldValue, s: fc.option(stampArb, { nil: undefined }) }), {
    maxKeys: 5,
  })
  .map((entries) => {
    const fields: Record<string, unknown> = {};
    const meta: Record<string, { t: number; d: string }> = {};
    for (const [key, entry] of Object.entries(entries)) {
      fields[key] = entry.v;
      if (entry.s) meta[key] = entry.s;
    }
    return blob(fields, meta);
  });

describe('the properties that make it converge', () => {
  it('is commutative: merge order does not change the answer', () => {
    fc.assert(
      fc.property(blobArb, blobArb, (a, b) => {
        expect(mergeFields(a, b)).toEqual(mergeFields(b, a));
      }),
      { numRuns: 500 },
    );
  });

  it('is associative: how the merges are bracketed does not change the answer', () => {
    fc.assert(
      fc.property(blobArb, blobArb, blobArb, (a, b, c) => {
        expect(mergeFields(mergeFields(a, b), c)).toEqual(mergeFields(a, mergeFields(b, c)));
      }),
      { numRuns: 500 },
    );
  });

  it('is idempotent: merging the same thing again changes nothing', () => {
    fc.assert(
      fc.property(blobArb, blobArb, (a, b) => {
        const merged = mergeFields(a, b);
        expect(mergeFields(merged, merged)).toEqual(merged);
        expect(mergeFields(merged, a)).toEqual(merged);
        expect(mergeFields(merged, b)).toEqual(merged);
      }),
      { numRuns: 500 },
    );
  });

  it('settles on one answer however a batch of versions arrives', () => {
    // The scenario, rather than the algebra: five devices, five orders of
    // arrival, one ledger. Every device must end up reading the same record.
    fc.assert(
      fc.property(
        fc.array(blobArb, { minLength: 2, maxLength: 5 }),
        fc.array(fc.integer(), { minLength: 5, maxLength: 5 }),
        (versions, shuffleKeys) => {
          const shuffled = versions
            .map((version, index) => ({ version, key: shuffleKeys[index] ?? index }))
            .sort((x, y) => x.key - y.key)
            .map((entry) => entry.version);
          expect(mergeAllFields(shuffled)).toEqual(mergeAllFields(versions));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('holds all three with the clock clamp switched on', () => {
    // Clamping is a monotone map applied to both sides with the same `now`, so
    // it must not disturb any of the three. Pinned, because it would be an easy
    // thing to break later.
    const now = 20;
    fc.assert(
      fc.property(blobArb, blobArb, blobArb, (a, b, c) => {
        const o = { now, skewToleranceMs: 2 };
        expect(mergeFields(a, b, o)).toEqual(mergeFields(b, a, o));
        expect(mergeFields(mergeFields(a, b, o), c, o)).toEqual(
          mergeFields(a, mergeFields(b, c, o), o),
        );
        const merged = mergeFields(a, b, o);
        expect(mergeFields(merged, merged, o)).toEqual(merged);
      }),
      { numRuns: 500 },
    );
  });
});

describe('a client that does not stamp its own edits', () => {
  const SERVER = { now: 5000, deviceId: 'server' };

  it('keeps the field it changed, and does NOT clobber the one it was carrying', () => {
    // The whole reason the server adopts edits. The tablet corrected the note
    // while this phone was offline; the phone comes back with the amount it
    // changed and the note as it last saw it, and no stamps of its own.
    const stored = blob(
      { amount: '100', note: 'corrected by the tablet' },
      { amount: { t: 500, d: 'phone' }, note: { t: 700, d: 'tablet' } },
    );
    // The phone carried the stamps it last synced — note still at 500.
    const fromPhone = blob(
      { amount: '120', note: 'the old note' },
      { amount: { t: 500, d: 'phone' }, note: { t: 500, d: 'phone' } },
    );

    const merged = mergeFields(stored, adoptUnstampedEdits(stored, fromPhone, SERVER));

    expect(merged.amount).toBe('120');
    expect(merged.note).toBe('corrected by the tablet');
  });

  it('only stamps the fields whose stamp matched but whose value did not', () => {
    const stored = blob({ a: '1', b: '2' }, { a: { t: 10, d: 'x' }, b: { t: 10, d: 'x' } });
    const incoming = blob({ a: '9', b: '2' }, { a: { t: 10, d: 'x' }, b: { t: 10, d: 'x' } });
    const meta = readFieldMeta(adoptUnstampedEdits(stored, incoming, SERVER));
    expect(meta.a).toEqual({ t: 5000, d: 'server' });
    expect(meta.b).toEqual({ t: 10, d: 'x' });
  });

  it('leaves a properly stamped edit alone', () => {
    const stored = blob({ a: '1' }, { a: { t: 10, d: 'x' } });
    const incoming = blob({ a: '9' }, { a: { t: 40, d: 'y' } });
    expect(readFieldMeta(adoptUnstampedEdits(stored, incoming, SERVER)).a).toEqual({
      t: 40,
      d: 'y',
    });
  });

  it('stamps above everything either side knows, so a slow server still wins', () => {
    const stored = blob({ a: '1' }, { a: { t: 9000, d: 'x' } });
    const incoming = blob({ a: '9' }, { a: { t: 9000, d: 'x' } });
    const adopted = adoptUnstampedEdits(stored, incoming, SERVER);
    expect(readFieldMeta(adopted).a).toEqual({ t: 9001, d: 'server' });
    expect(mergeFields(stored, adopted).a).toBe('9');
  });

  it('falls back to whole-record last-write-wins when the blob carries no stamps', () => {
    // A writer that dropped `_meta` rather than carrying it. Nothing to compare,
    // so it is believed — which is today's behaviour, not a regression.
    const stored = blob({ a: '1', b: '2' }, { a: { t: 10, d: 'x' }, b: { t: 10, d: 'x' } });
    const incoming = blob({ a: '9', b: '2' });
    const merged = mergeFields(stored, adoptUnstampedEdits(stored, incoming, SERVER));
    expect(merged.a).toBe('9');
    expect(merged.b).toBe('2');
  });

  it('needs no stamp for a field the stored record does not have', () => {
    const stored = blob({ a: '1' }, { a: { t: 10, d: 'x' } });
    const incoming = blob({ a: '1', fresh: 'new field' }, { a: { t: 10, d: 'x' } });
    const adopted = adoptUnstampedEdits(stored, incoming, SERVER);
    expect(readFieldMeta(adopted).fresh).toBeUndefined();
    expect(mergeFields(stored, adopted).fresh).toBe('new field');
  });

  it('a legacy fleet, with stamps nowhere, still behaves exactly as it does today', () => {
    const stored = blob({ amount: '100', note: 'a' });
    const incoming = blob({ amount: '120', note: 'a' });
    const merged = mergeFields(stored, adoptUnstampedEdits(stored, incoming, SERVER));
    expect(merged.amount).toBe('120');
    expect(merged.note).toBe('a');
  });

  it('passes a create straight through', () => {
    expect(adoptUnstampedEdits(null, blob({ a: '1' }), SERVER)).toEqual({ a: '1' });
  });

  it('is idempotent: adopting twice stamps nothing twice', () => {
    const stored = blob({ a: '1' }, { a: { t: 10, d: 'x' } });
    const incoming = blob({ a: '9' }, { a: { t: 10, d: 'x' } });
    const once = adoptUnstampedEdits(stored, incoming, SERVER);
    // The second pass sees a stamp that no longer matches the stored one, so it
    // leaves it be — a replayed mutation cannot keep winning by restamping.
    expect(adoptUnstampedEdits(stored, once, { now: 9999, deviceId: 'server' })).toEqual(once);
  });
});

/**
 * The server's write path, modelled exactly as `supabase/functions/sync`
 * implements it — read the stored blob, adopt the writer's unstamped edits,
 * merge, and write back under a compare-and-swap on `updated_seq`.
 *
 * A model rather than the real thing, for the same reason `sync.property.test`
 * has one: the edge function needs Postgres and this needs to run in a
 * millisecond. It mirrors the two things that matter and nothing else.
 *
 * Read the last test in this block before trusting the first ones. The merge is
 * only as good as what the writer tells it, and the app as it stands tells it
 * nothing — the edit screens build their payload from the form fields and drop
 * `carried`, so `_meta` never leaves the device. Until that is fixed the server
 * falls back to the whole-record overwrite, which is pinned below so the gap is
 * visible rather than assumed closed.
 */
interface StoredRow {
  readonly data: StampedData;
  /** Stands in for `updated_seq`, which a trigger bumps on every write. */
  readonly seq: number;
}

function serverWrite(stored: StoredRow | null, incoming: StampedData, now: number): StoredRow {
  if (stored === null) {
    return { data: stampFields(null, incoming, { now, deviceId: 'server' }), seq: 1 };
  }
  const adopted = adoptUnstampedEdits(stored.data, incoming, { now, deviceId: 'server' });
  return { data: mergeFields(stored.data, adopted, { now }), seq: stored.seq + 1 };
}

/** An edit as a device that stamps its writes would send it: the copy it holds,
 *  with one field changed and stamped. */
function edit(
  held: StampedData,
  change: Record<string, unknown>,
  now: number,
  deviceId: string,
): StampedData {
  return stampFields(held, { ...stripFieldMeta(held), ...change }, { now, deviceId });
}

describe('the server write path', () => {
  const created = (): StoredRow =>
    serverWrite(
      null,
      stampFields(
        null,
        { amount: '649.00', note: 'Netflix', kind: 'expense' },
        {
          now: 1000,
          deviceId: 'phone',
        },
      ),
      1000,
    );

  it('keeps both devices’ edits when they arrive one after the other', () => {
    const row = created();
    // Both devices hold this version; each changes a different field.
    const held = row.data;
    const afterPhone = serverWrite(row, edit(held, { amount: '699.00' }, 2000, 'phone'), 2000);
    const afterTablet = serverWrite(
      afterPhone,
      edit(held, { kind: 'subscription' }, 2001, 'tablet'),
      2001,
    );

    expect(afterTablet.data.amount).toBe('699.00');
    expect(afterTablet.data.kind).toBe('subscription');
    expect(afterTablet.data.note).toBe('Netflix');
  });

  it('stamps creates, so the first two edits to a new row can merge', () => {
    const row = serverWrite(null, { amount: '649.00', note: 'Netflix', kind: 'expense' }, 1000);
    const held = row.data;

    const afterPhone = serverWrite(row, { ...held, amount: '699.00' }, 2000);
    const afterTablet = serverWrite(afterPhone, { ...held, kind: 'subscription' }, 2001);

    expect(afterTablet.data.amount).toBe('699.00');
    expect(afterTablet.data.kind).toBe('subscription');
    expect(afterTablet.data.note).toBe('Netflix');
  });

  it('the compare-and-swap makes a lost race harmless', () => {
    const row = created();
    const held = row.data;

    // Both requests read seq 1. The first one writes.
    const first = serverWrite(row, edit(held, { amount: '120' }, 2000, 'phone'), 2000);
    expect(first.seq).toBe(2);

    // The second is refused — the row is at seq 2, not the 1 it read — so it
    // reads again and merges against what actually landed.
    expect(first.seq).not.toBe(row.seq);
    const second = serverWrite(first, edit(held, { note: 'dinner' }, 2001, 'tablet'), 2001);

    expect(second.data.amount).toBe('120');
    expect(second.data.note).toBe('dinner');
  });

  it('and without it, the loser of the race would erase the winner', () => {
    // What happens if the second write merges against its stale read instead of
    // re-reading. This is the whole job of the `updated_seq` guard.
    const row = created();
    const held = row.data;
    serverWrite(row, edit(held, { amount: '120' }, 2000, 'phone'), 2000);
    const blind = serverWrite(row, edit(held, { note: 'dinner' }, 2001, 'tablet'), 2001);
    expect(blind.data.amount).toBe('649.00');
  });

  it('replaying the same mutation changes nothing', () => {
    // The sync queue replays after a crash. A second identical write must be a
    // no-op, or an amount could walk.
    const row = created();
    const write = edit(row.data, { amount: '120' }, 2000, 'phone');
    const once = serverWrite(row, write, 2000);
    const twice = serverWrite(once, write, 2100);
    expect(twice.data).toEqual(once.data);
  });

  it('keeps a stamp-less client working, at the cost of the per-field merge', () => {
    // THE CURRENT STATE OF THE APP, pinned deliberately. Every edit screen
    // builds its payload with `encodeTxn({ ...form fields })` and passes no
    // `carried`, so `_meta` is dropped on the way out and the server sees a
    // blob with no stamps at all. There is nothing in such a write to tell an
    // edited field from one the device was merely carrying, so it is taken at
    // its word — which is exactly the whole-record overwrite that shipped
    // before, no better and no worse.
    const row = created();
    const held = stripFieldMeta(row.data);

    const afterPhone = serverWrite(row, { ...held, amount: '699.00' }, 2000);
    const afterTablet = serverWrite(afterPhone, { ...held, kind: 'subscription' }, 2001);

    expect(afterTablet.data.kind).toBe('subscription');
    // The phone's edit is gone — the tablet was carrying the old amount and had
    // no way to say so. Fixing this needs the client to stamp, not the server.
    expect(afterTablet.data.amount).toBe('649.00');
  });

  it('a stamp-less client that carries `_meta` gets the merge for free', () => {
    // The same two devices, changed in one respect only: the edit screens pass
    // `carried` through, so `_meta` survives the round trip even though neither
    // device understands it. The server adopts each edit by spotting that its
    // stamp still matches the stored one, and both survive. This is the smaller
    // of the two possible client fixes.
    const row = created();
    const held = row.data;

    const afterPhone = serverWrite(row, { ...held, amount: '699.00' }, 2000);
    const afterTablet = serverWrite(afterPhone, { ...held, kind: 'subscription' }, 2001);

    expect(afterTablet.data.amount).toBe('699.00');
    expect(afterTablet.data.kind).toBe('subscription');
    expect(afterTablet.data.note).toBe('Netflix');
  });
});

// ──────────────────────────────────────────────── the dismissal set ──

describe('the dismissal set', () => {
  it('is a union on both lists', () => {
    const phone = twoPhaseAdd(twoPhaseAdd(emptyTwoPhaseSet(), 'netflix'), 'gym');
    const tablet = twoPhaseAdd(emptyTwoPhaseSet(), 'spotify');
    expect(twoPhaseMembers(mergeTwoPhaseSets(phone, tablet))).toEqual([
      'gym',
      'netflix',
      'spotify',
    ]);
  });

  it('does not let an unrelated later write resurrect a dismissal', () => {
    // The bug an LWW register would have. The tablet never heard about the
    // dismissal and writes its own view of the set afterwards; with a register
    // that newer write would replace the older one and the candidate would come
    // back. Here the dismissal is its own element and survives.
    const phone = twoPhaseAdd(emptyTwoPhaseSet(), 'netflix');
    const tabletWritingLater = twoPhaseAdd(emptyTwoPhaseSet(), 'gym');
    const merged = mergeTwoPhaseSets(phone, tabletWritingLater);
    expect(twoPhaseHas(merged, 'netflix')).toBe(true);
  });

  it('removed wins, whichever side the removal came from', () => {
    const removed = twoPhaseRemove(twoPhaseAdd(emptyTwoPhaseSet(), 'netflix'), 'netflix');
    const stillAdded = twoPhaseAdd(emptyTwoPhaseSet(), 'netflix');
    expect(twoPhaseHas(mergeTwoPhaseSets(removed, stillAdded), 'netflix')).toBe(false);
    expect(twoPhaseHas(mergeTwoPhaseSets(stillAdded, removed), 'netflix')).toBe(false);
  });

  it('cannot be un-removed by adding the same id again', () => {
    // The documented cost of removed-wins. Re-admitting means a new id.
    const removed = twoPhaseRemove(twoPhaseAdd(emptyTwoPhaseSet(), 'netflix'), 'netflix');
    expect(twoPhaseHas(twoPhaseAdd(removed, 'netflix'), 'netflix')).toBe(false);
    expect(twoPhaseHas(twoPhaseAdd(removed, 'netflix#2'), 'netflix#2')).toBe(true);
  });

  it('keeps a canonical form, so two equal sets are deep-equal', () => {
    const one = twoPhaseAdd(twoPhaseAdd(emptyTwoPhaseSet(), 'b'), 'a');
    const two = twoPhaseAdd(twoPhaseAdd(emptyTwoPhaseSet(), 'a'), 'b');
    expect(one).toEqual(two);
    expect(twoPhaseAdd(one, 'a')).toEqual(one);
  });

  it('reads whatever the wire handed over without throwing', () => {
    expect(readTwoPhaseSet(null)).toEqual({ added: [], removed: [] });
    expect(readTwoPhaseSet({ added: 'nope' })).toEqual({ added: [], removed: [] });
    expect(readTwoPhaseSet({ added: ['b', 'a', 'a', 7], removed: ['c'] })).toEqual({
      added: ['a', 'b'],
      removed: ['c'],
    });
  });

  it('merges commutatively, associatively and idempotently', () => {
    const idArb = fc.constantFrom('a', 'b', 'c', 'd');
    const setArb = fc
      .array(fc.tuple(fc.boolean(), idArb), { maxLength: 6 })
      .map((ops) =>
        ops.reduce(
          (set, [isAdd, id]) => (isAdd ? twoPhaseAdd(set, id) : twoPhaseRemove(set, id)),
          emptyTwoPhaseSet(),
        ),
      );

    fc.assert(
      fc.property(setArb, setArb, setArb, (x, y, z) => {
        expect(mergeTwoPhaseSets(x, y)).toEqual(mergeTwoPhaseSets(y, x));
        expect(mergeTwoPhaseSets(mergeTwoPhaseSets(x, y), z)).toEqual(
          mergeTwoPhaseSets(x, mergeTwoPhaseSets(y, z)),
        );
        const merged = mergeTwoPhaseSets(x, y);
        expect(mergeTwoPhaseSets(merged, merged)).toEqual(merged);
      }),
      { numRuns: 500 },
    );
  });
});
