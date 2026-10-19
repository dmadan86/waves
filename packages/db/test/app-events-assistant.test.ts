/**
 * Waves Assistant telemetry: the ten `assistant_*` events land in `app_events`
 * with enum-word props only, and nothing a person said or typed can ride along.
 *
 * Same write path as every other event (`waves_track_event`, callable signed
 * out); this file covers what the assistant migration added on top: the ten
 * names and the prop keys `kind`, `outcome`, `path`, `scope`, `how`, `field`
 * and `what`.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

const ASSISTANT_EVENTS = [
  'assistant_opened',
  'assistant_command',
  'assistant_followup_shown',
  'assistant_followup_answered',
  'assistant_followup_skipped',
  'assistant_followup_muted',
  'assistant_correction',
  'assistant_undo',
  'assistant_question_answered',
  'assistant_teaser_viewed',
] as const;

async function track(installId: string, name: string, props: unknown = {}): Promise<boolean> {
  const { rows } = await client.query(`SELECT public.waves_track_event($1, $2, $3, $4, $5) AS ok`, [
    installId,
    name,
    'android',
    '1.2.3',
    JSON.stringify(props),
  ]);
  return rows[0].ok;
}

const rowsFor = async (installId: string) =>
  (
    await client.query('SELECT * FROM public.app_events WHERE install_id = $1 ORDER BY id', [
      installId,
    ])
  ).rows;

describe('assistant events', () => {
  it.each(ASSISTANT_EVENTS)('accepts %s', async (name) => {
    const install = randomUUID();
    expect(await track(install, name, { scope: 'personal' })).toBe(true);
    const [row] = await rowsFor(install);
    expect(row.name).toBe(name);
    expect(row.props).toEqual({ scope: 'personal' });
  });

  it('keeps every assistant prop key as an enum word', async () => {
    const install = randomUUID();
    const props = {
      kind: 'place',
      outcome: 'dismissed',
      source: 'chip',
      path: 'device',
      scope: 'group',
      how: 'manual',
      field: 'amount',
      what: 'expense',
    };
    expect(await track(install, 'assistant_followup_answered', props)).toBe(true);
    expect((await rowsFor(install))[0].props).toEqual(props);
  });

  it('drops free text, numbers, nested values and unknown keys from assistant events', async () => {
    const install = randomUUID();
    expect(
      await track(install, 'assistant_command', {
        path: 'agent',
        outcome: 'confirmed',
        transcript: 'add 800 for lunch with Anu',
        kind: 'Where was this? Blue Tokai',
        scope: 800,
        field: { amount: 800 },
        description: 'lunch',
        how: 'x'.repeat(33),
      }),
    ).toBe(true);
    expect((await rowsFor(install))[0].props).toEqual({ path: 'agent', outcome: 'confirmed' });
  });

  it('still refuses a name that is not on the list, including a near miss', async () => {
    expect(await expectDenied(track(randomUUID(), 'assistant_transcript'))).toMatch(
      /UNKNOWN_EVENT/,
    );
    expect(await expectDenied(track(randomUUID(), 'Assistant_Opened'))).toMatch(/UNKNOWN_EVENT/);
  });

  it('rejects an assistant name written straight to the table if it is not allowed', async () => {
    await expectDenied(
      client.query(
        `INSERT INTO public.app_events (install_id, name) VALUES ($1, 'assistant_transcript')`,
        [randomUUID()],
      ),
    );
  });

  it('keeps the four original events working', async () => {
    const install = randomUUID();
    expect(await track(install, 'premium_viewed', { screen: 'assistant_teaser' })).toBe(true);
    expect((await rowsFor(install))[0].props).toEqual({ screen: 'assistant_teaser' });
  });

  it('allows an assistant event from a signed-out role, like the rest', async () => {
    const install = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE anon');
      const { rows } = await client.query(
        `SELECT public.waves_track_event($1, 'assistant_opened', 'ios', '1.0.0', '{"source":"typed"}') AS ok`,
        [install],
      );
      expect(rows[0].ok).toBe(true);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
