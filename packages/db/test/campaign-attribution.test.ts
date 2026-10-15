/**
 * `waves_admin_campaigns`: installs per campaign tag, and how many of them
 * were registered, activated and bought a paid plan. Counts are compared as
 * deltas against a tag unique to each test, so other files' rows never matter.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, expectDenied, seedGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

const SIGNUP = `(date_trunc('day', now()) - interval '20 days' + interval '6 hours')`;

async function install(campaign: string, medium = 'paid', source = 'meta'): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.app_events (install_id, name, platform, props)
     VALUES ($1, 'app_installed', 'android', $2)`,
    [id, JSON.stringify({ source, medium, campaign })],
  );
  return id;
}

/** Ties a later event of this install to a profile, as signing up does. */
async function registered(installId: string, profileId: string): Promise<void> {
  await client.query(
    `INSERT INTO public.app_events (install_id, profile_id, name) VALUES ($1, $2, 'signup_started')`,
    [installId, profileId],
  );
}

async function row(campaign: string): Promise<Record<string, string> | undefined> {
  const { rows } = await client.query(
    `SELECT * FROM public.waves_admin_campaigns(30) WHERE campaign = $1`,
    [campaign],
  );
  return rows[0];
}

describe('waves_admin_campaigns', () => {
  it('counts installs, registrations, activations and paid plans per tag', async () => {
    const tag = `t_${randomUUID().slice(0, 8)}`;
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 3 });
    await client.query(`UPDATE public.profiles SET created_at = ${SIGNUP} WHERE id = ANY($1)`, [
      profileIds,
    ]);
    const [a, b] = profileIds as [string, string, string];

    // Install 1: registered, made an expense on day 1, bought Plus.
    const i1 = await install(tag);
    await registered(i1, a);
    const { expenseId } = await addEqualSplitExpense(client, {
      groupId,
      payers: { [memberIds[0]!]: 1000n },
      participants: [memberIds[0]!],
      amount: 1000n,
    });
    await client.query(
      `UPDATE public.expenses SET created_at = ${SIGNUP} + interval '1 day' WHERE id = $1`,
      [expenseId],
    );
    await client.query(
      `INSERT INTO public.subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
       VALUES ($1, 'plus', 'monthly', 'active', now() + interval '30 days', 'play', $2)`,
      [a, randomUUID()],
    );

    // Install 2: registered, never did anything, only a comped (promo) Pro.
    const i2 = await install(tag);
    await registered(i2, b);
    await client.query(
      `INSERT INTO public.subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
       VALUES ($1, 'pro', 'monthly', 'active', now() + interval '30 days', 'promo', $2)`,
      [b, randomUUID()],
    );

    // Install 3: never registered. Install 4: a repeat event for the same install.
    await install(tag);
    await client.query(
      `INSERT INTO public.app_events (install_id, name) VALUES ($1, 'premium_viewed')`,
      [i1],
    );

    const out = await row(tag);
    expect(out).toMatchObject({
      source: 'meta',
      medium: 'paid',
      campaign: tag,
      installs: '3',
      registrations: '2',
      activated: '1',
      subscriptions: '1',
    });
  });

  it('keeps source and medium apart within one campaign name', async () => {
    const tag = `g_${randomUUID().slice(0, 8)}`;
    const { profileIds } = await seedGroup(client, { memberCount: 1 });
    const i1 = await install(tag, 'organic', 'google-play');
    await registered(i1, profileIds[0]!);
    await install(tag, 'paid', 'meta');

    const { rows } = await client.query(
      `SELECT source, medium, installs, registrations FROM public.waves_admin_campaigns(30)
        WHERE campaign = $1 ORDER BY source`,
      [tag],
    );
    expect(rows).toEqual([
      { source: 'google-play', medium: 'organic', installs: '1', registrations: '1' },
      { source: 'meta', medium: 'paid', installs: '1', registrations: '0' },
    ]);
  });

  it('shows an install with no tag as (none), and ignores installs outside the window', async () => {
    const before = await row('(none)');
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, name) VALUES ($1, 'app_installed')`,
      [id],
    );
    const old = randomUUID();
    await client.query(
      `INSERT INTO public.app_events (install_id, name, occurred_at)
       VALUES ($1, 'app_installed', now() - interval '90 days')`,
      [old],
    );
    const after = await row('(none)');
    expect(Number(after?.installs) - Number(before?.installs ?? 0)).toBe(1);
    expect(after?.source).toBe('(none)');
  });

  it('is closed to anon and signed-in users', async () => {
    for (const role of ['anon', 'authenticated']) {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        const message = await expectDenied(
          client.query(`SELECT * FROM public.waves_admin_campaigns(30)`),
        );
        expect(message, role).toMatch(/permission denied/i);
      } finally {
        await client.query('ROLLBACK');
      }
    }
  });
});
