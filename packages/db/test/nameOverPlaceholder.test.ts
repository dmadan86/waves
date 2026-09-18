/**
 * "Guest" is a placeholder, and a placeholder is allowed to be replaced. A name
 * somebody chose is not.
 *
 * `waves_handle_new_user()` stamps a profile's `display_name` exactly once,
 * from whatever the provider sent at the instant the `auth.users` row appeared.
 * An email-and-password sign-up sends none of the three keys it looks at, so
 * the ladder falls through to `Guest` — correct at that instant, and never
 * revisited afterwards. A customer signed up by email, confirmed the address,
 * later linked Google, and went on being called Guest on their own settings
 * screen and to everybody they split a bill with.
 *
 * The repair is `waves_name_over_placeholder`, called by a new AFTER UPDATE
 * trigger on `auth.users`. The trigger cannot run here — this is a plain
 * Postgres with no `auth` schema — which is exactly why the rule it applies
 * lives in a function of its own rather than inside the trigger body. These are
 * the cases that decide whether the repair is safe to let loose on a live
 * table.
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

/** A profile row as the new-user trigger would have written it. */
async function seedProfile(displayName: string | null): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, $2, 'INR')`,
    [id, displayName],
  );
  return id;
}

async function nameOf(id: string): Promise<string | null> {
  const { rows } = await client.query<{ display_name: string | null }>(
    `SELECT display_name FROM profiles WHERE id = $1`,
    [id],
  );
  return rows[0]?.display_name ?? null;
}

async function offer(id: string, meta: Record<string, unknown>): Promise<boolean> {
  const { rows } = await client.query<{ renamed: boolean }>(
    `SELECT public.waves_name_over_placeholder($1, $2::jsonb) AS renamed`,
    [id, JSON.stringify(meta)],
  );
  return rows[0]?.renamed === true;
}

describe('the name a provider sent, offered to a profile', () => {
  it('replaces the Guest placeholder', async () => {
    const id = await seedProfile('Guest');
    expect(await offer(id, { full_name: 'Priya Raman' })).toBe(true);
    expect(await nameOf(id)).toBe('Priya Raman');
  });

  it('replaces an empty name, and a null one', async () => {
    const blank = await seedProfile('');
    const missing = await seedProfile(null);
    expect(await offer(blank, { name: 'Arun' })).toBe(true);
    expect(await offer(missing, { name: 'Arun' })).toBe(true);
    expect(await nameOf(blank)).toBe('Arun');
    expect(await nameOf(missing)).toBe('Arun');
  });

  /**
   * The case worth having a test for. Somebody who named themselves two years
   * ago links a provider today; the provider's idea of their name must not win.
   */
  it('never overwrites a name somebody chose', async () => {
    const id = await seedProfile('Priya');
    expect(await offer(id, { full_name: 'Priya Raman' })).toBe(false);
    expect(await nameOf(id)).toBe('Priya');
  });

  /** Somebody who really is called Guest keeps it — the placeholder wins the
   *  tie, and losing it would mean this repair renamed them on every update. */
  it('leaves a placeholder alone when the metadata names nobody', async () => {
    const id = await seedProfile('Guest');
    expect(await offer(id, {})).toBe(false);
    expect(await offer(id, { full_name: '   ' })).toBe(false);
    expect(await nameOf(id)).toBe('Guest');
  });

  /** The ladder, in the order `waves_handle_new_user()` reads it. */
  it('prefers display_name, then full_name, then name', async () => {
    const all = await seedProfile('Guest');
    await offer(all, { display_name: 'Chosen', full_name: 'Full', name: 'Plain' });
    expect(await nameOf(all)).toBe('Chosen');

    const two = await seedProfile('Guest');
    await offer(two, { full_name: 'Full', name: 'Plain' });
    expect(await nameOf(two)).toBe('Full');

    const one = await seedProfile('Guest');
    await offer(one, { name: 'Plain' });
    expect(await nameOf(one)).toBe('Plain');
  });

  /** Whitespace around a provider's name is the provider's, not the person's. */
  it('trims what it writes', async () => {
    const id = await seedProfile('Guest');
    await offer(id, { full_name: '  Priya Raman  ' });
    expect(await nameOf(id)).toBe('Priya Raman');
  });

  /** Running the repair twice must be the same as running it once. */
  it('is idempotent', async () => {
    const id = await seedProfile('Guest');
    expect(await offer(id, { name: 'Arun' })).toBe(true);
    expect(await offer(id, { name: 'Somebody Else' })).toBe(false);
    expect(await nameOf(id)).toBe('Arun');
  });

  /** An account with no profile row yet is not an error — the new-user trigger
   *  has simply not landed, and it will write the metadata name itself. */
  it('says no when there is no profile to rename', async () => {
    expect(await offer(randomUUID(), { name: 'Nobody' })).toBe(false);
  });
});

/**
 * ADR-013: a definer function that writes `profiles` bypasses RLS, so a client
 * role that could call it with any uuid could rename any unnamed stranger.
 */
describe('who may call it', () => {
  it('is out of reach of anon and authenticated, and reachable by service_role', async () => {
    const { rows } = await client.query<{
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(
      `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'waves_name_over_placeholder'`,
    );
    expect(rows).toEqual([{ anon: false, authenticated: false, service_role: true }]);
  });
});
