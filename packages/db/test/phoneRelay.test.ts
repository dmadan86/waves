/**
 * The phone door, end to end, against a real Postgres — which is as close to an
 * end-to-end test as this feature can get without a device and a live SMS.
 *
 * Everything the exchange actually depends on is a race or a window, and neither
 * survives being unit-tested with a mock: the relay is keyed on a phone number,
 * so two devices signing in on one number meet in the same row; a Firebase proof
 * is good for ten minutes, so two requests can carry the same one; and a
 * refunded attempt is a subtraction that must not turn into a resurrection. All
 * of those are exercised here over real connections, in parallel where parallel
 * is the point.
 *
 * What each block is standing guard over:
 *
 *   * **The handshake.** Open, park, claim, verify — the four calls `phone-verify`
 *     and `otp-send` make between them, in the order they make them, with the
 *     code surviving exactly one hop and nothing left behind afterwards.
 *   * **The exchange id.** Without it one number is one row: the second sign-in
 *     overwrites the first's, and the first then either claims a code minted for
 *     somebody else or deletes the second's on its way out — sending a stranger's
 *     code to an SMS nobody asked for.
 *   * **One proof, one use.** A Firebase ID token is refreshable, so the same
 *     sign-in can arrive twice wearing two signatures. One proof buying both a
 *     session *and* an attachment to a second account is two irreversible things
 *     from one SMS.
 *   * **A refund is a subtraction, not an amnesty.** Handing back an attempt we
 *     wasted must not clear the day's evidence that somebody is hammering the
 *     number, and must not leave a phantom row that counts as a spent day.
 *
 * Unrun as written: Docker was not available on the machine this was written on,
 * so the suite has never been executed. CI provides the database.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;

/** Distinct per test, so nothing leaks between them through a shared number. */
let seq = 0;
function aNumber(): string {
  seq += 1;
  return `+4477008${String(seq).padStart(5, '0')}`;
}

let uidSeq = 0;
function aFirebaseUid(): string {
  uidSeq += 1;
  return `firebase-uid-${uidSeq}`;
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

afterEach(async () => {
  await client.query('DELETE FROM public.otp_relay');
  await client.query('DELETE FROM public.firebase_assertions');
  await client.query('DELETE FROM public.phone_otp_strikes');
  await client.query('DELETE FROM public.phone_blocks');
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params);
  return Object.values(rows[0] as Record<string, unknown>)[0] as T;
}

const open = (phone: string) => one<string>('SELECT public.waves_otp_relay_open($1)', [phone]);
const park = (phone: string, code: string) =>
  one<boolean>('SELECT public.waves_otp_relay_park($1, $2)', [phone, code]);
const claim = (phone: string, exchange: string) =>
  one<string | null>('SELECT public.waves_otp_relay_claim($1, $2)', [phone, exchange]);
const close = (phone: string, exchange: string) =>
  client.query('SELECT public.waves_otp_relay_close($1, $2)', [phone, exchange]);

interface Verdict {
  allowed: boolean;
  reason: 'ok' | 'spent' | 'blocked';
  remaining?: number;
}
const gate = (phone: string) => one<Verdict>('SELECT public.waves_phone_gate($1)', [phone]);
const refund = (phone: string) =>
  client.query('SELECT public.waves_phone_gate_refund($1)', [phone]);
const useProof = (uid: string, authTime: number) =>
  one<boolean>('SELECT public.waves_firebase_assertion_use($1, $2)', [uid, authTime]);
const releaseProof = (uid: string, authTime: number) =>
  client.query('SELECT public.waves_firebase_assertion_release($1, $2)', [uid, authTime]);

/** How many rows the day is currently standing at, or null for no row at all. */
async function hitsToday(phone: string): Promise<number | null> {
  const { rows } = await client.query<{ hits: number }>(
    `SELECT hits FROM public.phone_otp_strikes
      WHERE phone = $1 AND day = (now() AT TIME ZONE 'utc')::date`,
    [phone],
  );
  return rows[0]?.hits ?? null;
}

/** Backdate an open exchange, which is the only way to reach the TTL in a test. */
async function ageExchange(phone: string, seconds: number): Promise<void> {
  await client.query(
    `UPDATE public.otp_relay SET requested_at = now() - make_interval(secs => $2) WHERE phone = $1`,
    [phone, seconds],
  );
}

describe('the exchange, from the gate to a session', () => {
  it('carries the code one hop and leaves nothing behind', async () => {
    // The whole handshake in the order the two functions make it. Every step is
    // covered on its own elsewhere; what this pins is that they compose — an
    // earlier draft had the claim matching on the number alone, which passed
    // every individual test and handed the wrong code to the wrong caller.
    const phone = aNumber();

    expect((await gate(phone)).allowed).toBe(true);
    const exchange = await open(phone);
    expect(await park(phone, '123456')).toBe(true);
    expect(await claim(phone, exchange)).toBe('123456');

    // Claimed means gone: a live sign-in credential does not get to sit around
    // waiting for whoever finds it next.
    const { rows } = await client.query('SELECT * FROM public.otp_relay WHERE phone = $1', [phone]);
    expect(rows).toHaveLength(0);

    // A code was used, so the day is cleared and nothing can accrue a strike.
    await client.query('SELECT public.waves_phone_verified($1)', [phone]);
    expect(await hitsToday(phone)).toBeNull();
  });

  it('parks nothing when nobody is waiting, which is the ordinary SMS path', async () => {
    // `otp-send` reads false as "this is a real code somebody is sitting waiting
    // for" and goes on to send it. If this ever answered true with no exchange
    // open, every ordinary phone sign-in would silently stop receiving its SMS.
    expect(await park(aNumber(), '123456')).toBe(false);
  });

  it('refuses a code parked after the window has gone by', async () => {
    // The window is what stops an abandoned exchange sitting there fillable. A
    // request that went astray half a minute ago is not an exchange any more,
    // and a code parked into it is a live credential nobody is coming back for.
    const phone = aNumber();
    await open(phone);
    await ageExchange(phone, 120);

    expect(await park(phone, '123456')).toBe(false);
  });

  it('refuses a second code over one already parked', async () => {
    // Two codes and one row: the second would overwrite a code the caller is
    // about to claim, so the caller verifies with a code GoTrue has already
    // superseded and the sign-in fails for no visible reason.
    const phone = aNumber();
    const exchange = await open(phone);
    expect(await park(phone, '111111')).toBe(true);
    expect(await park(phone, '222222')).toBe(false);
    expect(await claim(phone, exchange)).toBe('111111');
  });

  it('refuses to claim a code that has aged past the window', async () => {
    const phone = aNumber();
    const exchange = await open(phone);
    await park(phone, '123456');
    await ageExchange(phone, 120);

    expect(await claim(phone, exchange)).toBeNull();
  });
});

describe('two devices on one number', () => {
  it('refuses a second exchange while the first is still live', async () => {
    // Two devices, one number, at the same moment. The exchange id already stops
    // the loser *stealing* a code, but displacement left a subtler mess: the
    // second open replaced the first's row, so the code GoTrue minted for the
    // first request was parked into the second's and signed the second device
    // in on it. Same account either way, so never a breach — but a code answering
    // a request nobody made. Refusing the overlap removes the question.
    const phone = aNumber();
    const first = await open(phone);
    expect(first).toBeTruthy();

    await expect(open(phone)).rejects.toThrow(/OTP_RELAY_BUSY/);

    // And the first exchange is untouched by the attempt — it still owns its row.
    await park(phone, '222222');
    expect(await claim(phone, first)).toBe('222222');
  });

  it('lets the next device through the moment the first is done', async () => {
    // The cost of refusing an overlap is a door that stays shut too long, so the
    // close has to open it again immediately — a person whose first attempt died
    // is the most likely caller of the second.
    const phone = aNumber();
    const first = await open(phone);
    await close(phone, first);

    const second = await open(phone);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    await park(phone, '333333');
    expect(await claim(phone, second)).toBe('333333');
  });

  it('hands the code to exactly one of two callers racing for it', async () => {
    // Read-then-delete is the shape that lets both come away holding a live
    // credential. This is the one case that cannot be written with a single
    // connection, because a single connection cannot race itself.
    const phone = aNumber();
    const exchange = await open(phone);
    await park(phone, '123456');

    const [a, b] = await Promise.all([connect(), connect()]);
    try {
      const results = await Promise.all(
        [a, b].map(async (c) => {
          const { rows } = await c.query<{ waves_otp_relay_claim: string | null }>(
            'SELECT public.waves_otp_relay_claim($1, $2)',
            [phone, exchange],
          );
          return rows[0]!.waves_otp_relay_claim;
        }),
      );
      expect(results.filter((code) => code === '123456')).toHaveLength(1);
      expect(results.filter((code) => code === null)).toHaveLength(1);
    } finally {
      await a.end();
      await b.end();
    }
  });
});

/**
 * A Firebase proof is good for ten minutes and is refreshable, so "present the
 * same token twice" is not the only replay: a second token minted from the same
 * Firebase session is the same sign-in wearing a different signature. Both are
 * refused after the first, because one proof must not buy both a session and an
 * attachment to a different account.
 */
describe('one proof, one use', () => {
  it('is true the first time and false every time after', async () => {
    const uid = aFirebaseUid();
    expect(await useProof(uid, 1_770_000_000)).toBe(true);
    expect(await useProof(uid, 1_770_000_000)).toBe(false);
    expect(await useProof(uid, 1_770_000_000)).toBe(false);
  });

  it('is keyed on the sign-in, so a refreshed token is the same proof', async () => {
    // Nothing here carries the token: two different tokens from one Firebase
    // sign-in agree on `auth_time`, and that is what makes them the same proof.
    // Keyed on anything derived from the token itself, this would pin nothing.
    const uid = aFirebaseUid();
    expect(await useProof(uid, 1_770_000_100)).toBe(true);
    expect(await useProof(uid, 1_770_000_100)).toBe(false);

    // A genuinely new sign-in — they typed a second code — is a new proof.
    expect(await useProof(uid, 1_770_000_200)).toBe(true);
  });

  it('keeps one person’s sign-in apart from another’s', async () => {
    const authTime = 1_770_000_300;
    expect(await useProof(aFirebaseUid(), authTime)).toBe(true);
    expect(await useProof(aFirebaseUid(), authTime)).toBe(true);
  });

  it('is claimed by exactly one of two requests carrying it at once', async () => {
    // The whole attack in one line: sign in with the token on one device while
    // attaching it to a second account on another. Both arrive inside the ten
    // minutes, and only a race-safe claim decides between them.
    const uid = aFirebaseUid();
    const [a, b] = await Promise.all([connect(), connect()]);
    try {
      const results = await Promise.all(
        [a, b].map(async (c) => {
          const { rows } = await c.query<{ waves_firebase_assertion_use: boolean }>(
            'SELECT public.waves_firebase_assertion_use($1, $2)',
            [uid, 1_770_000_400],
          );
          return rows[0]!.waves_firebase_assertion_use;
        }),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('can be handed back, so a failure of ours is not a second SMS', async () => {
    // Released only when the exchange fell over on our side. The person is
    // holding a code they typed correctly; sending them back to Firebase for
    // another one is charging them for our outage.
    const uid = aFirebaseUid();
    expect(await useProof(uid, 1_770_000_500)).toBe(true);
    await releaseProof(uid, 1_770_000_500);
    expect(await useProof(uid, 1_770_000_500)).toBe(true);
  });

  it('refuses a proof with nothing in it rather than recording one', async () => {
    await expect(useProof('', 1)).rejects.toThrow(/uid and an auth_time/);
    await expect(useProof(aFirebaseUid(), 0)).rejects.toThrow(/uid and an auth_time/);
  });
});

/**
 * The allowance pays for messages. A relay that never filled and a GoTrue that
 * answered 502 sent nothing, and three of our own bad minutes must not be the
 * thing that locks somebody out for the day.
 */
describe('an attempt handed back', () => {
  it('lets the next ask through instead of refusing it', async () => {
    const phone = aNumber();
    await gate(phone);
    await gate(phone);
    expect((await gate(phone)).allowed).toBe(true);
    // The fourth would be refused — unless one of the three was never spent.
    await refund(phone);
    expect((await gate(phone)).allowed).toBe(true);
  });

  it('leaves no day behind when every ask was given back', async () => {
    // A row sitting at zero is a day that happened, and a day that happened at
    // the cap is a strike. A day that was entirely refunded did not happen.
    const phone = aNumber();
    await gate(phone);
    await refund(phone);
    expect(await hitsToday(phone)).toBeNull();
  });

  it('never goes below zero, and never invents a day that was not spent', async () => {
    const phone = aNumber();
    await refund(phone);
    expect(await hitsToday(phone)).toBeNull();
  });

  it('subtracts one attempt rather than pardoning the day', async () => {
    // Deliberately not `waves_phone_verified`, which clears the whole day
    // because somebody proved they were a person. Using that here would let
    // three failed exchanges erase a day of genuine evidence that a script is
    // working through the number.
    const phone = aNumber();
    await gate(phone);
    await gate(phone);
    await refund(phone);
    expect(await hitsToday(phone)).toBe(1);
  });

  it('does not reach back into yesterday', async () => {
    const phone = aNumber();
    await client.query(
      `INSERT INTO public.phone_otp_strikes (phone, day, hits)
       VALUES ($1, (now() AT TIME ZONE 'utc')::date - 1, 3)`,
      [phone],
    );
    await refund(phone);

    const { rows } = await client.query<{ hits: number }>(
      `SELECT hits FROM public.phone_otp_strikes WHERE phone = $1`,
      [phone],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hits).toBe(3);
  });
});

/**
 * ADR-006's in-place upgrade, in the one place it was not happening.
 *
 * Attaching an email runs through GoTrue's own change-verification, which clears
 * `is_anonymous` on the way past. Attaching a phone runs through the admin API,
 * which sets the number and nothing else — so the same person, through the other
 * door, kept the guest ceilings (one group, ten days, read-only after) while
 * holding a proved contact.
 */
describe('the guest ceiling a proved contact lifts', () => {
  it('answers false rather than throwing where auth.users has no such column', async () => {
    // The shape CI runs in: `auth` is a stub here and the stub has no
    // `is_anonymous`. Where the column does not exist there are no anonymous
    // users, so there is nothing to promote — and the guard is the difference
    // between that and an attachment that fails with a missing-column error.
    const { rows } = await client.query<{ promoted: boolean }>(
      'SELECT public.waves_promote_guest(gen_random_uuid()) AS promoted',
    );
    expect(rows[0]!.promoted).toBe(false);
  });

  it('promotes an anonymous account that now has a confirmed contact', async () => {
    // The columns are added inside a transaction that is rolled back, because
    // the stub `auth.users` this suite runs against does not have them and the
    // rule being proved is a rule about them. Nothing survives the test.
    await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);

    await client.query('BEGIN');
    try {
      await client.query(`
        ALTER TABLE auth.users
          ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz,
          ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz
      `);

      const { rows: made } = await client.query<{ id: string }>(
        `INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id`,
      );
      const guest = made[0]!.id;
      await client.query(`UPDATE auth.users SET is_anonymous = true WHERE id = $1`, [guest]);

      // No contact yet: the ceiling stays, because a promotion that can be asked
      // for without a proved contact is a way to lift it on any account at all.
      const { rows: early } = await client.query<{ promoted: boolean }>(
        'SELECT public.waves_promote_guest($1) AS promoted',
        [guest],
      );
      expect(early[0]!.promoted).toBe(false);

      await client.query(`UPDATE auth.users SET phone_confirmed_at = now() WHERE id = $1`, [guest]);

      const { rows: now } = await client.query<{ promoted: boolean }>(
        'SELECT public.waves_promote_guest($1) AS promoted',
        [guest],
      );
      expect(now[0]!.promoted).toBe(true);

      const { rows: after } = await client.query<{ is_anonymous: boolean }>(
        'SELECT is_anonymous FROM auth.users WHERE id = $1',
        [guest],
      );
      expect(after[0]!.is_anonymous).toBe(false);

      // Twice is a no-op, not a second promotion: the attach path is retried
      // whenever a connection drops mid-answer.
      const { rows: again } = await client.query<{ promoted: boolean }>(
        'SELECT public.waves_promote_guest($1) AS promoted',
        [guest],
      );
      expect(again[0]!.promoted).toBe(false);
    } finally {
      await client.query('ROLLBACK');
    }
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
    // A live sign-in credential and a list of proofs already spent. Neither is
    // anything a signed-in caller has business reading, and `authenticated` is
    // the role a guest session carries — a REVOKE that named only `anon` would
    // leave this open to every account in the app.
    await expect(asRole(role, 'SELECT * FROM public.otp_relay')).rejects.toThrow(/permission/i);
    await expect(asRole(role, 'SELECT * FROM public.firebase_assertions')).rejects.toThrow(
      /permission/i,
    );
    await expect(
      asRole(role, `SELECT public.waves_firebase_assertion_use('u', 1)`),
    ).rejects.toThrow(/permission/i);
    await expect(
      asRole(role, `SELECT public.waves_firebase_assertion_release('u', 1)`),
    ).rejects.toThrow(/permission/i);
    await expect(
      asRole(role, `SELECT public.waves_phone_gate_refund('+447700900123')`),
    ).rejects.toThrow(/permission/i);
    await expect(
      asRole(role, `SELECT public.waves_promote_guest(gen_random_uuid())`),
    ).rejects.toThrow(/permission/i);
  });
});
