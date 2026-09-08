/**
 * The loading placeholder a receipt carries with it.
 *
 * A receipt's bytes are behind a signed URL, so a device that has never fetched
 * them has nothing to draw until a round trip finishes. The row carries a ~32px
 * `data:` URI so it has something. That string comes from a client, so what the
 * database will accept is the whole security question here — and the answer has
 * to be "drop it", never "fail the upload": this is decoration, and refusing
 * somebody's receipt over a thumbnail would be a bad trade.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, seedCommittedObject, seedGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
  }
}

let g: { groupId: string; profileIds: string[]; memberIds: string[] };
let expenseId: string;

beforeAll(async () => {
  g = await seedGroup(client, { memberCount: 3, name: 'Preview' });
  ({ expenseId } = await addEqualSplitExpense(client, {
    groupId: g.groupId,
    payers: { [g.memberIds[0] as string]: 3000n },
    participants: g.memberIds,
    amount: 3000n,
  }));
});

beforeEach(async () => {
  await client.query(`DELETE FROM expense_attachments WHERE group_id = $1`, [g.groupId]);
});

const P = (i: number) => g.profileIds[i] as string;

/** A real, if very small, JPEG data URI — the shape the app produces. */
const GOOD = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';

async function attach(preview: string | null, path?: string): Promise<string> {
  const key = path ?? `${expenseId}/${randomUUID()}.webp`;
  await seedCommittedObject(client, {
    bucket: 'expense-attachments',
    path: key,
    ownerProfileId: P(0),
  });
  const id = randomUUID();
  await as(P(0), () =>
    client.query(`SELECT waves_attach_expense_attachment($1, $2, 'group', $3, $4)`, [
      expenseId,
      key,
      id,
      preview,
    ]),
  );
  return id;
}

const previewOf = (id: string) =>
  client
    .query<{ preview: string | null }>(`SELECT preview FROM expense_attachments WHERE id = $1`, [
      id,
    ])
    .then((r) => r.rows[0]?.preview ?? null);

describe('a receipt preview', () => {
  it('is kept when it is a small image data URI', async () => {
    expect(await previewOf(await attach(GOOD))).toBe(GOOD);
  });

  it('is simply absent when the client sends none', async () => {
    expect(await previewOf(await attach(null))).toBeNull();
  });

  it('still attaches for a client that predates the argument', async () => {
    // The four-argument call every shipped build makes. It must keep working,
    // which is why the new argument is defaulted rather than a second overload.
    const key = `${expenseId}/${randomUUID()}.webp`;
    await seedCommittedObject(client, {
      bucket: 'expense-attachments',
      path: key,
      ownerProfileId: P(0),
    });
    const id = randomUUID();
    await as(P(0), () =>
      client.query(`SELECT waves_attach_expense_attachment($1, $2, 'group', $3)`, [
        expenseId,
        key,
        id,
      ]),
    );
    expect(await previewOf(id)).toBeNull();
  });

  it('drops anything that is not one, rather than refusing the receipt', async () => {
    // A URI scheme that executes, a remote reference that phones home, and a
    // string far too large to be a placeholder. None of these is a reason to
    // lose somebody's bill — each is a reason to store no placeholder.
    for (const bad of [
      'javascript:alert(1)',
      'https://example.test/tracker.gif',
      'data:text/html;base64,PHNjcmlwdD4=',
      `data:image/jpeg;base64,${'A'.repeat(5000)}`,
    ]) {
      // One at a time: the free per-expense receipt ceiling is smaller than
      // this list, and the cap is not what is under test here.
      await client.query(`DELETE FROM expense_attachments WHERE group_id = $1`, [g.groupId]);
      expect(await previewOf(await attach(bad))).toBeNull();
    }
  });

  it('is replaced along with the pixels when the image is adjusted', async () => {
    const id = await attach(GOOD);
    const newPath = `${expenseId}/${randomUUID()}.webp`;
    await seedCommittedObject(client, {
      bucket: 'expense-attachments',
      path: newPath,
      ownerProfileId: P(0),
    });
    const next = 'data:image/webp;base64,UklGRhoAAABXRUJQ';
    await as(P(0), () =>
      client.query(`SELECT waves_replace_expense_attachment_image($1, $2, $3)`, [
        id,
        newPath,
        next,
      ]),
    );
    // Not merged: a crop or a rotation makes the old thumbnail wrong, so the
    // new one stands alone — and a caller sending none leaves the row bare.
    expect(await previewOf(id)).toBe(next);
  });

  it('is cleared, not kept, when an adjust sends none', async () => {
    const id = await attach(GOOD);
    const newPath = `${expenseId}/${randomUUID()}.webp`;
    await seedCommittedObject(client, {
      bucket: 'expense-attachments',
      path: newPath,
      ownerProfileId: P(0),
    });
    await as(P(0), () =>
      client.query(`SELECT waves_replace_expense_attachment_image($1, $2)`, [id, newPath]),
    );
    expect(await previewOf(id)).toBeNull();
  });
});
