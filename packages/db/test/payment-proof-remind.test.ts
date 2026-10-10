/**
 * The payer's side of a payment waiting for confirmation: remind the payee,
 * attach up to five proofs, and say which day it was paid.
 *
 * What is pinned is the refusals, as in the nudge suite: only the payer reminds,
 * only once a day, only while the payment is still pending; a sixth proof is
 * turned away; only the payer or an admin removes one; and a paid date cannot
 * be in the future or edited by the payee.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedCommittedObject, seedGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
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

async function fixture() {
  const g = await seedGroup(client, { memberCount: 3, name: 'Paid up' });
  const settlementId = randomUUID();
  await client.query(
    `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
     VALUES ($1, $2, $3, $4, 'INR', 2000, 'upi', 'initiated')`,
    [settlementId, g.groupId, g.memberIds[1], g.memberIds[2]],
  );
  return { ...g, settlementId, payer: g.profileIds[1] as string, payee: g.profileIds[2] as string };
}

const remind = (profile: string, settlementId: string) =>
  as(profile, () =>
    client
      .query(`SELECT waves_remind_settlement_confirm($1::uuid) AS r`, [settlementId])
      .then((r) => String(r.rows[0].r)),
  );

const attach = async (profile: string, settlementId: string) => {
  const path = `${settlementId}/${randomUUID()}.webp`;
  await seedCommittedObject(client, {
    bucket: 'settlement-proofs',
    path,
    ownerProfileId: profile,
  });
  const { rows } = await as(profile, () =>
    client.query(`SELECT waves_attach_settlement_proof($1, $2, NULL) AS id`, [settlementId, path]),
  );
  return String(rows[0].id);
};

describe('waves_remind_settlement_confirm', () => {
  it('queues a confirm request for a payee on Waves and stamps the cooldown', async () => {
    const f = await fixture();
    expect(await remind(f.payer, f.settlementId)).toBe('notified');

    const { rows } = await client.query(
      `SELECT kind, payload FROM notifications
        WHERE profile_id = $1 AND payload ->> 'settlementId' = $2`,
      [f.payee, f.settlementId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('settlement_confirm_request');
    expect(rows[0].payload.reminder).toBe(true);

    const { rows: stamped } = await client.query(
      `SELECT reminded_at FROM settlements WHERE id = $1`,
      [f.settlementId],
    );
    expect(stamped[0].reminded_at).not.toBeNull();
  });

  it('refuses a second reminder inside 24 hours, then allows one after', async () => {
    const f = await fixture();
    await remind(f.payer, f.settlementId);
    await as(f.payer, async () => {
      expect(
        await expectDenied(
          client.query(`SELECT waves_remind_settlement_confirm($1::uuid)`, [f.settlementId]),
        ),
      ).toMatch(/REMIND_RATE_LIMIT/);
    });

    await client.query(
      `UPDATE settlements SET reminded_at = now() - interval '25 hours' WHERE id = $1`,
      [f.settlementId],
    );
    expect(await remind(f.payer, f.settlementId)).toBe('notified');
  });

  it('is the payer only', async () => {
    const f = await fixture();
    for (const profile of [f.payee, f.profileIds[0] as string]) {
      await as(profile, async () => {
        expect(
          await expectDenied(
            client.query(`SELECT waves_remind_settlement_confirm($1::uuid)`, [f.settlementId]),
          ),
        ).toMatch(/NOT_THE_PAYER/);
      });
    }
  });

  it('is refused once the payment is no longer pending', async () => {
    const f = await fixture();
    await client.query(`UPDATE settlements SET status = 'confirmed' WHERE id = $1`, [
      f.settlementId,
    ]);
    await as(f.payer, async () => {
      expect(
        await expectDenied(
          client.query(`SELECT waves_remind_settlement_confirm($1::uuid)`, [f.settlementId]),
        ),
      ).toMatch(/NOT_PENDING/);
    });
  });

  it('only stamps the cooldown for a payee who is not on Waves', async () => {
    const f = await fixture();
    await client.query(
      `UPDATE group_members SET profile_id = NULL, ghost_name = 'Renny' WHERE id = $1`,
      [f.memberIds[2]],
    );
    expect(await remind(f.payer, f.settlementId)).toBe('external');
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM notifications WHERE payload ->> 'settlementId' = $1`,
      [f.settlementId],
    );
    expect(rows[0].n).toBe(0);
    await as(f.payer, async () => {
      expect(
        await expectDenied(
          client.query(`SELECT waves_remind_settlement_confirm($1::uuid)`, [f.settlementId]),
        ),
      ).toMatch(/REMIND_RATE_LIMIT/);
    });
  });
});

describe('up to two proofs', () => {
  it('accepts two and turns the third away, until one is removed', async () => {
    const f = await fixture();
    const ids: string[] = [];
    for (let n = 0; n < 2; n += 1) ids.push(await attach(f.payer, f.settlementId));

    const path = `${f.settlementId}/${randomUUID()}.webp`;
    await seedCommittedObject(client, {
      bucket: 'settlement-proofs',
      path,
      ownerProfileId: f.payer,
    });
    await as(f.payer, async () => {
      expect(
        await expectDenied(
          client.query(`SELECT waves_attach_settlement_proof($1, $2, NULL)`, [
            f.settlementId,
            path,
          ]),
        ),
      ).toMatch(/PROOF_LIMIT/);
    });

    await as(f.payer, () =>
      client.query(`SELECT waves_remove_settlement_proof($1)`, [ids[0] as string]),
    );
    await as(f.payer, () =>
      client.query(`SELECT waves_attach_settlement_proof($1, $2, NULL)`, [f.settlementId, path]),
    );
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM settlement_proofs
        WHERE settlement_id = $1 AND deleted_at IS NULL`,
      [f.settlementId],
    );
    expect(rows[0].n).toBe(2);
  });

  it('replaying the same proof id at the limit is still a success', async () => {
    const f = await fixture();
    const path = `${f.settlementId}/${randomUUID()}.webp`;
    const proofId = randomUUID();
    await seedCommittedObject(client, {
      bucket: 'settlement-proofs',
      path,
      ownerProfileId: f.payer,
    });
    const call = () =>
      as(f.payer, () =>
        client
          .query(`SELECT waves_attach_settlement_proof($1, $2, $3) AS id`, [
            f.settlementId,
            path,
            proofId,
          ])
          .then((r) => String(r.rows[0].id)),
      );
    expect(await call()).toBe(proofId);
    await attach(f.payer, f.settlementId);
    expect(await call()).toBe(proofId);
  });

  it('lets the payer or a group admin remove a proof, and nobody else', async () => {
    const f = await fixture();
    const admin = f.profileIds[0] as string; // created the group
    const byPayer = await attach(f.payer, f.settlementId);
    const forAdmin = await attach(f.payer, f.settlementId);

    await as(f.payee, async () => {
      expect(
        await expectDenied(client.query(`SELECT waves_remove_settlement_proof($1)`, [byPayer])),
      ).toMatch(/NOT_THE_PAYER/);
    });
    await as(f.payer, () => client.query(`SELECT waves_remove_settlement_proof($1)`, [byPayer]));
    await as(admin, () => client.query(`SELECT waves_remove_settlement_proof($1)`, [forAdmin]));

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM settlement_proofs
        WHERE settlement_id = $1 AND deleted_at IS NULL`,
      [f.settlementId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('paid date', () => {
  it('backfills and defaults to the recorded day', async () => {
    const f = await fixture();
    const { rows } = await client.query(
      `SELECT paid_at = (now() AT TIME ZONE 'UTC')::date AS today FROM settlements WHERE id = $1`,
      [f.settlementId],
    );
    expect(rows[0].today).toBe(true);
  });

  it('records the day a payment was made, and defaults to today without one', async () => {
    const f = await fixture();
    const record = (paidAt: string | null) =>
      as(f.payer, () =>
        client
          .query(
            `SELECT waves_record_settlement($1::uuid, $2::uuid, $3::uuid, 1000::bigint, 'upi',
                    'INR'::char(3), NULL, '[]'::jsonb, $4::uuid, 'upi', $5::date) AS id`,
            [f.groupId, f.memberIds[1], f.memberIds[2], randomUUID(), paidAt],
          )
          .then((r) => String(r.rows[0].id)),
      );
    const past = await record('2026-01-05');
    const none = await record(null);
    const { rows } = await client.query(
      `SELECT id, to_char(paid_at, 'YYYY-MM-DD') AS d,
              paid_at = (now() AT TIME ZONE 'UTC')::date AS today
         FROM settlements WHERE id = ANY($1::uuid[])`,
      [[past, none]],
    );
    expect(rows.find((r) => r.id === past).d).toBe('2026-01-05');
    expect(rows.find((r) => r.id === none).today).toBe(true);
  });

  it('refuses a payment dated well into the future', async () => {
    const f = await fixture();
    await as(f.payer, async () => {
      expect(
        await expectDenied(
          client.query(
            `SELECT waves_record_settlement($1::uuid, $2::uuid, $3::uuid, 1000::bigint, 'upi',
                    'INR'::char(3), NULL, '[]'::jsonb, $4::uuid, 'upi',
                    ((now() AT TIME ZONE 'UTC')::date + 30))`,
            [f.groupId, f.memberIds[1], f.memberIds[2], randomUUID()],
          ),
        ),
      ).toMatch(/INVALID_PAID_AT/);
    });
  });

  it('lets the payer correct the date while pending, not the payee, not the future', async () => {
    const f = await fixture();
    await as(f.payer, () =>
      client.query(`SELECT waves_set_settlement_paid_at($1::uuid, '2026-02-03'::date)`, [
        f.settlementId,
      ]),
    );
    const { rows } = await client.query(
      `SELECT to_char(paid_at, 'YYYY-MM-DD') AS d FROM settlements WHERE id = $1`,
      [f.settlementId],
    );
    expect(rows[0].d).toBe('2026-02-03');

    await as(f.payee, async () => {
      expect(
        await expectDenied(
          client.query(`SELECT waves_set_settlement_paid_at($1::uuid, '2026-02-04'::date)`, [
            f.settlementId,
          ]),
        ),
      ).toMatch(/NOT_THE_PAYER/);
    });
    await as(f.payer, async () => {
      expect(
        await expectDenied(
          client.query(
            `SELECT waves_set_settlement_paid_at($1::uuid, ((now() AT TIME ZONE 'UTC')::date + 30))`,
            [f.settlementId],
          ),
        ),
      ).toMatch(/INVALID_PAID_AT/);
    });
  });
});
