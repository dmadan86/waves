/**
 * Coverage for r2-sign, the only door between the app and Cloudflare R2 (A44).
 *
 * The handler is a pure function over injected boundaries (two Supabase clients,
 * an R2 client, an object-URL builder), so these tests drive it with hand-rolled
 * mocks and assert on status codes and the calls it makes to R2 — no Deno, no
 * network, no bucket. The cases that matter most and had no coverage before:
 *
 *   • input validation — bad bucket / path / content-type / oversize → a
 *     deterministic 4xx, never a 500;
 *   • the reservation lifecycle — a `put` reserves space, and a failed `commit`
 *     releases that reservation and deletes the orphaned object;
 *   • the cap and paid-gate error mapping (402 / 413 / 415 / 429).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleR2Sign,
  locate,
  readBucket,
  readPath,
  receiptExpenseId,
  type R2SignDeps,
} from './handler.ts';

/** A `.from(table)` query builder: every filter returns itself; the terminals resolve. */
function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'gt', 'lt', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  return builder;
}

type RpcResult = { data?: unknown; error?: { message: string } | null };

interface ClientOptions {
  user?: { id: string } | null;
  rpc?: Record<string, RpcResult>;
  from?: Record<string, { data: unknown; error: unknown }>;
  storage?: {
    createSignedUrl?: { data: { signedUrl: string } | null; error: unknown };
  };
}

/** A Supabase client mock covering the `auth` / `rpc` / `from` / `storage` surface. */
function client(options: ClientOptions = {}) {
  const rpc = vi.fn((name: string) => {
    const result = options.rpc?.[name] ?? { data: null, error: null };
    return Promise.resolve(result);
  });
  const remove = vi.fn(() => {
    const p = Promise.resolve({ data: null, error: null });
    return Object.assign(p, { catch: (fn: () => void) => (fn(), p) });
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: 'user-1' } : options.user },
        error: null,
      }),
    },
    rpc,
    from: vi.fn((table: string) => chain(options.from?.[table] ?? { data: null, error: null })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn().mockResolvedValue(
          options.storage?.createSignedUrl ?? {
            data: { signedUrl: 'https://old/x' },
            error: null,
          },
        ),
        remove,
      })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function headResponse(ok: boolean, contentLength = '0') {
  return new Response(null, {
    status: ok ? 200 : 404,
    headers: { 'content-length': contentLength },
  });
}

interface DepsOptions {
  caller?: ReturnType<typeof client>;
  service?: ReturnType<typeof client>;
  sign?: ReturnType<typeof vi.fn>;
  r2fetch?: ReturnType<typeof vi.fn>;
}

/** The injected boundaries, with spies the tests can assert on. */
function makeDeps(options: DepsOptions = {}) {
  const caller = options.caller ?? client();
  const service = options.service ?? client();
  const sign = options.sign ?? vi.fn().mockResolvedValue({ url: 'https://r2.example/signed' });
  const r2fetch = options.r2fetch ?? vi.fn().mockResolvedValue(headResponse(true, '1024'));
  const r2Client = { sign, fetch: r2fetch };
  const deps: R2SignDeps = {
    asCaller: () => caller,
    asService: () => service,
    r2: () => ({ client: r2Client }),
    objectUrl: (bucket, path) => `https://r2.example/bucket/${bucket}/${path}`,
  };
  return { deps, caller, service, sign, r2fetch };
}

function post(body: unknown, init: RequestInit = {}) {
  return new Request('https://fn.example/r2-sign', {
    method: 'POST',
    headers: { Authorization: 'Bearer jwt' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

/** A caller who is a live member of `group-1` and passes the paid gate. */
function memberCaller() {
  return client({
    user: { id: 'user-1' },
    rpc: {
      waves_my_member_id: { data: 'member-1' },
      waves_can_upload_group_photo: { data: true },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pure input validation', () => {
  it('readBucket accepts a known logical bucket and rejects an unknown one', () => {
    expect(readBucket('receipts')).toBe('receipts');
    expect(() => readBucket('secrets')).toThrowError(/Unknown storage bucket/);
    expect(() => readBucket(42)).toThrowError(/Unknown storage bucket/);
  });

  it.each([
    ['', 'empty'],
    ['a'.repeat(513), 'too long'],
    ['/leading', 'leading slash → empty first segment'],
    ['a//b', 'empty middle segment'],
    ['a/../b', 'parent traversal'],
    ['a/./b', 'current-dir segment'],
    [42, 'not a string'],
  ])('readPath rejects %j (%s)', (value) => {
    expect(() => readPath(value)).toThrowError(/path/i);
  });

  it('readPath accepts an ordinary key', () => {
    expect(readPath('group-1/receipt.webp')).toBe('group-1/receipt.webp');
  });

  it('locate reads the group/owner out of a personal vs group receipt path', () => {
    expect(locate('receipts', 'group-1/x')).toEqual({ groupId: 'group-1', ownerSegment: null });
    expect(locate('receipts', 'personal/user-1/x')).toEqual({
      groupId: null,
      ownerSegment: 'user-1',
    });
    expect(locate('avatars', 'user-1/a.webp')).toEqual({ groupId: null, ownerSegment: 'user-1' });
  });
});

describe('request-level guards', () => {
  it('405s a non-POST request', async () => {
    const { deps } = makeDeps();
    const response = await handleR2Sign(
      new Request('https://fn.example/r2-sign', { method: 'GET' }),
      deps,
    );
    expect(response.status).toBe(405);
  });

  it('401s when the caller resolves to no user', async () => {
    const { deps } = makeDeps({ caller: client({ user: null }) });
    const response = await handleR2Sign(post({ action: 'put', bucket: 'receipts' }), deps);
    expect(response.status).toBe(401);
  });

  it('turns a malformed JSON body into a 400, not a 500', async () => {
    const { deps } = makeDeps();
    const response = await handleR2Sign(post('{not json'), deps);
    // Empty body → no bucket → BAD_BUCKET 400. The point is a deterministic 4xx.
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_BUCKET');
  });

  it('rejects an unknown bucket with 400 BAD_BUCKET', async () => {
    const { deps } = makeDeps();
    const response = await handleR2Sign(post({ action: 'put', bucket: 'nope', path: 'x' }), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_BUCKET');
  });

  it('rejects a traversal path with 400 BAD_PATH', async () => {
    const { deps } = makeDeps();
    const response = await handleR2Sign(
      post({ action: 'put', bucket: 'receipts', path: 'group-1/../secret' }),
      deps,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_PATH');
  });

  it('rejects an unknown action with 400 BAD_ACTION', async () => {
    const { deps } = makeDeps({ caller: memberCaller() });
    const response = await handleR2Sign(
      post({ action: 'frobnicate', bucket: 'receipts', path: 'group-1/x' }),
      deps,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_ACTION');
  });
});

describe('put — reserve a presigned upload', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    action: 'put',
    bucket: 'receipts',
    path: 'group-1/r.webp',
    contentType: 'image/webp',
    contentLength: 1024,
    ...extra,
  });

  it('reserves space and returns a signed PUT URL on the happy path', async () => {
    const service = client({ rpc: { waves_storage_reserve: { data: null, error: null } } });
    const { deps, sign } = makeDeps({ caller: memberCaller(), service });
    const response = await handleR2Sign(post(body()), deps);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/webp' } });
    expect(json.url).toContain('https://r2.example/signed');
    expect(service.rpc).toHaveBeenCalledWith(
      'waves_storage_reserve',
      expect.objectContaining({ p_bytes: 1024, p_path: 'group-1/r.webp' }),
    );
    expect(sign).toHaveBeenCalledOnce();
  });

  it('rejects a missing / non-positive contentLength with 400 BAD_LENGTH', async () => {
    const { deps } = makeDeps({ caller: memberCaller() });
    const response = await handleR2Sign(post(body({ contentLength: 0 })), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_LENGTH');
  });

  it('rejects an oversize declared length with 413 TOO_LARGE', async () => {
    const { deps } = makeDeps({ caller: memberCaller() });
    const response = await handleR2Sign(post(body({ contentLength: 13 * 1024 * 1024 })), deps);
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('TOO_LARGE');
  });

  it('rejects a disallowed content-type with 415 BAD_CONTENT_TYPE', async () => {
    const { deps } = makeDeps({ caller: memberCaller() });
    const response = await handleR2Sign(post(body({ contentType: 'image/svg+xml' })), deps);
    expect(response.status).toBe(415);
    expect((await response.json()).code).toBe('BAD_CONTENT_TYPE');
  });

  it('maps a STORAGE_CAP reservation failure to 402', async () => {
    const service = client({
      rpc: { waves_storage_reserve: { data: null, error: { message: 'STORAGE_CAP exceeded' } } },
    });
    const { deps } = makeDeps({ caller: memberCaller(), service });
    const response = await handleR2Sign(post(body()), deps);
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe('STORAGE_CAP');
  });

  it('maps a STORAGE_TOO_MANY_PENDING reservation failure to 429', async () => {
    const service = client({
      rpc: {
        waves_storage_reserve: { data: null, error: { message: 'STORAGE_TOO_MANY_PENDING' } },
      },
    });
    const { deps } = makeDeps({ caller: memberCaller(), service });
    const response = await handleR2Sign(post(body()), deps);
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('TOO_MANY_PENDING');
  });

  it('does not sign anything when reservation fails', async () => {
    const service = client({
      rpc: { waves_storage_reserve: { data: null, error: { message: 'STORAGE_CAP' } } },
    });
    const { deps, sign } = makeDeps({ caller: memberCaller(), service });
    await handleR2Sign(post(body()), deps);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('commit — record a landed upload', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    action: 'commit',
    bucket: 'receipts',
    path: 'group-1/r.webp',
    contentType: 'image/webp',
    ...extra,
  });

  it('records the true HEAD size on the happy path', async () => {
    const service = client({ rpc: { waves_storage_record: { data: null, error: null } } });
    const r2fetch = vi.fn().mockResolvedValue(headResponse(true, '2048'));
    const { deps } = makeDeps({ caller: memberCaller(), service, r2fetch });
    const response = await handleR2Sign(post(body()), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, bytes: 2048 });
    expect(service.rpc).toHaveBeenCalledWith(
      'waves_storage_record',
      expect.objectContaining({ p_bytes: 2048 }),
    );
  });

  it('404s when the object was never uploaded (HEAD not ok)', async () => {
    const r2fetch = vi.fn().mockResolvedValue(headResponse(false));
    const { deps } = makeDeps({ caller: memberCaller(), r2fetch });
    const response = await handleR2Sign(post(body()), deps);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('NOT_UPLOADED');
  });

  it('deletes an over-size object and refuses with 413', async () => {
    const r2fetch = vi.fn().mockResolvedValue(headResponse(true, String(13 * 1024 * 1024)));
    const { deps } = makeDeps({ caller: memberCaller(), r2fetch });
    const response = await handleR2Sign(post(body()), deps);
    expect(response.status).toBe(413);
    // HEAD then DELETE of the oversize object.
    expect(r2fetch).toHaveBeenCalledTimes(2);
    expect(r2fetch.mock.calls[1][1]).toEqual({ method: 'DELETE' });
  });

  it('releases the reservation and deletes the object when record fails (cap boundary)', async () => {
    const service = client({
      rpc: {
        waves_storage_record: { data: null, error: { message: 'STORAGE_CAP breached at commit' } },
        // The release removed a live pending row → the orphan must be deleted.
        waves_storage_release_reservation: { data: true, error: null },
      },
    });
    const r2fetch = vi.fn().mockResolvedValue(headResponse(true, '2048'));
    const { deps } = makeDeps({ caller: memberCaller(), service, r2fetch });
    const response = await handleR2Sign(post(body()), deps);

    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe('STORAGE_CAP');
    expect(service.rpc).toHaveBeenCalledWith(
      'waves_storage_release_reservation',
      expect.objectContaining({ p_path: 'group-1/r.webp' }),
    );
    // First fetch is the HEAD; the second is the DELETE of the orphaned object.
    expect(r2fetch).toHaveBeenCalledTimes(2);
    expect(r2fetch.mock.calls[1][1]).toEqual({ method: 'DELETE' });
  });

  it('leaves a committed replacement intact when the release removed no pending row', async () => {
    const service = client({
      rpc: {
        waves_storage_record: { data: null, error: { message: 'STORAGE_CAP' } },
        // No pending row was removed → this was a replacement; keep the good copy.
        waves_storage_release_reservation: { data: false, error: null },
      },
    });
    const r2fetch = vi.fn().mockResolvedValue(headResponse(true, '2048'));
    const { deps } = makeDeps({ caller: memberCaller(), service, r2fetch });
    await handleR2Sign(post(body()), deps);
    // Only the HEAD — no DELETE, because nothing was reserved by this call.
    expect(r2fetch).toHaveBeenCalledTimes(1);
  });
});

describe('release — undo a failed upload', () => {
  it('deletes the R2 object only when a pending reservation was actually removed', async () => {
    const service = client({
      rpc: { waves_storage_release_reservation: { data: true, error: null } },
      // The caller's own reservation: release is the uploader's to make.
      from: { storage_objects: { data: { owner_profile_id: 'user-1' }, error: null } },
    });
    const r2fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const { deps } = makeDeps({ caller: memberCaller(), service, r2fetch });
    const response = await handleR2Sign(
      post({ action: 'release', bucket: 'receipts', path: 'group-1/r.webp' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(r2fetch).toHaveBeenCalledWith(expect.any(String), { method: 'DELETE' });
  });

  it('does not touch R2 when there was no pending reservation to remove', async () => {
    const service = client({
      rpc: { waves_storage_release_reservation: { data: false, error: null } },
      // A committed image of the caller's own, which release must leave alone.
      from: { storage_objects: { data: { owner_profile_id: 'user-1' }, error: null } },
    });
    const r2fetch = vi.fn();
    const { deps } = makeDeps({ caller: memberCaller(), service, r2fetch });
    const response = await handleR2Sign(
      post({ action: 'release', bucket: 'receipts', path: 'group-1/r.webp' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(r2fetch).not.toHaveBeenCalled();
  });
});

describe('authorisation', () => {
  it('403s an outsider trying to write a group receipt (no member row)', async () => {
    const outsider = client({
      user: { id: 'user-1' },
      rpc: { waves_my_member_id: { data: null } },
    });
    const { deps } = makeDeps({ caller: outsider });
    const response = await handleR2Sign(
      post({ action: 'put', bucket: 'receipts', path: 'group-1/r.webp', contentLength: 10 }),
      deps,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NOT_A_MEMBER');
  });

  it('403s writing a personal object under someone else’s owner segment', async () => {
    const caller = client({ user: { id: 'user-1' }, rpc: {} });
    const { deps } = makeDeps({ caller });
    const response = await handleR2Sign(
      post({ action: 'put', bucket: 'captures', path: 'user-999/x', contentLength: 10 }),
      deps,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NOT_OWNER');
  });

  it('403s a group-photo write that fails the paid gate (PHOTO_LOCKED)', async () => {
    const caller = client({
      user: { id: 'user-1' },
      rpc: {
        waves_my_member_id: { data: 'member-1' },
        waves_can_upload_group_photo: { data: false },
      },
    });
    const { deps } = makeDeps({ caller });
    const response = await handleR2Sign(
      post({ action: 'put', bucket: 'group-photos', path: 'group-1/p.webp', contentLength: 10 }),
      deps,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('PHOTO_LOCKED');
  });

  it('400s a restricted write whose key is not scoped to its subject', async () => {
    const { deps } = makeDeps({ caller: memberCaller() });
    const response = await handleR2Sign(
      post({
        action: 'put',
        bucket: 'expense-attachments',
        subjectId: 'exp-1',
        path: 'exp-2/att.webp',
        contentLength: 10,
      }),
      deps,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_PATH');
  });

  it('403s a restricted read when a visible row is not enough to prove party status', async () => {
    const caller = client({
      user: { id: 'user-1' },
      rpc: {
        waves_my_member_id: { data: 'member-1' },
        waves_is_expense_party: { data: false },
      },
      from: { expense_attachments: { data: { id: 'att-1' }, error: null } },
    });
    const service = client({ from: { expenses: { data: { group_id: 'group-1' }, error: null } } });
    const { deps, sign } = makeDeps({ caller, service });

    const response = await handleR2Sign(
      post({
        action: 'get',
        bucket: 'expense-attachments',
        subjectId: 'exp-1',
        path: 'exp-1/att.webp',
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NOT_A_PARTY');
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    ['expense-attachments', 'expenses', 'waves_is_expense_party', 'exp-1', 'exp-1/att.webp'],
    [
      'settlement-proofs',
      'settlements',
      'waves_is_settlement_party',
      'settle-1',
      'settle-1/proof.webp',
    ],
  ])(
    'signs a short-lived restricted read for a party to %s',
    async (bucket, table, partyRpc, subjectId, path) => {
      const caller = client({
        user: { id: 'user-1' },
        rpc: {
          waves_my_member_id: { data: 'member-1' },
          [partyRpc]: { data: true },
        },
        from: {
          [bucket === 'expense-attachments' ? 'expense_attachments' : 'settlement_proofs']: {
            data: { id: 'row-1' },
            error: null,
          },
        },
      });
      const service = client({ from: { [table]: { data: { group_id: 'group-1' }, error: null } } });
      const { deps, sign } = makeDeps({ caller, service });

      const response = await handleR2Sign(post({ action: 'get', bucket, subjectId, path }), deps);

      expect(response.status).toBe(200);
      expect(sign).toHaveBeenCalledOnce();
      const signedRequest = sign.mock.calls[0][0] as Request;
      expect(new URL(signedRequest.url).searchParams.get('X-Amz-Expires')).toBe('60');
    },
  );
});

describe('group objects — only the uploader or an admin may replace or remove', () => {
  /** A member of group-1, optionally an admin of it. */
  function member(id: string, admin = false) {
    return client({
      user: { id },
      rpc: {
        waves_my_member_id: { data: `member-${id}` },
        is_group_admin: { data: admin },
      },
    });
  }

  /**
   * The service view: `owner` is the storage ledger's recorded uploader of the
   * path (null = no row), and `expenseCreator` the member who created the
   * expense a receipt path names (null = no such expense in the group).
   */
  function ledger(owner: string | null, expenseCreator: string | null = null) {
    return client({
      rpc: {
        waves_storage_reserve: { data: null, error: null },
        waves_storage_record: { data: null, error: null },
        waves_storage_release: { data: null, error: null },
        waves_storage_release_reservation: { data: true, error: null },
      },
      from: {
        storage_objects: {
          data: owner === null ? null : { owner_profile_id: owner },
          error: null,
        },
        expenses: {
          data: expenseCreator === null ? null : { created_by: expenseCreator },
          error: null,
        },
      },
    });
  }

  const request = (action: string, bucket = 'receipts', path = 'group-1/exp-1.jpg') =>
    post({
      action,
      bucket,
      path,
      contentType: 'image/jpeg',
      contentLength: 1024,
    });

  /** A kept bill's path: `<groupId>/<expenseId>.jpg`, as `expenseReceiptPath` builds it. */
  const EXPENSE_ID = '6f1c2b1e-9a4d-4c3b-8e2f-0a1b2c3d4e5f';
  const BILL = `group-1/${EXPENSE_ID}.jpg`;

  it.each(['put', 'commit', 'delete', 'release'])(
    'lets the original uploader %s their own receipt',
    async (action) => {
      const { deps } = makeDeps({ caller: member('user-1'), service: ledger('user-1') });
      const response = await handleR2Sign(request(action), deps);
      expect(response.status).toBe(200);
    },
  );

  it.each(['put', 'commit', 'delete', 'release'])(
    'refuses another member who tries to %s it, touching nothing',
    async (action) => {
      const { deps, service, sign, r2fetch } = makeDeps({
        caller: member('user-2'),
        service: ledger('user-1'),
      });
      const response = await handleR2Sign(request(action), deps);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe('NOT_UPLOADER');
      expect(sign).not.toHaveBeenCalled();
      expect(r2fetch).not.toHaveBeenCalled();
      expect(service.rpc).not.toHaveBeenCalled();
    },
  );

  it('refuses another member overwriting an album photo too', async () => {
    const { deps } = makeDeps({ caller: member('user-2'), service: ledger('user-1') });
    const response = await handleR2Sign(request('put', 'trip-photos'), deps);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NOT_UPLOADER');
  });

  it.each(['put', 'delete'])('lets a group admin %s a member’s receipt', async (action) => {
    const { deps, caller } = makeDeps({
      caller: member('admin-1', true),
      service: ledger('user-1'),
    });
    const response = await handleR2Sign(request(action), deps);
    expect(response.status).toBe(200);
    expect(caller.rpc).toHaveBeenCalledWith('is_group_admin', { p_group_id: 'group-1' });
  });

  it('lets any member upload to a path the ledger has no owner for', async () => {
    const { deps, caller, service } = makeDeps({
      caller: member('user-2'),
      service: ledger(null),
    });
    const response = await handleR2Sign(request('put'), deps);
    expect(response.status).toBe(200);
    expect(service.rpc).toHaveBeenCalledWith(
      'waves_storage_reserve',
      expect.objectContaining({ p_profile_id: 'user-2', p_path: 'group-1/exp-1.jpg' }),
    );
    // No owner to protect, so no admin lookup either.
    expect(caller.rpc).not.toHaveBeenCalledWith('is_group_admin', expect.anything());
  });

  it('leaves the shared group cover member-editable', async () => {
    const caller = client({
      user: { id: 'user-2' },
      rpc: {
        waves_my_member_id: { data: 'member-2' },
        waves_can_upload_group_photo: { data: true },
        is_group_admin: { data: false },
      },
    });
    const { deps } = makeDeps({ caller, service: ledger('user-1') });
    const response = await handleR2Sign(request('put', 'group-photos'), deps);
    expect(response.status).toBe(200);
  });

  it('keeps personal files owner-only, with no ledger lookup', async () => {
    const { deps, service } = makeDeps({
      caller: client({ user: { id: 'user-1' } }),
      service: ledger('someone-else'),
    });
    const response = await handleR2Sign(
      post({ action: 'delete', bucket: 'captures', path: 'user-1/c.webp' }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(service.from).not.toHaveBeenCalledWith('storage_objects');
  });

  describe('a bill nobody has kept yet', () => {
    it('refuses a member planting the first bill on somebody else’s expense', async () => {
      const { deps, sign, service } = makeDeps({
        caller: member('user-2'),
        service: ledger(null, 'member-user-1'),
      });
      const response = await handleR2Sign(request('put', 'receipts', BILL), deps);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe('NOT_UPLOADER');
      expect(sign).not.toHaveBeenCalled();
      expect(service.rpc).not.toHaveBeenCalled();
    });

    it('lets the expense’s creator keep its first bill', async () => {
      const { deps, service } = makeDeps({
        caller: member('user-1'),
        service: ledger(null, 'member-user-1'),
      });
      const response = await handleR2Sign(request('put', 'receipts', BILL), deps);
      expect(response.status).toBe(200);
      expect(service.from).toHaveBeenCalledWith('expenses');
      expect(service.rpc).toHaveBeenCalledWith(
        'waves_storage_reserve',
        expect.objectContaining({ p_profile_id: 'user-1', p_path: BILL }),
      );
    });

    it('lets a group admin keep a bill on anybody’s expense', async () => {
      const { deps } = makeDeps({
        caller: member('admin-1', true),
        service: ledger(null, 'member-user-1'),
      });
      const response = await handleR2Sign(request('put', 'receipts', BILL), deps);
      expect(response.status).toBe(200);
    });

    it('lets any member upload a scan under a fresh id no expense carries', async () => {
      const { deps } = makeDeps({
        caller: member('user-2'),
        service: ledger(null, null),
      });
      const response = await handleR2Sign(
        request('put', 'receipts', 'group-1/0b7d6f5e-1c2a-4b3c-9d8e-7f6a5b4c3d2e.webp'),
        deps,
      );
      expect(response.status).toBe(200);
    });
  });

  describe('a legacy object the ledger never recorded', () => {
    it.each([
      ['on somebody else’s expense', BILL, 'member-user-1'],
      ['under no expense', 'group-1/legacy.webp', null],
    ])('refuses a member deleting it (%s)', async (_label, path, creator) => {
      const { deps, service, r2fetch } = makeDeps({
        caller: member('user-2'),
        service: ledger(null, creator),
      });
      const response = await handleR2Sign(request('delete', 'receipts', path), deps);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe('NOT_UPLOADER');
      expect(r2fetch).not.toHaveBeenCalled();
      expect(service.storage.from).not.toHaveBeenCalled();
      expect(service.rpc).not.toHaveBeenCalled();
    });

    it('refuses a member releasing it', async () => {
      const { deps, service } = makeDeps({
        caller: member('user-2'),
        service: ledger(null, null),
      });
      const response = await handleR2Sign(
        request('release', 'trip-photos', 'group-1/photo.webp'),
        deps,
      );
      expect(response.status).toBe(403);
      expect(service.rpc).not.toHaveBeenCalled();
    });

    it('lets a group admin delete it', async () => {
      const { deps, service } = makeDeps({
        caller: member('admin-1', true),
        service: ledger(null, null),
      });
      const response = await handleR2Sign(
        request('delete', 'receipts', 'group-1/legacy.webp'),
        deps,
      );
      expect(response.status).toBe(200);
      expect(service.storage.from).toHaveBeenCalledWith('receipts');
    });
  });
});

describe('receiptExpenseId', () => {
  it('reads the expense id out of a kept bill’s path', () => {
    expect(receiptExpenseId('group-1/6f1c2b1e-9a4d-4c3b-8e2f-0a1b2c3d4e5f.jpg')).toBe(
      '6f1c2b1e-9a4d-4c3b-8e2f-0a1b2c3d4e5f',
    );
  });

  it.each(['group-1/r.webp', 'group-1/a/6f1c2b1e-9a4d-4c3b-8e2f-0a1b2c3d4e5f.jpg', 'x'])(
    'names no expense for %j',
    (path) => {
      expect(receiptExpenseId(path)).toBeNull();
    },
  );
});
