/**
 * Taking a phone or email off an account, and the week after — against a real
 * Postgres.
 *
 * `waves_unlink_contact` is where both rules actually live: seven days on the
 * account before a contact can come off, and never leaving an account with no
 * way in. The trigger on `auth.users` is the other half of the seven days —
 * nothing new on a channel for a week after it was cleared — and it is the only
 * check that holds for every path a contact can arrive by (`phone-verify`'s
 * admin attach, GoTrue's own phone and email change).
 *
 * CI migrates a bare Postgres with no `auth` schema, so the migration's trigger
 * is skipped there and the functions have nothing to act on. Each test here
 * therefore stands up the smallest `auth` that looks like GoTrue's — the columns
 * these functions read and write, an `identities` table — and installs the
 * trigger exactly as the migration does, inside a transaction that is rolled
 * back. Nothing survives a test, so the stub cannot leak into the suites that
 * build their own narrower one.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

/** The GoTrue shape, as far as these functions care, and the trigger on it. */
async function standUpAuth(): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
  await client.query(`
    ALTER TABLE auth.users
      ADD COLUMN IF NOT EXISTS email text,
      ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
      ADD COLUMN IF NOT EXISTS phone text,
      ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz,
      ADD COLUMN IF NOT EXISTS phone_change text DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone_change_token text DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone_change_sent_at timestamptz,
      ADD COLUMN IF NOT EXISTS email_change text DEFAULT '',
      ADD COLUMN IF NOT EXISTS email_change_token_new text DEFAULT '',
      ADD COLUMN IF NOT EXISTS email_change_token_current text DEFAULT '',
      ADD COLUMN IF NOT EXISTS email_change_confirm_status smallint DEFAULT 0,
      ADD COLUMN IF NOT EXISTS email_change_sent_at timestamptz,
      ADD COLUMN IF NOT EXISTS confirmation_token text DEFAULT '',
      ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
      ADD COLUMN IF NOT EXISTS recovery_token text DEFAULT '',
      ADD COLUMN IF NOT EXISTS recovery_sent_at timestamptz,
      ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb,
      ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.identities (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       uuid NOT NULL,
      provider      text NOT NULL,
      identity_data jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  // Word for word what the migration does where `auth.users` exists.
  await client.query(`DROP TRIGGER IF EXISTS waves_contact_relink_guard ON auth.users`);
  await client.query(`
    CREATE TRIGGER waves_contact_relink_guard
      BEFORE UPDATE ON auth.users
      FOR EACH ROW
      WHEN (NEW.phone IS DISTINCT FROM OLD.phone
         OR NEW.email IS DISTINCT FROM OLD.email
         OR NEW.phone_change IS DISTINCT FROM OLD.phone_change
         OR NEW.email_change IS DISTINCT FROM OLD.email_change)
      EXECUTE FUNCTION public.waves_contact_relink_guard()
  `);
}

/** Everything in a transaction that is always rolled back. */
async function inTx(run: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await standUpAuth();
    await run();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** The statement's error message, or a failure if it did not raise. */
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT expect_raise');
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expect_raise');
    return (error as Error).message;
  }
  await client.query('RELEASE SAVEPOINT expect_raise');
  throw new Error(`expected to raise: ${sql}`);
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

interface Person {
  email?: string | null;
  emailConfirmed?: string | null;
  phone?: string | null;
  phoneConfirmed?: string | null;
  providers?: string[];
  oauth?: { provider: 'google' | 'apple'; email?: string }[];
}

async function person(options: Person = {}): Promise<string> {
  const id = randomUUID();
  const providers = options.providers ?? [
    ...(options.email ? ['email'] : []),
    ...(options.phone ? ['phone'] : []),
    ...(options.oauth ?? []).map((o) => o.provider),
  ];
  await client.query(
    `INSERT INTO auth.users
       (id, email, email_confirmed_at, phone, phone_confirmed_at, raw_app_meta_data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      options.email ?? null,
      options.email
        ? options.emailConfirmed === undefined
          ? daysAgo(30)
          : options.emailConfirmed
        : null,
      options.phone ?? null,
      options.phone
        ? options.phoneConfirmed === undefined
          ? daysAgo(30)
          : options.phoneConfirmed
        : null,
      JSON.stringify({ provider: providers[0] ?? 'email', providers }),
    ],
  );
  if (options.email) {
    await client.query(`INSERT INTO auth.identities (user_id, provider) VALUES ($1, 'email')`, [
      id,
    ]);
  }
  if (options.phone) {
    await client.query(`INSERT INTO auth.identities (user_id, provider) VALUES ($1, 'phone')`, [
      id,
    ]);
  }
  for (const o of options.oauth ?? []) {
    await client.query(
      `INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ($1, $2, $3)`,
      [id, o.provider, JSON.stringify(o.email ? { email: o.email } : {})],
    );
  }
  return id;
}

interface Answer {
  unlinked?: boolean;
  refused?: string;
  unlock_at?: string;
}

async function unlink(user: string, channel: string): Promise<Answer> {
  const { rows } = await client.query<{ answer: Answer }>(
    'SELECT public.waves_unlink_contact($1, $2) AS answer',
    [user, channel],
  );
  return rows[0]!.answer;
}

async function account(user: string) {
  const { rows } = await client.query(`SELECT * FROM auth.users WHERE id = $1`, [user]);
  return rows[0] as Record<string, unknown>;
}

async function providersOf(user: string): Promise<string[]> {
  const { rows } = await client.query<{ provider: string }>(
    `SELECT provider FROM auth.identities WHERE user_id = $1 ORDER BY provider`,
    [user],
  );
  return rows.map((row) => row.provider);
}

describe('unlinking a contact', () => {
  it('takes a phone off an account that can still sign in by email', async () => {
    await inTx(async () => {
      const user = await person({ email: 'a@example.com', phone: '447700900001' });
      await client.query(
        `UPDATE auth.users SET phone_change = '447700900002', phone_change_token = 'tok' WHERE id = $1`,
        [user],
      );

      expect(await unlink(user, 'phone')).toEqual({ unlinked: true });

      const row = await account(user);
      expect(row.phone).toBeNull();
      expect(row.phone_confirmed_at).toBeNull();
      expect(row.phone_change).toBe('');
      expect(row.phone_change_token).toBe('');
      // The other channel is untouched.
      expect(row.email).toBe('a@example.com');
      expect(row.email_confirmed_at).not.toBeNull();

      expect(await providersOf(user)).toEqual(['email']);
      expect((row.raw_app_meta_data as { providers: string[] }).providers).toEqual(['email']);

      const { rows } = await client.query(
        `SELECT channel FROM public.contact_unlinks WHERE user_id = $1`,
        [user],
      );
      expect(rows).toEqual([{ channel: 'phone' }]);
    });
  });

  it('takes an email off, with every change and reset in flight for it', async () => {
    await inTx(async () => {
      const user = await person({ email: 'b@example.com', phone: '447700900003' });
      await client.query(
        `UPDATE auth.users
            SET recovery_token = 'reset-me', email_change_token_new = 'x',
                email_change_confirm_status = 1
          WHERE id = $1`,
        [user],
      );

      expect(await unlink(user, 'email')).toEqual({ unlinked: true });

      const row = await account(user);
      expect(row.email).toBeNull();
      expect(row.email_confirmed_at).toBeNull();
      // A reset link already sitting in the old inbox must not still open it.
      expect(row.recovery_token).toBe('');
      expect(row.email_change_token_new).toBe('');
      expect(row.email_change_confirm_status).toBe(0);
      // The provider list is rewritten, and so is `provider` when it named email.
      expect(row.raw_app_meta_data).toEqual({ provider: 'phone', providers: ['phone'] });
      expect(await providersOf(user)).toEqual(['phone']);
    });
  });

  it('counts a Google or Apple identity as a way in', async () => {
    await inTx(async () => {
      const user = await person({ phone: '447700900004', oauth: [{ provider: 'apple' }] });
      expect(await unlink(user, 'phone')).toEqual({ unlinked: true });
      // The social identity is never what gets removed.
      expect(await providersOf(user)).toEqual(['apple']);
    });
  });

  it('moves the date forward on a second unlink rather than adding a row', async () => {
    await inTx(async () => {
      const user = await person({ email: 'c@example.com', phone: '447700900005' });
      await client.query(
        `INSERT INTO public.contact_unlinks (user_id, channel, unlinked_at) VALUES ($1, 'phone', $2)`,
        [user, daysAgo(60)],
      );
      expect(await unlink(user, 'phone')).toEqual({ unlinked: true });
      const { rows } = await client.query<{ fresh: boolean }>(
        `SELECT unlinked_at > now() - interval '1 minute' AS fresh
           FROM public.contact_unlinks WHERE user_id = $1`,
        [user],
      );
      expect(rows).toEqual([{ fresh: true }]);
    });
  });
});

describe('the refusals', () => {
  it('has nothing to unlink on an empty channel', async () => {
    await inTx(async () => {
      const user = await person({ email: 'd@example.com' });
      expect(await unlink(user, 'phone')).toEqual({ refused: 'NOT_LINKED' });
    });
  });

  it('treats a contact that was never confirmed as not linked', async () => {
    await inTx(async () => {
      const user = await person({
        email: 'e@example.com',
        phone: '447700900006',
        phoneConfirmed: null,
      });
      expect(await unlink(user, 'phone')).toEqual({ refused: 'NOT_LINKED' });
    });
  });

  it('has nothing to unlink on an account that does not exist', async () => {
    await inTx(async () => {
      expect(await unlink(randomUUID(), 'email')).toEqual({ refused: 'NOT_LINKED' });
    });
  });

  it('refuses inside seven days of linking, and says when it unlocks', async () => {
    await inTx(async () => {
      const confirmed = daysAgo(2);
      const user = await person({
        email: 'f@example.com',
        phone: '447700900007',
        phoneConfirmed: confirmed,
      });

      const answer = await unlink(user, 'phone');
      expect(answer.refused).toBe('TOO_SOON');
      expect(new Date(answer.unlock_at!).getTime()).toBe(new Date(confirmed).getTime() + 7 * DAY);
      // Nothing was touched.
      expect((await account(user)).phone).toBe('447700900007');
      expect(await providersOf(user)).toEqual(['email', 'phone']);
    });
  });

  it('refuses to take away the last way in', async () => {
    await inTx(async () => {
      const user = await person({ phone: '447700900008' });
      expect(await unlink(user, 'phone')).toEqual({ refused: 'LAST_SIGN_IN' });
      expect((await account(user)).phone).toBe('447700900008');
    });
  });

  it('does not count an unconfirmed email as a way in', async () => {
    await inTx(async () => {
      const user = await person({
        phone: '447700900009',
        email: 'g@example.com',
        emailConfirmed: null,
      });
      expect(await unlink(user, 'phone')).toEqual({ refused: 'LAST_SIGN_IN' });
    });
  });

  it('refuses the second of two unlinks that would together leave nothing', async () => {
    await inTx(async () => {
      const user = await person({ email: 'h@example.com', phone: '447700900010' });
      expect(await unlink(user, 'email')).toEqual({ unlinked: true });
      expect(await unlink(user, 'phone')).toEqual({ refused: 'LAST_SIGN_IN' });
    });
  });

  it('raises on a channel it does not know', async () => {
    await inTx(async () => {
      const user = await person({ email: 'i@example.com' });
      expect(await raises('SELECT public.waves_unlink_contact($1, $2)', [user, 'google'])).toMatch(
        /UNKNOWN_CHANNEL/,
      );
    });
  });
});

describe('nothing new for seven days after', () => {
  it('refuses a new phone, and a phone change, until the week is up', async () => {
    await inTx(async () => {
      const user = await person({ email: 'j@example.com', phone: '447700900011' });
      await unlink(user, 'phone');

      expect(
        await raises(`UPDATE auth.users SET phone = '447700900012' WHERE id = $1`, [user]),
      ).toMatch(/CONTACT_RELINK_COOLDOWN/);
      // The same number back is still a new number on a cleared channel.
      expect(
        await raises(`UPDATE auth.users SET phone = '447700900011' WHERE id = $1`, [user]),
      ).toMatch(/CONTACT_RELINK_COOLDOWN/);
      expect(
        await raises(`UPDATE auth.users SET phone_change = '447700900012' WHERE id = $1`, [user]),
      ).toMatch(/CONTACT_RELINK_COOLDOWN/);

      const { rows } = await client.query<{ open_at: Date | null }>(
        `SELECT public.waves_contact_relink_open_at($1, 'phone') AS open_at`,
        [user],
      );
      expect(rows[0]!.open_at).not.toBeNull();

      await client.query(
        `UPDATE public.contact_unlinks SET unlinked_at = now() - interval '8 days' WHERE user_id = $1`,
        [user],
      );
      await client.query(`UPDATE auth.users SET phone = '447700900012' WHERE id = $1`, [user]);
      expect((await account(user)).phone).toBe('447700900012');
    });
  });

  it('refuses a new email, and a pending email change, until the week is up', async () => {
    await inTx(async () => {
      const user = await person({ email: 'k@example.com', phone: '447700900013' });
      await unlink(user, 'email');

      expect(
        await raises(`UPDATE auth.users SET email_change = 'new@example.com' WHERE id = $1`, [
          user,
        ]),
      ).toMatch(/CONTACT_RELINK_COOLDOWN/);
      expect(
        await raises(`UPDATE auth.users SET email = 'new@example.com' WHERE id = $1`, [user]),
      ).toMatch(/CONTACT_RELINK_COOLDOWN/);
    });
  });

  it('only watches the channel that was cleared', async () => {
    await inTx(async () => {
      const user = await person({ email: 'l@example.com', phone: '447700900014' });
      await unlink(user, 'phone');
      await client.query(`UPDATE auth.users SET email = 'm@example.com' WHERE id = $1`, [user]);
      expect((await account(user)).email).toBe('m@example.com');
    });
  });

  it('lets every ordinary sign-in write through', async () => {
    await inTx(async () => {
      const user = await person({ email: 'n@example.com', phone: '447700900015' });
      await unlink(user, 'phone');
      await client.query(
        `UPDATE auth.users
            SET last_sign_in_at = now(),
                raw_app_meta_data = raw_app_meta_data || '{"x":1}'::jsonb,
                email = email
          WHERE id = $1`,
        [user],
      );
      expect((await account(user)).last_sign_in_at).not.toBeNull();
    });
  });

  it('never blocks a Google sign-in copying its own email back', async () => {
    await inTx(async () => {
      const user = await person({
        email: 'o@example.com',
        oauth: [{ provider: 'google', email: 'O@example.com' }],
      });
      expect(await unlink(user, 'email')).toEqual({ unlinked: true });

      // The address the Google identity carries goes back on; anything else waits.
      expect(
        await raises(`UPDATE auth.users SET email = 'other@example.com' WHERE id = $1`, [user]),
      ).toMatch(/CONTACT_RELINK_COOLDOWN/);
      await client.query(`UPDATE auth.users SET email = 'o@example.com' WHERE id = $1`, [user]);
      expect((await account(user)).email).toBe('o@example.com');
    });
  });

  it('does not watch an account that never unlinked anything', async () => {
    await inTx(async () => {
      const user = await person({ email: 'p@example.com' });
      await client.query(`UPDATE auth.users SET phone = '447700900016' WHERE id = $1`, [user]);
      expect((await account(user)).phone).toBe('447700900016');
    });
  });
});

describe('who can reach it', () => {
  it('lets a signed-in person read their own cooldown, and nobody else’s', async () => {
    await inTx(async () => {
      const mine = await person({ email: 'q@example.com', phone: '447700900017' });
      const theirs = await person({ email: 'r@example.com', phone: '447700900018' });
      await unlink(mine, 'phone');
      await unlink(theirs, 'phone');

      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: mine, role: 'authenticated' }),
      ]);
      await client.query('SET LOCAL ROLE authenticated');

      const { rows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM public.contact_unlinks`,
      );
      expect(rows.map((row) => row.user_id)).toEqual([mine]);

      // Lifting your own cooldown is exactly what a client must not be able to do.
      expect(await raises(`DELETE FROM public.contact_unlinks WHERE user_id = $1`, [mine])).toMatch(
        /permission denied/,
      );
      expect(
        await raises(`INSERT INTO public.contact_unlinks (user_id, channel) VALUES ($1, 'email')`, [
          mine,
        ]),
      ).toMatch(/permission denied/);
      expect(await raises(`SELECT public.waves_unlink_contact($1, 'email')`, [mine])).toMatch(
        /permission denied/,
      );
      expect(
        await raises(`SELECT public.waves_contact_relink_open_at($1, 'phone')`, [mine]),
      ).toMatch(/permission denied/);
      await client.query('RESET ROLE');
    });
  });

  it('is closed to a signed-out caller entirely', async () => {
    await inTx(async () => {
      await client.query('SET LOCAL ROLE anon');
      expect(await raises(`SELECT * FROM public.contact_unlinks`)).toMatch(/permission denied/);
      expect(
        await raises(`SELECT public.waves_unlink_contact(gen_random_uuid(), 'phone')`),
      ).toMatch(/permission denied/);
      await client.query('RESET ROLE');
    });
  });
});
