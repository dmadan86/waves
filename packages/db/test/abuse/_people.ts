/**
 * Fixtures for the abuse-audit tests: verified people on a stub `auth.users`
 * (the columns the identity check reads, as pro-trial.test.ts and
 * referrals.test.ts widen it), groups, expenses and device registrations.
 *
 * Every caller runs inside a transaction it rolls back itself.
 */

import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';

export async function stubAuthUsers(client: Client): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)`);
  for (const column of [
    'is_anonymous boolean NOT NULL DEFAULT false',
    'phone text',
    'phone_confirmed_at timestamptz',
    'email text',
    'email_confirmed_at timestamptz',
  ]) {
    await client.query(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS ${column}`);
  }
}

export interface PersonOptions {
  phone?: string | null;
  email?: string | null;
  guest?: boolean;
  /** Days since the phone / email was confirmed. Default 0: just now. */
  verifiedDaysAgo?: number;
  /** Days since the profile row was created. Default: same as verified. */
  profileAgeDays?: number;
  /** A device id registered to the account (device_sessions). */
  deviceId?: string;
}

export function digits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

/** A real, verified account. `phone: null, email: X` for an email-only one. */
export async function person(
  client: Client,
  options: PersonOptions = {},
  id: string = randomUUID(),
): Promise<string> {
  // The fixture is the server: no client claims may leak into the insert.
  await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
  const age = options.profileAgeDays ?? options.verifiedDaysAgo ?? 0;
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency, created_at)
     VALUES ($1, 'Person', 'INR', now() - make_interval(days => $2))
     ON CONFLICT (id) DO NOTHING`,
    [id, age],
  );
  const phone =
    options.guest || options.phone === null ? null : (options.phone ?? `9199${digits(8)}`);
  const email = options.guest ? null : (options.email ?? null);
  await client.query(
    `INSERT INTO auth.users (id, is_anonymous, phone, phone_confirmed_at, email, email_confirmed_at)
     VALUES ($1, $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() - make_interval(days => $5) END,
             $4, CASE WHEN $4::text IS NULL THEN NULL ELSE now() - make_interval(days => $5) END)`,
    [id, options.guest ?? false, phone, email, options.verifiedDaysAgo ?? 0],
  );
  if (options.deviceId) await registerDevice(client, id, options.deviceId);
  return id;
}

export async function registerDevice(client: Client, profile: string, deviceId: string) {
  await client.query(
    `INSERT INTO device_sessions (profile_id, device_id, label, platform)
     VALUES ($1, $2, 'Phone', 'android') ON CONFLICT (profile_id, device_id) DO NOTHING`,
    [profile, deviceId],
  );
}

/** Run `run` with the JWT claims of `profileId` (role authenticated), transaction-local. */
export async function asUser<T>(client: Client, profileId: string, run: () => Promise<T>) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  try {
    return await run();
  } finally {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
  }
}

export async function group(
  client: Client,
  profiles: string[],
): Promise<{ groupId: string; members: string[] }> {
  const groupId = randomUUID();
  await client.query(
    `INSERT INTO groups (id, name, type, default_currency, created_by)
     VALUES ($1, 'Flat', 'trip', 'INR', $2)`,
    [groupId, profiles[0]],
  );
  const members: string[] = [];
  for (const profileId of profiles) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
       VALUES ($1, $2, $3, 'member', 'creator')`,
      [id, groupId, profileId],
    );
    members.push(id);
  }
  return { groupId, members };
}

export async function expense(client: Client, groupId: string, memberId: string): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO expenses (id, group_id, created_by) VALUES ($1, $2, $3)`, [
    id,
    groupId,
    memberId,
  ]);
  return id;
}

export async function subscribe(client: Client, profile: string, status = 'active') {
  await client.query(
    `INSERT INTO subscriptions (profile_id, tier, period, status, current_period_end, store, store_txn_id)
     VALUES ($1, 'pro', 'monthly', $2, now() + interval '20 days', 'play', 'play:' || gen_random_uuid()::text)`,
    [profile, status],
  );
}

export const month = (): string => new Date().toISOString().slice(0, 7);
