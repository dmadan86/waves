/**
 * Families over the developer API: `units` on a group read and PATCH (validated
 * like /sync), `?by=family` on balances, and a `units` split passed through to
 * expense-write. Driven through the real Hono app with a signed token; only the
 * backend is faked.
 */

import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ME = randomUUID();
const [RAVI, PRIYA, ASHA] = [randomUUID(), randomUUID(), randomUUID()];
const GROUP = randomUUID();

const backend = {
  units: null as unknown,
  role: 'admin',
  patches: [] as Record<string, unknown>[],
  written: [] as Record<string, unknown>[],
};

function query(table: string) {
  let patch: Record<string, unknown> | null = null;
  const q: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => {
      if (table === 'group_members') {
        return resolve({
          data: [RAVI, PRIYA, ASHA].map((id) => ({
            id,
            role: id === RAVI ? backend.role : 'member',
            profile_id: id === RAVI ? ME : null,
          })),
          error: null,
        });
      }
      if (table === 'group_balances') {
        return resolve({
          data: [
            { group_id: GROUP, member_id: RAVI, currency: 'INR', balance: '-3000' },
            { group_id: GROUP, member_id: PRIYA, currency: 'INR', balance: '1000' },
            { group_id: GROUP, member_id: ASHA, currency: 'INR', balance: '2000' },
          ],
          error: null,
        });
      }
      if (table === 'groups') {
        if (patch) backend.patches.push(patch);
        return resolve({
          data: [{ id: GROUP, units: patch?.units ?? backend.units, updated_seq: 3 }],
          error: null,
        });
      }
      return resolve({ data: [], error: null });
    },
    update: (values: Record<string, unknown>) => {
      patch = values;
      return q;
    },
  };
  for (const m of ['select', 'eq', 'is', 'limit', 'order']) q[m] = () => q;
  return q;
}

const fakeClient = {
  from: query,
  rpc: async (fn: string) =>
    fn === 'waves_api_authorize_call'
      ? {
          data: {
            allowed: true,
            profileId: ME,
            appId: null,
            scopes: ['groups.read', 'groups.write', 'expenses.write'],
            limit: 100,
            remaining: 99,
            retryAfter: 0,
            resetAt: new Date(Date.now() + 60_000).toISOString(),
          },
          error: null,
        }
      : { data: null, error: null },
};

vi.mock('../src/server/session', async (original) => ({
  ...(await original<typeof import('../src/server/session')>()),
  clientFor: () => fakeClient,
  wavesFor: () => ({
    writeExpense: async (input: Record<string, unknown>) => {
      backend.written.push(input);
      return { expenseId: randomUUID() };
    },
  }),
}));

const { createApp } = await import('../src/app');
const { CredentialKind, mintCredential } = await import('../src/server/credentials');
const { forgetSigningProbe } = await import('../src/server/signing');

const app = createApp();
const token = mintCredential('t'.repeat(40), CredentialKind.Personal, ME).token;

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://api.example.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const SHARMA = { sharma: { name: 'Sharma family', members: [RAVI, PRIYA], head: PRIYA } };

beforeEach(() => {
  forgetSigningProbe();
  vi.stubEnv('WAVES_API_SUPABASE_URL', 'https://backend.example.test');
  vi.stubEnv('WAVES_API_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('WAVES_API_JWT_SECRET', 'j'.repeat(40));
  vi.stubEnv('WAVES_API_TOKEN_SECRET', 't'.repeat(40));
  vi.stubEnv('WAVES_API_WEB_URL', 'https://app.example.test');
  vi.stubEnv('WAVES_API_ALLOWED_ORIGINS', 'https://app.example.test');
  backend.units = SHARMA;
  backend.role = 'admin';
  backend.patches = [];
  backend.written = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  forgetSigningProbe();
});

describe('groups.units', () => {
  it('is returned on a group read, null when there are none', async () => {
    const body = (await (await call('GET', `/v1/groups/${GROUP}`)).json()) as { units: unknown };
    expect(body.units).toEqual(SHARMA);
    backend.units = null;
    const none = (await (await call('GET', `/v1/groups/${GROUP}`)).json()) as { units: unknown };
    expect(none.units).toBeNull();
  });

  it('is stored when valid, and normalised the way /sync does', async () => {
    const response = await call('PATCH', `/v1/groups/${GROUP}`, {
      units: { sharma: { name: '  Sharma family ', members: [RAVI, PRIYA] } },
    });
    expect(response.status).toBe(200);
    expect(backend.patches).toEqual([
      { units: { sharma: { name: 'Sharma family', members: [RAVI, PRIYA] } } },
    ]);
  });

  it.each([
    ['a stranger', { a: { name: 'A', members: [randomUUID()] } }],
    [
      'someone in two families',
      { a: { name: 'A', members: [RAVI] }, b: { name: 'B', members: [RAVI] } },
    ],
    ['a head outside the family', { a: { name: 'A', members: [RAVI], head: PRIYA } }],
    ['a long name', { a: { name: 'x'.repeat(25), members: [RAVI] } }],
    ['an array', [RAVI]],
  ])('refuses %s with a 400', async (_label, units) => {
    const response = await call('PATCH', `/v1/groups/${GROUP}`, { units });
    expect(response.status).toBe(400);
    expect(backend.patches).toEqual([]);
  });

  it('refuses a non-admin with a 403 before the database is asked', async () => {
    backend.role = 'member';
    const response = await call('PATCH', `/v1/groups/${GROUP}`, { units: SHARMA });
    expect(response.status).toBe(403);
    expect(backend.patches).toEqual([]);
  });

  it('refuses a family id that is a member id (it would net two balances away)', async () => {
    const response = await call('PATCH', `/v1/groups/${GROUP}`, {
      units: { [ASHA]: { name: 'Family A', members: [RAVI] } },
    });
    expect(response.status).toBe(400);
    expect(backend.patches).toEqual([]);
  });

  it('clears the families with null', async () => {
    await call('PATCH', `/v1/groups/${GROUP}`, { units: null });
    expect(backend.patches).toEqual([{ units: null }]);
  });
});

describe('GET balances?by=family', () => {
  it('rolls members up by family and keeps everyone else as a family of one', async () => {
    const response = await call('GET', `/v1/groups/${GROUP}/balances?by=family`);
    const body = (await response.json()) as { data: Record<string, unknown>[] };
    expect(body.data).toEqual([
      {
        unit_id: 'sharma',
        name: 'Sharma family',
        member_ids: [RAVI, PRIYA],
        currency: 'INR',
        amount: '-2000',
      },
      { unit_id: ASHA, name: null, member_ids: [ASHA], currency: 'INR', amount: '2000' },
    ]);
  });

  it('leaves the default untouched and refuses an unknown lens', async () => {
    const plain = (await (await call('GET', `/v1/groups/${GROUP}/balances`)).json()) as {
      data: { member_id: string }[];
    };
    expect(plain.data.map((row) => row.member_id)).toEqual([RAVI, PRIYA, ASHA]);
    expect((await call('GET', `/v1/groups/${GROUP}/balances?by=planet`)).status).toBe(400);
  });
});

describe('a units split', () => {
  it('reaches expense-write untouched', async () => {
    const split = { kind: 'units', units: { sharma: [RAVI, PRIYA], [ASHA]: [ASHA] } };
    // The read-back after the write is not faked, so only what was sent is checked.
    await call('POST', '/v1/expenses', {
      group_id: GROUP,
      description: 'Dinner',
      currency: 'INR',
      expense_date: '2026-10-20',
      amount: '9000',
      payers: { [RAVI]: '9000' },
      participants: [RAVI, PRIYA, ASHA],
      split,
    });
    expect(backend.written[0]?.splitParams).toEqual(split);
  });
});
