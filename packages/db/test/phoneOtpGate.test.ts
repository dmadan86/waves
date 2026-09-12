/**
 * Three codes a day, and what happens to a number that spends them and never
 * signs in.
 *
 * The rule is cheap to state and easy to get subtly wrong, so each half is
 * pinned here: the allowance itself, the strike that only accrues on a day
 * nobody verified, the block that follows three of those, and — the one worth
 * the most — that a *polite* abuser who stops at exactly three a day is caught
 * too. An earlier draft only evaluated strikes on the ask that went over the
 * cap, which meant a script keeping to the limit could spend the whole allowance
 * every day for ever without the rule ever looking at it.
 *
 * Also the boring halves that are not boring at all: a blocked number must not
 * be able to keep its own record warm by hammering a shut door, and neither
 * table nor function may be reachable by anyone holding an anon or a signed-in
 * key. A list of numbers currently under attack is not something to hand out.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;

/** Distinct per test, so nothing leaks between them through a shared number. */
let seq = 0;
function aNumber(): string {
  seq += 1;
  return `+4477009${String(seq).padStart(5, '0')}`;
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

afterEach(async () => {
  await client.query('DELETE FROM public.phone_otp_strikes');
  await client.query('DELETE FROM public.phone_blocks');
  await client.query(
    `UPDATE public.app_config SET value = 3 WHERE key IN ('otp_daily_cap', 'otp_strikes_to_block')`,
  );
});

interface Verdict {
  allowed: boolean;
  reason: 'ok' | 'spent' | 'blocked';
  remaining?: number;
  retryAfter?: number | null;
}

async function gate(phone: string): Promise<Verdict> {
  const { rows } = await client.query<{ waves_phone_gate: Verdict }>(
    'SELECT public.waves_phone_gate($1)',
    [phone],
  );
  return rows[0]!.waves_phone_gate;
}

async function verified(phone: string): Promise<void> {
  await client.query('SELECT public.waves_phone_verified($1)', [phone]);
}

/** Backdate a spent, unverified day, the way three days of abuse would look. */
async function spentDayAgo(phone: string, days: number, hits = 3): Promise<void> {
  await client.query(
    `INSERT INTO public.phone_otp_strikes (phone, day, hits)
     VALUES ($1, (now() AT TIME ZONE 'utc')::date - $2::integer, $3)`,
    [phone, days, hits],
  );
}

describe('the daily allowance', () => {
  it('allows three and refuses the fourth', async () => {
    const phone = aNumber();
    expect((await gate(phone)).remaining).toBe(2);
    expect((await gate(phone)).remaining).toBe(1);
    expect((await gate(phone)).remaining).toBe(0);

    const fourth = await gate(phone);
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toBe('spent');
    // Enough to tell somebody when to come back, and no more.
    expect(fourth.retryAfter).toBeGreaterThan(0);
  });

  it('gives the allowance back once a code is actually used', async () => {
    // Two mistypes and a success is an ordinary evening, not an attack.
    const phone = aNumber();
    await gate(phone);
    await gate(phone);
    await verified(phone);

    expect((await gate(phone)).remaining).toBe(2);
  });

  it('refuses anything that is not an E.164 number', async () => {
    for (const bad of ['07700900123', '+0123456', 'not a phone', '']) {
      await expect(gate(bad)).rejects.toThrow(/E\.164/);
    }
  });

  it('follows the admin knob rather than a number in the function', async () => {
    await client.query(`UPDATE public.app_config SET value = 1 WHERE key = 'otp_daily_cap'`);
    const phone = aNumber();

    expect((await gate(phone)).allowed).toBe(true);
    expect((await gate(phone)).allowed).toBe(false);
  });
});

describe('strikes', () => {
  it('blocks a number that spends every day and never signs in', async () => {
    const phone = aNumber();
    await spentDayAgo(phone, 1);
    await spentDayAgo(phone, 2);

    // Today's third ask completes the pattern, so the third code is never sent:
    // the block lands on the ask that earns it, not on the one after.
    expect((await gate(phone)).allowed).toBe(true);
    expect((await gate(phone)).allowed).toBe(true);

    const third = await gate(phone);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe('blocked');

    const { rows } = await client.query(
      'SELECT reason, until FROM public.phone_blocks WHERE phone = $1',
      [phone],
    );
    expect(rows[0].reason).toBe('abuse');
    expect(new Date(rows[0].until).getTime()).toBeGreaterThan(Date.now());
  });

  it('catches an abuser who politely stops at the limit', async () => {
    // The case a draft of this missed. Three a day, every day, never a
    // verification — no single ask is over the cap, and the pattern is the whole
    // point.
    const phone = aNumber();
    await spentDayAgo(phone, 1, 3);
    await spentDayAgo(phone, 2, 3);
    await spentDayAgo(phone, 3, 3);

    const first = await gate(phone);
    expect(first.allowed).toBe(false);
    expect(first.reason).toBe('blocked');
  });

  it('does not count a day that ended in a sign-in', async () => {
    const phone = aNumber();
    await spentDayAgo(phone, 1);
    await spentDayAgo(phone, 2);
    // Yesterday they got in, so yesterday is not evidence of anything.
    await client.query(
      `DELETE FROM public.phone_otp_strikes WHERE phone = $1 AND day = (now() AT TIME ZONE 'utc')::date - 1`,
      [phone],
    );

    await gate(phone);
    await gate(phone);
    expect((await gate(phone)).allowed).toBe(true);
  });

  it('forgets a strike once it is out of the window', async () => {
    const phone = aNumber();
    await spentDayAgo(phone, 20);
    await spentDayAgo(phone, 30);
    await spentDayAgo(phone, 40);

    expect((await gate(phone)).allowed).toBe(true);
  });
});

describe('a blocked number', () => {
  it('is refused without its counter moving', async () => {
    // Otherwise hammering a shut door would keep the block's own evidence fresh,
    // and a 30-day block would renew itself for as long as the script ran.
    const phone = aNumber();
    await client.query('SELECT public.waves_admin_phone_block($1, 30)', [phone]);

    for (let i = 0; i < 5; i += 1) expect((await gate(phone)).allowed).toBe(false);

    const { rows } = await client.query(
      'SELECT count(*)::int AS days FROM public.phone_otp_strikes WHERE phone = $1',
      [phone],
    );
    expect(rows[0].days).toBe(0);
  });

  it('gets its allowance back when the block runs out', async () => {
    const phone = aNumber();
    await client.query(
      `INSERT INTO public.phone_blocks (phone, reason, until) VALUES ($1, 'abuse', now() - interval '1 day')`,
      [phone],
    );

    expect((await gate(phone)).allowed).toBe(true);
    const { rows } = await client.query(
      'SELECT count(*)::int AS n FROM public.phone_blocks WHERE phone = $1',
      [phone],
    );
    expect(rows[0].n).toBe(0);
  });

  it('can be lifted, and comes back with a clean slate', async () => {
    const phone = aNumber();
    await spentDayAgo(phone, 1);
    await client.query('SELECT public.waves_admin_phone_block($1, 30)', [phone]);

    const { rows } = await client.query<{ waves_admin_phone_unblock: boolean }>(
      'SELECT public.waves_admin_phone_unblock($1)',
      [phone],
    );
    expect(rows[0]!.waves_admin_phone_unblock).toBe(true);

    // The old strike goes with the block, or lifting it would last one ask.
    expect((await gate(phone)).allowed).toBe(true);
    expect((await gate(phone)).remaining).toBe(1);
  });

  it('says nothing about why to the caller it refuses', async () => {
    // A blocked number and a spent one both answer "not now". What they must not
    // do is tell a prober which numbers are worth attacking — the reason is for
    // the log, and carries no count, no history and no timestamps.
    const phone = aNumber();
    await client.query('SELECT public.waves_admin_phone_block($1, 30)', [phone]);

    const verdict = await gate(phone);
    expect(Object.keys(verdict).sort()).toEqual(['allowed', 'reason', 'retryAfter']);
  });
});

describe('who can reach any of this', () => {
  async function asRole(role: 'anon' | 'authenticated', sql: string): Promise<unknown> {
    await client.query(`SET ROLE ${role}`);
    try {
      return await client.query(sql);
    } finally {
      await client.query('RESET ROLE');
    }
  }

  it.each(['anon', 'authenticated'] as const)('is closed to %s', async (role) => {
    await expect(asRole(role, 'SELECT * FROM public.phone_blocks')).rejects.toThrow(/permission/i);
    await expect(asRole(role, 'SELECT * FROM public.phone_otp_strikes')).rejects.toThrow(
      /permission/i,
    );
    await expect(asRole(role, `SELECT public.waves_phone_gate('+447700900123')`)).rejects.toThrow(
      /permission/i,
    );
    await expect(
      asRole(role, `SELECT public.waves_admin_phone_unblock('+447700900123')`),
    ).rejects.toThrow(/permission/i);
  });
});
