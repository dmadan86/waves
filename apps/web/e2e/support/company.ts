import type { Page, Route } from '@playwright/test';

/**
 * Shared fixtures for the company e2e specs: a signed-in browser with no real
 * account behind it. Supabase auth is a seeded localStorage session, the
 * `sync` edge function is answered from an in-memory mirror, and every
 * `rest/v1` call is stubbed — so nothing touches a project, prod or local.
 * Fake ids and names only.
 */

export const GROUP = '11111111-1111-4111-8111-111111111111';
export const OWNER_PROFILE = '22222222-2222-4222-8222-222222222222';
export const EMP_PROFILE = '33333333-3333-4333-8333-333333333333';
export const OWNER_MEMBER = 'aaaaaaaa-0000-4000-8000-000000000001';
export const EMP_MEMBER = 'aaaaaaaa-0000-4000-8000-000000000002';

const SUPABASE = 'https://example.supabase.co'; // the e2e webServer env (playwright.config.ts)
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

export interface Change {
  table: string;
  groupId: string;
  seq: number;
  row: Record<string, unknown>;
  deleted?: boolean;
}
export interface SentMutation {
  clientMutationId: string;
  kind: string;
  groupId: string;
  payload: Record<string, any>;
}

let seq = 0;
/** One mirror change for the fixture group; seq only has to grow. */
export function change(table: string, row: Record<string, unknown>, groupId = GROUP): Change {
  seq += 1;
  return { table, groupId, seq, row: { group_id: groupId, ...row } };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Seeds a Supabase session for `profileId` that never needs the network. */
export async function signInAs(page: Page, profileId: string, email = 'qa@example.test') {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 6;
  const user = {
    id: profileId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    is_anonymous: false,
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const session = {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: profileId, exp, role: 'authenticated' })}.sig`,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600 * 6,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    ['sb-example-auth-token', JSON.stringify(session)],
  );
}

export interface Backend {
  /** Every mutation the page sent to `sync`, in order. */
  mutations: SentMutation[];
  /** Replace what the next full pull returns (and what a later pull sees). */
  push(changes: Change[]): void;
}

export interface BackendOptions {
  /** Rows the first pull returns. */
  changes: Change[];
  /** Answer for `rest/v1/rpc/<name>`; unlisted rpcs answer `null`. */
  rpc?: Record<string, unknown | ((args: any) => unknown)>;
  /** Rows for `rest/v1/<table>` reads (api-client reads that skip the mirror); unlisted tables are empty. */
  rest?: Record<string, unknown[]>;
  /** Called per mutation; the changes it returns arrive in that same answer. */
  onMutation?: (m: SentMutation) => Change[] | void;
}

/** Intercepts auth, `functions/v1/sync` and `rest/v1`; returns what the page sent. */
export async function mockBackend(page: Page, options: BackendOptions): Promise<Backend> {
  const backend: Backend = { mutations: [], push: () => {} };
  let pending: Change[] = [...options.changes];
  backend.push = (changes) => pending.push(...changes);

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.startsWith('/auth/v1')) return json(route, {});
    if (url.pathname === '/functions/v1/sync') {
      const body = req.postDataJSON() as { mutations?: SentMutation[] };
      const mutations = body.mutations ?? [];
      const extra: Change[] = [];
      for (const m of mutations) {
        backend.mutations.push(m);
        extra.push(...(options.onMutation?.(m) ?? []));
      }
      const changes = [...pending, ...extra];
      pending = [];
      const cursors: Record<string, number> = {};
      for (const c of changes) cursors[c.groupId] = Math.max(cursors[c.groupId] ?? 0, c.seq);
      return json(route, {
        outcomes: mutations.map((m) => ({
          clientMutationId: m.clientMutationId,
          status: 'applied',
        })),
        changes,
        cursors,
        serverTime: new Date().toISOString(),
      });
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop() ?? '';
      const handler = options.rpc?.[name];
      const args = req.method() === 'POST' ? req.postDataJSON() : {};
      return json(route, typeof handler === 'function' ? handler(args) : (handler ?? null));
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      // `.single()` asks for one object; everything else for a list.
      const one = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      const rows = options.rest?.[url.pathname.split('/').pop() ?? ''] ?? [];
      return one
        ? json(route, rows[0] ?? { message: 'none' }, rows[0] ? 200 : 406)
        : json(route, rows);
    }
    return json(route, {});
  });
  return backend;
}

// ── fixture rows ────────────────────────────────────────────────────────────

export function companyGroup(over: Record<string, unknown> = {}): Change {
  return change('groups', {
    id: GROUP,
    name: 'QA Works',
    type: 'company',
    default_currency: 'INR',
    country_code: 'IN',
    created_by: OWNER_PROFILE,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
    archived_at: null,
    suspended_at: null,
    slot_lapsed_at: null,
    photo_path: null,
    company_approvals_enabled: true,
    ...over,
  });
}

export function member(
  id: string,
  profileId: string,
  name: string,
  role: 'admin' | 'manager' | 'member' = 'member',
  over: Record<string, unknown> = {},
): Change {
  return change('group_members', {
    id,
    profile_id: profileId,
    ghost_name: null,
    left_at: null,
    invite_email: null,
    invite_phone: null,
    role,
    profile: { display_name: name, avatar_url: null },
    ...over,
  });
}

let entryNo = 0;
export function entry(over: Record<string, unknown> = {}): Change {
  entryNo += 1;
  return change('company_entries', {
    id: `eeeeeeee-0000-4000-8000-0000000000${String(entryNo).padStart(2, '0')}`,
    member_id: EMP_MEMBER,
    entry_kind: 'expense',
    category: 'fuel',
    amount: '45000',
    currency: 'INR',
    occurred_on: '2026-11-01',
    status: 'submitted',
    version: 1,
    created_by: EMP_MEMBER,
    created_at: '2026-11-01T09:00:00Z',
    deleted_at: null,
    ...over,
  });
}

/** An owner's company with one employee and one claim awaiting approval. */
export function ownerMirror(): Change[] {
  return [
    companyGroup(),
    member(OWNER_MEMBER, OWNER_PROFILE, 'Olivia Owner', 'admin'),
    member(EMP_MEMBER, EMP_PROFILE, 'Ravi Employee'),
    entry({ note: 'diesel' }),
  ];
}

/** The same company as the employee sees it: their own member row and entries only. */
export function employeeMirror(): Change[] {
  return [
    companyGroup(),
    member(EMP_MEMBER, EMP_PROFILE, 'Ravi Employee'),
    entry({ note: 'diesel' }),
  ];
}

export const people = [
  {
    member_id: OWNER_MEMBER,
    display_name: 'Olivia Owner',
    role: 'admin',
    manager_id: null,
    detail: true,
  },
  {
    member_id: EMP_MEMBER,
    display_name: 'Ravi Employee',
    role: 'member',
    manager_id: null,
    detail: true,
  },
];
