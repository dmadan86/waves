/**
 * A provider photo fills an empty profile avatar, and never replaces one the
 * user has. The trigger itself needs Supabase's auth schema; the rule lives in
 * waves_avatar_over_null, which is what these exercise.
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

async function seed(avatar: string | null): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, avatar_url, default_currency) VALUES ($1, 'P', $2, 'INR')`,
    [id, avatar],
  );
  return id;
}
async function avatarOf(id: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT avatar_url FROM profiles WHERE id = $1`, [id]);
  return rows[0]?.avatar_url ?? null;
}
async function offer(id: string, meta: Record<string, unknown>): Promise<boolean> {
  const { rows } = await client.query(`SELECT public.waves_avatar_over_null($1, $2::jsonb) AS r`, [
    id,
    JSON.stringify(meta),
  ]);
  return rows[0]?.r === true;
}

describe('provider photo offered to a profile', () => {
  it('fills a NULL avatar from avatar_url; a removed ('') one stays removed', async () => {
    const a = await seed(null);
    expect(await offer(a, { avatar_url: 'https://lh3.example/a', picture: 'https://x/y' })).toBe(true);
    expect(await avatarOf(a)).toBe('https://lh3.example/a');
    const b = await seed('');
    expect(await offer(b, { picture: 'https://lh3.example/b' })).toBe(false); // removed on purpose
    expect(await avatarOf(b)).toBe('');
  });
  it('never overwrites a photo the user already has', async () => {
    const id = await seed('uploads/me.jpg');
    expect(await offer(id, { picture: 'https://lh3.example/c' })).toBe(false);
    expect(await avatarOf(id)).toBe('uploads/me.jpg');
  });
  it('ignores non-http values', async () => {
    const id = await seed(null);
    expect(await offer(id, { picture: 'javascript:alert(1)', avatar_url: 'ftp://x' })).toBe(false);
    expect(await avatarOf(id)).toBeNull();
  });
});
