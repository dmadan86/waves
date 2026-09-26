/**
 * `POST /v1/friends/expenses` — an individual expense, with one person and no
 * group named.
 *
 * Driven through the real Hono app with a real, signed personal token, so the
 * scope check, idempotency and error envelope are the ones a developer meets.
 * Only the backend is replaced: `clientFor` and `wavesFor` hand back a small
 * Waves with several groups, where new groups and ghosts really appear, so a
 * retried or second request sees what the first one made.
 */

import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findPair, foldName, type PairGroup } from '../src/server/pair';

const ME = randomUUID();

type Row = {
  id: string;
  profile_id: string | null;
  ghost_name: string | null;
  profile: { display_name: string } | null;
};
type Group = { id: string; name: string; default_currency: string; members: Row[] };

const backend = {
  scopes: ['expenses.write', 'groups.write'] as string[],
  groups: [] as Group[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  expenses: [] as Record<string, unknown>[],
  failNextGhost: false,
};

function query(table: string) {
  let ids: string[] | null = null;
  let eqId: string | null = null;
  const q: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => {
      if (table === 'groups') {
        return resolve({
          data: backend.groups.map(({ id, name, default_currency }) => ({
            id,
            name,
            default_currency,
          })),
          error: null,
        });
      }
      if (table === 'group_members') {
        return resolve({
          data: backend.groups
            .filter((g) => !ids || ids.includes(g.id))
            .flatMap((g) => g.members.map((m) => ({ ...m, group_id: g.id }))),
          error: null,
        });
      }
      if (table === 'expenses') {
        const written = backend.expenses.find((e) => e.expenseId === eqId);
        return resolve({ data: written ? [expenseRow(written)] : [], error: null });
      }
      return resolve({ data: [], error: null });
    },
    maybeSingle: async () => ({ data: { default_currency: 'EUR' }, error: null }),
    in: (_: string, values: string[]) => {
      ids = values;
      return q;
    },
    eq: (_: string, value: string) => {
      eqId = value;
      return q;
    },
  };
  for (const m of ['select', 'is', 'limit', 'order']) q[m] = () => q;
  return q;
}

function expenseRow(written: Record<string, unknown>) {
  const payers = written.payers as Record<string, bigint>;
  return {
    id: written.expenseId,
    group_id: written.groupId,
    deleted_at: null,
    created_at: '2026-09-26T00:00:00Z',
    currentVersion: {
      version_no: 1,
      description: written.description,
      category: null,
      expense_date: written.expenseDate,
      currency: written.currency,
      amount: String(written.amount),
      split_type: (written.splitParams as { kind: string }).kind,
      location: null,
      payers: Object.entries(payers).map(([member_id, amount]) => ({ member_id, amount })),
      shares: [],
    },
  };
}

const fakeClient = {
  from: query,
  rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'waves_api_authorize_call') {
      return {
        data: {
          allowed: true,
          profileId: ME,
          appId: null,
          scopes: backend.scopes,
          limit: 100,
          remaining: 99,
          retryAfter: 0,
          resetAt: new Date(Date.now() + 60_000).toISOString(),
        },
        error: null,
      };
    }
    backend.rpcs.push({ fn, args });
    if (fn === 'waves_create_group') {
      // Like the real function: a group id already taken by the caller is a
      // replay and returns that group rather than a second one.
      if (backend.groups.some((g) => g.id === args.p_group_id)) {
        return { data: args.p_group_id, error: null };
      }
      backend.groups.push({
        id: String(args.p_group_id),
        name: String(args.p_name),
        default_currency: String(args.p_currency),
        members: [
          {
            id: String(args.p_creator_member_id),
            profile_id: ME,
            ghost_name: null,
            profile: { display_name: 'Madan Deivasigmani' },
          },
        ],
      });
    }
    if (fn === 'waves_add_ghost_member') {
      if (backend.failNextGhost) {
        backend.failNextGhost = false;
        // A real PostgrestError, which extends Error, is what the client hands back.
        return {
          data: null,
          error: Object.assign(new Error('connection reset'), { code: '08006' }),
        };
      }
      backend.groups
        .find((g) => g.id === args.p_group_id)!
        .members.push({
          id: String(args.p_member_id),
          profile_id: null,
          ghost_name: String(args.p_name),
          profile: null,
        });
    }
    return { data: null, error: null };
  },
};

const fakeWaves = {
  writeExpense: async (input: Record<string, unknown>) => {
    // The edge function is idempotent on clientMutationId; so is this.
    const again = backend.expenses.find((e) => e.clientMutationId === input.clientMutationId);
    if (again) return { expenseId: again.expenseId };
    const expenseId = randomUUID();
    backend.expenses.push({ ...input, expenseId });
    return { expenseId };
  },
};

vi.mock('../src/server/session', async (original) => ({
  ...(await original<typeof import('../src/server/session')>()),
  clientFor: () => fakeClient,
  wavesFor: () => fakeWaves,
}));

const { createApp } = await import('../src/app');
const { CredentialKind, mintCredential } = await import('../src/server/credentials');
const { forgetSigningProbe } = await import('../src/server/signing');

const app = createApp();
const token = mintCredential('token-secret', CredentialKind.Personal, ME).token;

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.fetch(
    new Request('https://api.example.test/v1/friends/expenses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

const DINNER = {
  name: 'Renny',
  description: 'Dinner',
  amount: '100000',
  expense_date: '2026-09-26',
  paid_by: 'them',
};

function group(id: string, others: string[], currency = 'INR'): Group {
  return {
    id,
    name: others.join(', '),
    default_currency: currency,
    members: [
      { id: `${id}-me`, profile_id: ME, ghost_name: null, profile: { display_name: 'Madan D' } },
      ...others.map((name) => ({
        id: `${id}-${foldName(name).replace(/\W/g, '')}`,
        profile_id: null,
        ghost_name: name,
        profile: null,
      })),
    ],
  };
}

beforeEach(() => {
  forgetSigningProbe();
  vi.stubEnv('WAVES_API_SUPABASE_URL', 'https://backend.example.test');
  vi.stubEnv('WAVES_API_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('WAVES_API_JWT_SECRET', 'jwt-secret');
  vi.stubEnv('WAVES_API_TOKEN_SECRET', 'token-secret');
  vi.stubEnv('WAVES_API_WEB_URL', 'https://app.example.test');
  vi.stubEnv('WAVES_API_ALLOWED_ORIGINS', 'https://app.example.test');
  backend.scopes = ['expenses.write', 'groups.write'];
  backend.groups = [];
  backend.rpcs = [];
  backend.expenses = [];
  backend.failNextGhost = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  forgetSigningProbe();
});

describe('POST /v1/friends/expenses', () => {
  it('files it in the one-to-one with Renny, with Renny paying', async () => {
    backend.groups = [group('trip', ['Renny', 'Matt']), group('pair', ['Renny Benita'])];

    const response = await post(DINNER);

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      group_id: 'pair',
      created_group: false,
      person: { member_id: 'pair-rennybenita', name: 'Renny Benita' },
      expense: { group_id: 'pair', amount: '100000', currency: 'INR' },
    });
    expect(backend.rpcs).toEqual([]);
    const [written] = backend.expenses;
    expect(written).toMatchObject({
      groupId: 'pair',
      participants: ['pair-me', 'pair-rennybenita'],
      payers: { 'pair-rennybenita': 100000n },
      splitParams: { kind: 'equal' },
    });
  });

  it('starts a one-to-one named after them, in my own currency, the first time', async () => {
    const response = await post({ ...DINNER, name: 'Priya', paid_by: 'me' });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { group_id: string; created_group: boolean };
    expect(body.created_group).toBe(true);
    expect(backend.rpcs.map((r) => r.fn)).toEqual(['waves_create_group', 'waves_add_ghost_member']);
    expect(backend.rpcs[0]!.args).toMatchObject({
      p_name: 'Priya',
      p_type: 'other',
      p_currency: 'EUR',
      p_group_id: body.group_id,
    });
    expect(backend.expenses[0]).toMatchObject({ groupId: body.group_id, currency: 'EUR' });
  });

  it('a retry with the same Idempotency-Key makes one group and one expense', async () => {
    const headers = { 'Idempotency-Key': 'dinner-with-priya-1' };

    const first = await post({ ...DINNER, name: 'Priya' }, headers);
    const again = await post({ ...DINNER, name: 'Priya' }, headers);

    expect([first.status, again.status]).toEqual([201, 201]);
    expect(backend.groups).toHaveLength(1);
    expect(backend.expenses).toHaveLength(1);
    const a = (await first.json()) as { group_id: string; expense: { id: string } };
    const b = (await again.json()) as { group_id: string; expense: { id: string } };
    expect(b.group_id).toBe(a.group_id);
    expect(b.expense.id).toBe(a.expense.id);
  });

  it('a retry after failing halfway finishes the same group instead of starting another', async () => {
    const headers = { 'Idempotency-Key': 'dinner-with-priya-2' };
    backend.failNextGhost = true;

    const failed = await post({ ...DINNER, name: 'Priya' }, headers);
    const retried = await post({ ...DINNER, name: 'Priya' }, headers);

    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(retried.status).toBe(201);
    expect(backend.groups).toHaveLength(1);
    expect(backend.groups[0]!.members).toHaveLength(2);
    expect(backend.expenses).toHaveLength(1);
  });

  it('turns "mine" and "theirs" into exact shares for the right members', async () => {
    backend.groups = [group('pair', ['Renny Benita'])];

    await post({ ...DINNER, split: { kind: 'exact', mine: '70000', theirs: '30000' } });

    expect(backend.expenses[0]!.splitParams).toEqual({
      kind: 'exact',
      amounts: { 'pair-me': '70000', 'pair-rennybenita': '30000' },
    });
  });

  it('answers 409 with both groups when two one-to-ones answer to the name', async () => {
    backend.groups = [group('g1', ['Renny Benita']), group('g2', ['Renny Joseph'])];

    const response = await post(DINNER);

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string; details: { candidates: { group_id: string }[] } };
    };
    expect(body.error.code).toBe('conflict');
    expect(body.error.details.candidates.map((c) => c.group_id)).toEqual(['g1', 'g2']);
    expect(backend.expenses).toHaveLength(0);
  });

  it('needs groups.write to start a one-to-one, but not to use one', async () => {
    backend.scopes = ['expenses.write'];

    const refused = await post({ ...DINNER, name: 'Priya' });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'insufficient_scope',
    );
    expect(backend.rpcs).toHaveLength(0);

    backend.groups = [group('pair', ['Renny Benita'])];
    expect((await post(DINNER)).status).toBe(201);
  });

  it.each([
    [{ name: 'me' }, 'name'],
    [{ amount: '1000.50' }, 'amount'],
    [{ paid_by: 'Renny' }, 'paid_by'],
    [{ split: { kind: 'shares' } }, 'split'],
    [{ expense_date: undefined }, 'expense_date'],
  ])('refuses %j before writing anything', async (change, field) => {
    const response = await post({ ...DINNER, ...change });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(field);
    expect(backend.rpcs).toHaveLength(0);
    expect(backend.expenses).toHaveLength(0);
  });
});

describe('findPair, the API twin of the MCP rule', () => {
  const pair = (groupId: string, them: string): PairGroup => ({
    groupId,
    groupName: them,
    currency: 'INR',
    members: [
      { memberId: 'me', profileId: ME, name: 'Madan' },
      { memberId: 'them', profileId: null, name: them },
    ],
  });

  it('agrees with the MCP server on every rule', () => {
    expect(findPair([pair('g', 'Renny Benita')], ME, 'renny').kind).toBe('found');
    expect(findPair([pair('g', 'Renée')], ME, 'Renee').kind).toBe('found');
    expect(findPair([pair('a', 'Raj'), pair('b', 'Raj Kumar')], ME, 'Raj')).toMatchObject({
      group: { groupId: 'a' },
    });
    expect(findPair([pair('g', 'Renny Benita')], ME, 'Renny B').kind).toBe('none');
    expect(findPair([pair('a', 'Renny Benita'), pair('b', 'Renny Joseph')], ME, 'Renny').kind).toBe(
      'ambiguous',
    );
  });
});
