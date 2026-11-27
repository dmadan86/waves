/**
 * Rentals kept inside a couple/home group cross the sync boundary as
 * `group_record.upsert` / `group_record.delete`, merged field by field with a
 * compare-and-swap on `updated_seq` exactly like personal records, and pulled
 * only for couple/home groups.
 */

import { describe, expect, it, vi } from 'vitest';

import { pull, SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const OTHER_GROUP = '11111111-1111-1111-1111-111111111111';
const RECORD = '00000000-0000-4000-8000-0000000000aa';

/** A caller whose `group_records` table holds `stored` (or nothing). */
function caller(stored: Record<string, unknown> | null) {
  const calls: { op: string; table: string; arg?: Record<string, unknown>; eqs: unknown[][] }[] =
    [];
  const from = vi.fn((table: string) => {
    let op = 'select';
    let arg: Record<string, unknown> | undefined;
    const eqs: unknown[][] = [];
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (...a: unknown[]) => {
      eqs.push(a);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: stored, error: null });
    builder.insert = (row: Record<string, unknown>) => {
      calls.push({ op: 'insert', table, arg: row, eqs });
      return Promise.resolve({ error: null });
    };
    builder.update = (patch: Record<string, unknown>) => {
      op = 'update';
      arg = patch;
      return builder;
    };
    // `update(...).eq(...).eq(...).select('id')` resolves to the written rows.
    const select = builder.select as () => unknown;
    builder.select = () => {
      if (op === 'update') {
        calls.push({ op, table, arg, eqs });
        return Promise.resolve({ data: [{ id: RECORD }], error: null });
      }
      return select();
    };
    // delete path awaits the builder itself after `.eq`.
    (builder as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
      if (op === 'update') calls.push({ op, table, arg, eqs });
      resolve({ error: null });
    };
    return builder;
  });
  return { client: { from, rpc: vi.fn() } as never, calls };
}

function service() {
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { from } as never };
}

function mutation(kind: string, payload: Record<string, unknown>, groupId = GROUP_ID) {
  return {
    clientMutationId: kind,
    kind,
    groupId,
    seq: 1,
    clientCreatedAt: '2026-12-31T04:00:00.000Z',
    payload,
  } as never;
}

describe('group_record.upsert', () => {
  it('inserts a new record under the mutation group', async () => {
    const c = caller(null);
    const out = await new SyncSession(c.client, service().client, OWNER).apply(
      mutation('group_record.upsert', {
        recordId: RECORD,
        recordKind: 'property',
        data: { name: 'Flat 2' },
      }),
    );
    expect(out).toMatchObject({ status: 'applied' });
    const insert = c.calls.find((call) => call.op === 'insert')!;
    expect(insert.table).toBe('group_records');
    expect(insert.arg).toMatchObject({ id: RECORD, group_id: GROUP_ID, record_kind: 'property' });
    expect(insert.arg).not.toHaveProperty('owner_user_id');
    expect((insert.arg!.data as Record<string, unknown>).name).toBe('Flat 2');
  });

  it('merges into the stored record with a compare-and-swap on updated_seq', async () => {
    const c = caller({
      group_id: GROUP_ID,
      updated_seq: 7,
      data: { name: 'Flat 2', note: 'old' },
    });
    const out = await new SyncSession(c.client, service().client, OWNER).apply(
      mutation('group_record.upsert', {
        recordId: RECORD,
        recordKind: 'property',
        data: { name: 'Flat 2', note: 'new' },
      }),
    );
    expect(out).toMatchObject({ status: 'applied' });
    const update = c.calls.find((call) => call.op === 'update')!;
    expect(update.table).toBe('group_records');
    expect(update.eqs).toContainEqual(['updated_seq', 7]);
    expect(update.arg).toMatchObject({ deleted_at: null });
  });

  it('refuses a record id that belongs to another group', async () => {
    const c = caller({ group_id: OTHER_GROUP, updated_seq: 1, data: {} });
    const out = await new SyncSession(c.client, service().client, OWNER).apply(
      mutation('group_record.upsert', { recordId: RECORD, recordKind: 'txn', data: {} }),
    );
    expect(out).toMatchObject({ status: 'rejected', code: 'NOT_OWNER' });
    expect(c.calls.some((call) => call.op === 'update')).toBe(false);
  });

  it.each([['loan'], ['budget'], ['bogus']])('refuses kind %s', async (kind) => {
    const c = caller(null);
    const out = await new SyncSession(c.client, service().client, OWNER).apply(
      mutation('group_record.upsert', { recordId: RECORD, recordKind: kind, data: {} }),
    );
    expect(out).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(c.calls).toEqual([]);
  });

  it('soft-deletes within the mutation group only', async () => {
    const c = caller(null);
    const out = await new SyncSession(c.client, service().client, OWNER).apply(
      mutation('group_record.delete', { recordId: RECORD }),
    );
    expect(out).toMatchObject({ status: 'applied' });
    const del = c.calls.find((call) => call.op === 'update')!;
    expect(del.arg).toHaveProperty('deleted_at');
    expect(del.eqs).toEqual(
      expect.arrayContaining([
        ['id', RECORD],
        ['group_id', GROUP_ID],
      ]),
    );
  });
});

describe('pull: group_records', () => {
  function stub(type: string) {
    const reads: string[] = [];
    const group = {
      id: GROUP_ID,
      updated_seq: 12,
      updated_at: '2026-01-01T00:00:00.000Z',
      type,
    };
    const row = { id: RECORD, group_id: GROUP_ID, updated_seq: 12, record_kind: 'property' };
    const client = {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.gt = () => b;
        b.order = () => b;
        b.in = () => Promise.resolve({ data: table === 'groups' ? [group] : [], error: null });
        b.limit = () => {
          reads.push(table);
          return Promise.resolve({ data: table === 'group_records' ? [row] : [], error: null });
        };
        return b;
      },
    };
    return { client: client as never, reads };
  }

  it.each(['couple', 'home'])('includes the rows for a %s group', async (type) => {
    const { client, reads } = stub(type);
    const out = await pull(client, new Set([GROUP_ID]), { [GROUP_ID]: 0 }, OWNER);
    expect(reads).toContain('group_records');
    expect(out.changes).toContainEqual(
      expect.objectContaining({ table: 'group_records', groupId: GROUP_ID, seq: 12 }),
    );
  });

  it('never reads them for other group types', async () => {
    const { client, reads } = stub('trip');
    await pull(client, new Set([GROUP_ID]), { [GROUP_ID]: 0 }, OWNER);
    expect(reads).not.toContain('group_records');
  });
});
