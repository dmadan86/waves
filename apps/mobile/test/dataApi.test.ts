/**
 * The network edge of the data layer: what `data/api.ts` asks the server for,
 * and what it hands back to a screen.
 *
 * Nearly every function here is a thin wrapper, which is exactly why they are
 * worth pinning: a renamed RPC parameter, a dropped `.is('deleted_at', null)` or
 * a bigint sent as a JSON number fails silently in production and only shows up
 * as a wrong number on somebody's phone. Each test states the request the
 * wrapper must make and the shape it must return, and that a refusal from the
 * server surfaces as a thrown Error rather than as empty data.
 *
 * The backend is a recording fake: every `from()` chain is logged as a list of
 * `[method, args]` and resolves to `h.result`; `rpc`, `functions.invoke` and the
 * two auth calls are plain mocks. `writeExpense` and `fetchSettledTotals` are
 * covered in apiSettledAndWrite.test.ts and not repeated here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = [string, unknown[]];
type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  chains: [] as { table: string; ops: [string, unknown[]][] }[],
  result: { data: null, error: null } as {
    data: unknown;
    error: { message: string } | null;
  },
  rpc: vi.fn(),
  invoke: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  putImage: vi.fn(),
  removeImage: vi.fn(),
  imageUrl: vi.fn(),
  sendPhoneCode: vi.fn(),
  attachPhoneCode: vi.fn(),
  uuid: 0,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++h.uuid}` }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@/lib/phoneAuth', () => ({
  attachPhoneCode: h.attachPhoneCode,
  sendPhoneCode: h.sendPhoneCode,
}));
vi.mock('@/lib/storage', () => ({
  imageUrl: h.imageUrl,
  putImage: h.putImage,
  removeImage: h.removeImage,
}));
vi.mock('@/lib/backend', () => {
  /** A PostgREST builder: every call is recorded, and awaiting it yields `h.result`. */
  const from = (table: string) => {
    const record = { table, ops: [] as [string, unknown[]][] };
    h.chains.push(record);
    const builder: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(h.result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            record.ops.push([String(prop), args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return {
    backendConfigured: true,
    backend: {
      from,
      rpc: h.rpc,
      functions: { invoke: h.invoke },
      auth: { updateUser: h.updateUser, verifyOtp: h.verifyOtp },
    },
  };
});

const api = await import('@/data/api');
const { STRINGS_BY_LANGUAGE } = await import('@/i18n');
const en = STRINGS_BY_LANGUAGE.en;

/** The single `from()` chain the call under test made. */
function onlyChain(): { table: string; ops: Op[] } {
  expect(h.chains).toHaveLength(1);
  return h.chains[0]!;
}

/** Names of the builder methods called, in order. */
const opNames = (ops: Op[]) => ops.map(([name]) => name);
const op = (ops: Op[], name: string) => ops.find(([n]) => n === name)?.[1];

const ok = (data: unknown): Result => ({ data, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });

beforeEach(() => {
  h.chains = [];
  h.result = ok(null);
  h.uuid = 0;
  for (const fn of [
    h.rpc,
    h.invoke,
    h.updateUser,
    h.verifyOtp,
    h.putImage,
    h.removeImage,
    h.imageUrl,
    h.sendPhoneCode,
    h.attachPhoneCode,
  ]) {
    fn.mockReset();
  }
  h.rpc.mockResolvedValue(ok(null));
  h.invoke.mockResolvedValue(ok(null));
  h.updateUser.mockResolvedValue({ error: null });
  h.verifyOtp.mockResolvedValue({ error: null });
});

// ───────────────────────────────────────────────────────────── reads ──

describe('fetchGroups', () => {
  it('reads live, unarchived groups newest first', async () => {
    h.result = ok([{ id: 'g1' }]);

    const groups = await api.fetchGroups();

    expect(groups).toEqual([{ id: 'g1' }]);
    const { table, ops } = onlyChain();
    expect(table).toBe('groups');
    expect(ops.filter(([n]) => n === 'is').map(([, a]) => a)).toEqual([
      ['archived_at', null],
      ['deleted_at', null],
    ]);
    expect(op(ops, 'order')).toEqual(['created_at', { ascending: false }]);
  });

  it('throws the server message on an error', async () => {
    h.result = fail('permission denied');
    await expect(api.fetchGroups()).rejects.toThrow('permission denied');
  });

  it('throws rather than returning null when no rows object came back', async () => {
    h.result = ok(null);
    await expect(api.fetchGroups()).rejects.toThrow('No data returned');
  });
});

describe('fetchMembers', () => {
  it('reads current members of one group, oldest first', async () => {
    h.result = ok([{ id: 'm1' }, { id: 'm2' }]);

    expect(await api.fetchMembers('g1')).toEqual([{ id: 'm1' }, { id: 'm2' }]);

    const { table, ops } = onlyChain();
    expect(table).toBe('group_members');
    expect(op(ops, 'eq')).toEqual(['group_id', 'g1']);
    expect(op(ops, 'is')).toEqual(['left_at', null]);
    expect(op(ops, 'order')).toEqual(['created_at', { ascending: true }]);
  });
});

describe('fetchBalances', () => {
  it('reads the server’s trigger-maintained balances for one group', async () => {
    h.result = ok([{ group_id: 'g1', member_id: 'm1', currency: 'INR', balance: '100' }]);

    const rows = await api.fetchBalances('g1');

    expect(rows).toHaveLength(1);
    const { table, ops } = onlyChain();
    expect(table).toBe('group_balances');
    expect(op(ops, 'select')).toEqual(['group_id, member_id, currency, balance']);
    expect(op(ops, 'eq')).toEqual(['group_id', 'g1']);
  });
});

describe('fetchExpenseVersions', () => {
  it('reads every version of one expense, newest first, with payers and shares', async () => {
    h.result = ok([{ id: 'v2', version_no: 2 }]);

    expect(await api.fetchExpenseVersions('e1')).toEqual([{ id: 'v2', version_no: 2 }]);

    const { table, ops } = onlyChain();
    expect(table).toBe('expense_versions');
    const select = String(op(ops, 'select')?.[0]);
    expect(select).toContain('payers:expense_payers ( member_id, amount )');
    expect(select).toContain('shares:expense_shares ( member_id, amount )');
    expect(op(ops, 'eq')).toEqual(['expense_id', 'e1']);
    expect(op(ops, 'order')).toEqual(['version_no', { ascending: false }]);
  });
});

describe('fetchNotificationPrefs', () => {
  it('fills keys the stored prefs do not mention from the defaults', async () => {
    const someKey = Object.keys(api.DEFAULT_NOTIFICATION_PREFS)[0]!;
    const flipped = !(api.DEFAULT_NOTIFICATION_PREFS as unknown as Record<string, unknown>)[
      someKey
    ];
    h.result = ok({ notification_prefs: { [someKey]: flipped } });

    const prefs = await api.fetchNotificationPrefs('p1');

    expect(prefs).toEqual({ ...api.DEFAULT_NOTIFICATION_PREFS, [someKey]: flipped });
    const { table, ops } = onlyChain();
    expect(table).toBe('profiles');
    expect(op(ops, 'eq')).toEqual(['id', 'p1']);
    expect(opNames(ops)).toContain('single');
  });

  it('is exactly the defaults when the column is empty', async () => {
    h.result = ok({ notification_prefs: null });
    expect(await api.fetchNotificationPrefs('p1')).toEqual(api.DEFAULT_NOTIFICATION_PREFS);
  });

  it('throws on an error', async () => {
    h.result = fail('boom');
    await expect(api.fetchNotificationPrefs('p1')).rejects.toThrow('boom');
  });
});

describe('saveNotificationPrefs', () => {
  it('writes the whole prefs object onto my profile', async () => {
    await api.saveNotificationPrefs('p1', api.DEFAULT_NOTIFICATION_PREFS);

    const { table, ops } = onlyChain();
    expect(table).toBe('profiles');
    expect(op(ops, 'update')).toEqual([{ notification_prefs: api.DEFAULT_NOTIFICATION_PREFS }]);
    expect(op(ops, 'eq')).toEqual(['id', 'p1']);
  });

  it('throws on an error', async () => {
    h.result = fail('nope');
    await expect(api.saveNotificationPrefs('p1', api.DEFAULT_NOTIFICATION_PREFS)).rejects.toThrow(
      'nope',
    );
  });
});

describe('discovery settings', () => {
  it('maps the columns to the settings shape', async () => {
    h.result = ok({
      discoverable_by_phone: false,
      discoverable_by_email: true,
      contact_visibility: 'nobody',
    });

    expect(await api.fetchDiscoverySettings('p1')).toEqual({
      discoverableByPhone: false,
      discoverableByEmail: true,
      contactVisibility: 'nobody',
    });
    expect(op(onlyChain().ops, 'select')).toEqual([
      'discoverable_by_phone, discoverable_by_email, contact_visibility',
    ]);
  });

  it('falls back to the defaults for missing columns', async () => {
    h.result = ok({});
    expect(await api.fetchDiscoverySettings('p1')).toEqual(api.DEFAULT_DISCOVERY);
  });

  it('reads an unknown visibility value as "groups", the only other allowed value', async () => {
    h.result = ok({ contact_visibility: 'everyone' });
    expect((await api.fetchDiscoverySettings('p1')).contactVisibility).toBe('groups');
  });

  it('throws when the read fails', async () => {
    h.result = fail('rls');
    await expect(api.fetchDiscoverySettings('p1')).rejects.toThrow('rls');
  });

  it('saves every field back to its column', async () => {
    await api.saveDiscoverySettings('p1', {
      discoverableByPhone: true,
      discoverableByEmail: false,
      contactVisibility: 'nobody',
    });

    const { table, ops } = onlyChain();
    expect(table).toBe('profiles');
    expect(op(ops, 'update')).toEqual([
      {
        discoverable_by_phone: true,
        discoverable_by_email: false,
        contact_visibility: 'nobody',
      },
    ]);
    expect(op(ops, 'eq')).toEqual(['id', 'p1']);
  });

  it('throws when the save fails', async () => {
    h.result = fail('rls');
    await expect(api.saveDiscoverySettings('p1', api.DEFAULT_DISCOVERY)).rejects.toThrow('rls');
  });
});

describe('fetchReleasePolicy', () => {
  it('reads at most one row for the platform', async () => {
    const row = {
      platform: 'android',
      latest_version: '2.0.0',
      minimum_version: '1.0.0',
      store_url: 'https://play',
      message: null,
    };
    h.result = ok(row);

    expect(await api.fetchReleasePolicy('android')).toEqual(row);
    const { table, ops } = onlyChain();
    expect(table).toBe('app_releases');
    expect(op(ops, 'eq')).toEqual(['platform', 'android']);
    expect(opNames(ops)).toContain('maybeSingle');
  });

  it('is null when there is no policy for the platform', async () => {
    h.result = ok(null);
    expect(await api.fetchReleasePolicy('ios')).toBeNull();
  });

  it('throws on an error', async () => {
    h.result = fail('down');
    await expect(api.fetchReleasePolicy('ios')).rejects.toThrow('down');
  });
});

describe('fetchAppNotices', () => {
  it('reads the newest twenty notices raw, with no time filter', async () => {
    h.result = ok([{ id: 'n1', body: 'x' }]);

    expect(await api.fetchAppNotices()).toEqual([{ id: 'n1', body: 'x' }]);
    const { table, ops } = onlyChain();
    expect(table).toBe('app_notices');
    expect(op(ops, 'order')).toEqual(['visible_from', { ascending: false }]);
    expect(op(ops, 'limit')).toEqual([20]);
    expect(opNames(ops)).not.toContain('gte');
    expect(opNames(ops)).not.toContain('lte');
  });

  it('is empty when the table returns nothing', async () => {
    h.result = ok(null);
    expect(await api.fetchAppNotices()).toEqual([]);
  });

  it('throws on an error', async () => {
    h.result = fail('down');
    await expect(api.fetchAppNotices()).rejects.toThrow('down');
  });
});

describe('fetchReceipt', () => {
  it('reads one scanned bill by id', async () => {
    h.result = ok({ id: 'r1', group_id: 'g1', parsed: null });

    expect(await api.fetchReceipt('r1')).toEqual({ id: 'r1', group_id: 'g1', parsed: null });
    const { table, ops } = onlyChain();
    expect(table).toBe('receipts');
    expect(op(ops, 'eq')).toEqual(['id', 'r1']);
    expect(opNames(ops)).toContain('maybeSingle');
  });

  it('is null for a bill that is not visible', async () => {
    h.result = ok(null);
    expect(await api.fetchReceipt('r1')).toBeNull();
  });

  it('throws on an error', async () => {
    h.result = fail('rls');
    await expect(api.fetchReceipt('r1')).rejects.toThrow('rls');
  });
});

describe('disabledCountries', () => {
  it('lists the codes switched off', async () => {
    h.result = ok([{ code: 'KP' }, { code: 'IR' }]);

    expect(await api.disabledCountries()).toEqual(['KP', 'IR']);
    const { table, ops } = onlyChain();
    expect(table).toBe('country_settings');
    expect(op(ops, 'eq')).toEqual(['enabled', false]);
  });

  it('is empty, never a throw, when the read fails — nobody is locked out', async () => {
    h.result = fail('relation does not exist');
    expect(await api.disabledCountries()).toEqual([]);
  });

  it('is empty when there are no rows', async () => {
    h.result = ok(null);
    expect(await api.disabledCountries()).toEqual([]);
  });
});

// ─────────────────────────────────────────────── table writes ──

describe('plain table updates', () => {
  it('updateGroup patches the group row by id', async () => {
    await api.updateGroup('g1', { name: 'Goa', simplify_debts: false });

    const { table, ops } = onlyChain();
    expect(table).toBe('groups');
    expect(op(ops, 'update')).toEqual([{ name: 'Goa', simplify_debts: false }]);
    expect(op(ops, 'eq')).toEqual(['id', 'g1']);
  });

  it('updateMember patches the member row by id', async () => {
    await api.updateMember('m1', { vpa: 'me@upi' });

    const { table, ops } = onlyChain();
    expect(table).toBe('group_members');
    expect(op(ops, 'update')).toEqual([{ vpa: 'me@upi' }]);
    expect(op(ops, 'eq')).toEqual(['id', 'm1']);
  });

  it('leaveGroup stamps left_at rather than deleting the membership', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    try {
      await api.leaveGroup('m1');
    } finally {
      vi.useRealTimers();
    }

    const { table, ops } = onlyChain();
    expect(table).toBe('group_members');
    expect(opNames(ops)).not.toContain('delete');
    expect(op(ops, 'update')).toEqual([{ left_at: '2026-09-01T10:00:00.000Z' }]);
    expect(op(ops, 'eq')).toEqual(['id', 'm1']);
  });

  it.each([
    ['updateGroup', () => api.updateGroup('g1', { name: 'x' })],
    ['updateMember', () => api.updateMember('m1', { ghost_name: 'x' })],
    ['leaveGroup', () => api.leaveGroup('m1')],
  ])('%s throws the server message on an error', async (_name, call) => {
    h.result = fail('not allowed');
    await expect(call()).rejects.toThrow('not allowed');
  });
});

// ─────────────────────────────────────────────────────── RPCs ──

/**
 * Every RPC wrapper that forwards its arguments and returns the data as-is.
 * `[name, call, rpc, params, data, expected]`.
 */
const rpcCases: [string, () => Promise<unknown>, string, unknown, unknown, unknown][] = [
  [
    'canUploadGroupPhoto',
    () => api.canUploadGroupPhoto(null),
    'waves_can_upload_group_photo',
    { p_group_id: null },
    true,
    true,
  ],
  [
    'canAddReceipt',
    () => api.canAddReceipt('g1'),
    'waves_can_add_receipt',
    { p_group_id: 'g1' },
    true,
    true,
  ],
  [
    'canAddExpenseAttachment',
    () => api.canAddExpenseAttachment('e1'),
    'waves_can_add_expense_attachment',
    { p_expense_id: 'e1' },
    true,
    true,
  ],
  [
    'deleteExpense',
    () => api.deleteExpense('e1'),
    'waves_delete_expense',
    { p_expense_id: 'e1' },
    null,
    undefined,
  ],
  [
    'restoreExpense',
    () => api.restoreExpense('e1'),
    'waves_restore_expense',
    { p_expense_id: 'e1' },
    null,
    undefined,
  ],
  [
    'confirmSettlement',
    () => api.confirmSettlement('s1'),
    'waves_confirm_settlement',
    { p_settlement_id: 's1' },
    null,
    undefined,
  ],
  [
    'setMemberRole',
    () => api.setMemberRole('m1', 'admin'),
    'waves_set_member_role',
    { p_member_id: 'm1', p_role: 'admin' },
    null,
    undefined,
  ],
  [
    'fetchMemberClaims',
    () => api.fetchMemberClaims('g1'),
    'waves_group_member_claims',
    { p_group_id: 'g1' },
    [{ id: 'c1' }],
    [{ id: 'c1' }],
  ],
  [
    'decideMemberClaim',
    () => api.decideMemberClaim('c1', true),
    'waves_decide_member_claim',
    { p_claim_id: 'c1', p_approve: true },
    { ok: true, status: 'approved' },
    { ok: true, status: 'approved' },
  ],
  [
    'ensureGroupJoinToken',
    () => api.ensureGroupJoinToken('g1'),
    'waves_ensure_group_join_token',
    { p_group_id: 'g1' },
    'tok',
    'tok',
  ],
  [
    'fetchPersonGroupBalances',
    () => api.fetchPersonGroupBalances('pk'),
    'waves_person_group_balances',
    { p_person_key: 'pk' },
    [{ group_id: 'g1' }],
    [{ group_id: 'g1' }],
  ],
  [
    'fetchPersonProfile',
    () => api.fetchPersonProfile('pk'),
    'waves_person_profile',
    { p_person_key: 'pk' },
    [{ person_key: 'pk' }, { person_key: 'other' }],
    { person_key: 'pk' },
  ],
  [
    'findPerson',
    () => api.findPerson('email', 'a@b.co'),
    'waves_find_person',
    { p_channel: 'email', p_value: 'a@b.co' },
    [{ profile_id: 'p2' }],
    { profile_id: 'p2' },
  ],
  [
    'mergeGhosts',
    () => api.mergeGhosts(['m1', 'm2'], 'Ravi'),
    'waves_merge_ghosts',
    { p_member_ids: ['m1', 'm2'], p_name: 'Ravi' },
    null,
    undefined,
  ],
  [
    'nudgeToSettle',
    () => api.nudgeToSettle({ groupId: 'g1', toMemberId: 'm2', currency: 'INR' }),
    'waves_nudge_to_settle',
    { p_group_id: 'g1', p_to_member_id: 'm2', p_currency: 'INR' },
    null,
    undefined,
  ],
  [
    'fetchItemClaims',
    () => api.fetchItemClaims('r1'),
    'waves_item_claims',
    { p_receipt_id: 'r1' },
    [{ item_index: 0, member_id: 'm1', revision: 1 }],
    [{ item_index: 0, member_id: 'm1', revision: 1 }],
  ],
  [
    'setItemClaim (own line)',
    () => api.setItemClaim({ receiptId: 'r1', itemIndex: 2, claimed: true }),
    'waves_set_item_claim',
    { p_receipt_id: 'r1', p_item_index: 2, p_claimed: true, p_for_member_id: null },
    null,
    undefined,
  ],
  [
    'setItemClaim (for a ghost)',
    () => api.setItemClaim({ receiptId: 'r1', itemIndex: 0, claimed: false, forMemberId: 'm9' }),
    'waves_set_item_claim',
    { p_receipt_id: 'r1', p_item_index: 0, p_claimed: false, p_for_member_id: 'm9' },
    null,
    undefined,
  ],
  [
    'fetchOpenReceipts',
    () => api.fetchOpenReceipts('g1'),
    'waves_open_receipts',
    { p_group_id: 'g1' },
    [{ id: 'r1' }],
    [{ id: 'r1' }],
  ],
  [
    'publishReceiptItems',
    () => api.publishReceiptItems('r1', [{ label: 'Dosa', total: 120 }]),
    'waves_publish_receipt_items',
    { p_receipt_id: 'r1', p_items: [{ label: 'Dosa', total: 120 }] },
    null,
    undefined,
  ],
  [
    'redeemPromoCode',
    () => api.redeemPromoCode('WAVES'),
    'waves_redeem_promo',
    { p_code: 'WAVES' },
    { ok: false, reason: 'EXPIRED' },
    { ok: false, reason: 'EXPIRED' },
  ],
  [
    'submitFeedback',
    () =>
      api.submitFeedback({
        message: 'Love it',
        kind: 'idea',
        rating: 5,
        appVersion: '1.2.3',
        platform: 'android',
        topics: ['sync'],
      }),
    'waves_submit_feedback',
    {
      p_message: 'Love it',
      p_kind: 'idea',
      p_rating: 5,
      p_app_version: '1.2.3',
      p_platform: 'android',
      p_topics: ['sync'],
    },
    null,
    undefined,
  ],
  [
    'erasurePreview',
    () => api.erasurePreview(),
    'waves_my_erasure_preview',
    undefined,
    [{ groups_count: 3 }],
    { groups_count: 3 },
  ],
  [
    'registerDevice',
    () =>
      api.registerDevice({
        deviceId: 'd1',
        label: 'Pixel',
        platform: 'android',
        appVersion: '1.0.0',
      } as never),
    'waves_register_device',
    { p_device_id: 'd1', p_label: 'Pixel', p_platform: 'android', p_app_version: '1.0.0' },
    { overLimit: false },
    { overLimit: false },
  ],
  [
    'fetchDevices',
    () => api.fetchDevices(),
    'waves_list_devices',
    undefined,
    [{ id: 'd1' }],
    [{ id: 'd1' }],
  ],
  [
    'signOutOtherDevices',
    () => api.signOutOtherDevices('d1'),
    'waves_sign_out_other_devices',
    { p_device_id: 'd1' },
    2,
    2,
  ],
];

describe.each(rpcCases)('%s', (_label, call, rpcName, params, data, expected) => {
  it(`calls ${rpcName} with its parameters and returns the answer`, async () => {
    h.rpc.mockResolvedValue(ok(data));

    await expect(call()).resolves.toEqual(expected);

    expect(h.rpc).toHaveBeenCalledTimes(1);
    const [name, sent] = h.rpc.mock.calls[0]!;
    expect(name).toBe(rpcName);
    expect(sent).toEqual(params);
  });

  it('throws the server message on an error', async () => {
    h.rpc.mockResolvedValue(fail(`${rpcName} refused`));
    await expect(call()).rejects.toThrow(`${rpcName} refused`);
  });
});

describe('RPC answers that come back empty', () => {
  it.each([
    ['canUploadGroupPhoto', () => api.canUploadGroupPhoto('g1'), false],
    ['canAddReceipt', () => api.canAddReceipt('g1'), false],
    ['canAddExpenseAttachment', () => api.canAddExpenseAttachment('e1'), false],
    ['fetchMemberClaims', () => api.fetchMemberClaims('g1'), []],
    ['decideMemberClaim', () => api.decideMemberClaim('c1', false), { ok: false }],
    ['fetchPersonGroupBalances', () => api.fetchPersonGroupBalances('pk'), []],
    ['fetchPersonProfile', () => api.fetchPersonProfile('pk'), null],
    ['findPerson', () => api.findPerson('phone', '+919876543210'), null],
    ['fetchItemClaims', () => api.fetchItemClaims('r1'), []],
    ['fetchOpenReceipts', () => api.fetchOpenReceipts('g1'), []],
    ['erasurePreview', () => api.erasurePreview(), null],
    ['fetchDevices', () => api.fetchDevices(), []],
    ['signOutOtherDevices', () => api.signOutOtherDevices('d1'), 0],
  ])('%s reads null data as its empty value', async (_name, call, empty) => {
    h.rpc.mockResolvedValue(ok(null));
    await expect(call()).resolves.toEqual(empty);
  });

  it('a permission check is only true for a literal true, never a truthy string', async () => {
    h.rpc.mockResolvedValue(ok('true'));
    expect(await api.canAddReceipt('g1')).toBe(false);
  });
});

describe('myStorageUsage', () => {
  it('reads the first row as numbers', async () => {
    h.rpc.mockResolvedValue(ok([{ used_bytes: '1024', cap_bytes: 5_000_000 }]));

    expect(await api.myStorageUsage()).toEqual({ usedBytes: 1024, capBytes: 5_000_000 });
    expect(h.rpc).toHaveBeenCalledWith('waves_my_storage_usage');
  });

  it('is zero on both counts when the RPC returns no row', async () => {
    h.rpc.mockResolvedValue(ok([]));
    expect(await api.myStorageUsage()).toEqual({ usedBytes: 0, capBytes: 0 });
  });

  it('throws on an error', async () => {
    h.rpc.mockResolvedValue(fail('nope'));
    await expect(api.myStorageUsage()).rejects.toThrow('nope');
  });
});

describe('createGroup', () => {
  it('sends every field, trimming the name', async () => {
    h.rpc.mockResolvedValue(ok('g-new'));

    const id = await api.createGroup({
      name: '  Goa trip ',
      type: 'trip' as never,
      currency: 'INR',
      emoji: '🌴',
      simplify: false,
      groupId: 'g-new',
      photoPath: 'g-new/cover.jpg',
      country: 'IN',
      creatorMemberId: 'm-me',
    });

    expect(id).toBe('g-new');
    expect(h.rpc).toHaveBeenCalledWith('waves_create_group', {
      p_name: 'Goa trip',
      p_type: 'trip',
      p_currency: 'INR',
      p_emoji: '🌴',
      p_simplify: false,
      p_group_id: 'g-new',
      p_photo_path: 'g-new/cover.jpg',
      p_country: 'IN',
      p_creator_member_id: 'm-me',
    });
  });

  it('sends nulls for what was left out, a blank name included, and simplifies by default', async () => {
    h.rpc.mockResolvedValue(ok('g2'));

    await api.createGroup({ name: '   ', type: 'home' as never, currency: 'EUR' });

    expect(h.rpc.mock.calls[0]![1]).toEqual({
      p_name: null,
      p_type: 'home',
      p_currency: 'EUR',
      p_emoji: null,
      p_simplify: true,
      p_group_id: null,
      p_photo_path: null,
      p_country: null,
      p_creator_member_id: null,
    });
  });

  it('throws on an error', async () => {
    h.rpc.mockResolvedValue(fail('RATE_LIMITED'));
    await expect(api.createGroup({ type: 'trip' as never, currency: 'INR' })).rejects.toThrow(
      'RATE_LIMITED',
    );
  });
});

describe('addGhostMember', () => {
  it('trims the name and email, and normalises the phone in the caller’s region', async () => {
    h.rpc.mockResolvedValue(ok('m-ghost'));

    const id = await api.addGhostMember(
      'g1',
      '  Ravi ',
      { email: ' ravi@example.com ', phone: '98765 43210' },
      'IN',
    );

    expect(id).toBe('m-ghost');
    expect(h.rpc).toHaveBeenCalledWith('waves_add_ghost_member', {
      p_group_id: 'g1',
      p_name: 'Ravi',
      p_member_id: null,
      p_email: 'ravi@example.com',
      p_phone: '+919876543210',
    });
  });

  it('sends nulls for a blank name and no contact', async () => {
    h.rpc.mockResolvedValue(ok('m2'));

    await api.addGhostMember('g1', ' ');

    expect(h.rpc.mock.calls[0]![1]).toEqual({
      p_group_id: 'g1',
      p_name: null,
      p_member_id: null,
      p_email: null,
      p_phone: null,
    });
  });

  it('refuses a bare local number with no region, in words, before calling the server', async () => {
    await expect(api.addGhostMember('g1', 'Ravi', { phone: '9876543210' })).rejects.toThrow(
      en.people.phoneNeedsCountryCode,
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('turns the server’s coded refusals into sentences', async () => {
    h.rpc.mockResolvedValueOnce(fail('PHONE_NEEDS_COUNTRY_CODE: bare number'));
    await expect(api.addGhostMember('g1', 'Ravi')).rejects.toThrow(en.people.phoneNeedsCountryCode);

    h.rpc.mockResolvedValueOnce(fail('NOTHING_TO_ADD: empty'));
    await expect(api.addGhostMember('g1', '')).rejects.toThrow('Give a name, an email or a number');
  });

  it('passes any other refusal through unchanged', async () => {
    h.rpc.mockResolvedValue(fail('NOT_A_MEMBER: not in group'));
    await expect(api.addGhostMember('g1', 'Ravi')).rejects.toThrow('NOT_A_MEMBER: not in group');
  });
});

describe('recordSettlement', () => {
  const base = { groupId: 'g1', fromMemberId: 'm1', toMemberId: 'm2', amount: 12_345n };

  it('sends the amount and allocations as strings and keeps a known rail as the method', async () => {
    h.rpc.mockResolvedValue(ok('s1'));

    const id = await api.recordSettlement({
      ...base,
      rail: 'upi',
      currency: 'INR',
      note: 'dinner',
      allocations: [{ expenseId: 'e1', amount: 5_000n }],
      clientMutationId: 'cm-1',
    });

    expect(id).toBe('s1');
    expect(h.rpc).toHaveBeenCalledWith('waves_record_settlement', {
      p_group_id: 'g1',
      p_from_member_id: 'm1',
      p_to_member_id: 'm2',
      p_amount: '12345',
      p_method: 'upi',
      p_rail: 'upi',
      p_currency: 'INR',
      p_note: 'dinner',
      p_allocations: [{ expenseId: 'e1', amount: '5000' }],
      p_client_mutation_id: 'cm-1',
    });
  });

  it('files a rail the enum does not know as method "other", keeping the rail itself', async () => {
    h.rpc.mockResolvedValue(ok('s2'));

    await api.recordSettlement({ ...base, rail: 'pix' });

    const sent = h.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(sent.p_method).toBe('other');
    expect(sent.p_rail).toBe('pix');
    expect(sent.p_currency).toBeNull();
    expect(sent.p_note).toBeNull();
    expect(sent.p_allocations).toEqual([]);
    // A fresh idempotency key when the caller did not bring one.
    expect(sent.p_client_mutation_id).toBe('uuid-1');
  });

  it('throws on an error', async () => {
    h.rpc.mockResolvedValue(fail('SELF_SETTLEMENT'));
    await expect(api.recordSettlement({ ...base, rail: 'cash' })).rejects.toThrow(
      'SELF_SETTLEMENT',
    );
  });
});

describe('deleteGroup', () => {
  it('calls the tombstone RPC', async () => {
    await api.deleteGroup('g1');
    expect(h.rpc).toHaveBeenCalledWith('waves_delete_group', { p_group_id: 'g1' });
  });

  it('turns NOT_ADMIN into a sentence and carries the code on the error', async () => {
    h.rpc.mockResolvedValue(fail('NOT_ADMIN: only admins'));

    const caught = await api.deleteGroup('g1').catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(en.group.deleteAdminOnly);
    expect((caught as { code?: string }).code).toBe('NOT_ADMIN');
  });

  it('keeps any other message raw and carries no code', async () => {
    h.rpc.mockResolvedValue(fail('connection reset'));

    const caught = (await api.deleteGroup('g1').catch((e: unknown) => e)) as Error & {
      code?: string;
    };

    expect(caught.message).toBe('connection reset');
    expect(caught.code).toBeUndefined();
  });
});

describe('importLedger', () => {
  it('sends every minor-unit amount as a string and defaults the origin to splitwise', async () => {
    h.rpc.mockResolvedValue(ok({ groupId: 'g1', expenses: 1, ghosts: 1, members: {} }));

    const result = await api.importLedger({
      groupId: 'g1',
      people: [{ name: 'Ravi', memberId: null }],
      expenses: [
        {
          clientMutationId: 'x1',
          description: 'Taxi',
          category: null,
          date: '2026-01-02',
          currency: 'INR',
          amount: 90_071_992_547_409_931n,
          payers: { Ravi: 90_071_992_547_409_931n },
          shares: { Ravi: 1n, Me: 90_071_992_547_409_930n },
        },
      ],
    });

    expect(result.expenses).toBe(1);
    const [name, sent] = h.rpc.mock.calls[0]! as [string, Record<string, unknown>];
    expect(name).toBe('waves_import_ledger');
    expect(sent.p_origin).toBe('splitwise');
    expect(sent.p_settlements).toEqual([]);
    expect(sent.p_people).toEqual([{ name: 'Ravi', memberId: null }]);
    // Beyond 2^53 on purpose: a JSON number would have lost the last digits.
    expect(sent.p_expenses).toEqual([
      {
        clientMutationId: 'x1',
        description: 'Taxi',
        category: null,
        date: '2026-01-02',
        currency: 'INR',
        amount: '90071992547409931',
        payers: { Ravi: '90071992547409931' },
        shares: { Ravi: '1', Me: '90071992547409930' },
      },
    ]);
  });

  it('carries a Waves export’s settlements, with a missing note as null', async () => {
    h.rpc.mockResolvedValue(ok({ groupId: 'g1', expenses: 0, ghosts: 0, members: {} }));

    await api.importLedger({
      groupId: 'g1',
      people: [],
      expenses: [],
      origin: 'waves',
      settlements: [
        {
          clientMutationId: 's1',
          from: 'Ravi',
          to: 'Me',
          currency: 'INR',
          amount: 500n,
          method: 'cash',
          status: 'confirmed',
          at: '2026-01-03T00:00:00Z',
        },
      ],
    });

    const sent = h.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(sent.p_origin).toBe('waves');
    expect(sent.p_settlements).toEqual([
      {
        clientMutationId: 's1',
        from: 'Ravi',
        to: 'Me',
        currency: 'INR',
        amount: '500',
        method: 'cash',
        status: 'confirmed',
        note: null,
        at: '2026-01-03T00:00:00Z',
      },
    ]);
  });

  it.each([
    ['NOT_A_MEMBER: x', 'You are not in that group'],
    ['NO_PEOPLE: x', 'That file named nobody to import'],
    ['something else', 'something else'],
  ])('maps the refusal %j to %j', async (message, expected) => {
    h.rpc.mockResolvedValue(fail(message));
    await expect(api.importLedger({ groupId: 'g1', people: [], expenses: [] })).rejects.toThrow(
      expected,
    );
  });
});

// ───────────────────────────────────────────── edge functions ──

/** A non-2xx from an edge function, as supabase-js wraps it. */
const functionError = (body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: { headers: new Headers(), json: async () => body },
});

describe('edge-function wrappers', () => {
  it('previewInvite asks invite-accept in preview mode', async () => {
    const preview = { group: null, memberCount: 3, claimable: [] };
    h.invoke.mockResolvedValue(ok(preview));

    expect(await api.previewInvite('tok')).toEqual(preview);
    expect(h.invoke).toHaveBeenCalledWith('invite-accept', {
      body: { token: 'tok', mode: 'preview' },
    });
  });

  it('acceptInvite asks invite-accept in join mode with the claim', async () => {
    const accepted = { group: { id: 'g1', name: 'Goa' }, memberId: 'm1' };
    h.invoke.mockResolvedValue(ok(accepted));

    expect(await api.acceptInvite({ token: 'tok', claimMemberId: 'm-ghost' })).toEqual(accepted);
    expect(h.invoke).toHaveBeenCalledWith('invite-accept', {
      body: { token: 'tok', claimMemberId: 'm-ghost', mode: 'join' },
    });
  });

  it('exportData passes the request through to export-data', async () => {
    const file = { filename: 'g.csv', contentType: 'text/csv', content: 'a,b' };
    h.invoke.mockResolvedValue(ok(file));

    expect(await api.exportData({ groupId: 'g1', format: 'csv', csvSeparator: ';' })).toEqual(file);
    expect(h.invoke).toHaveBeenCalledWith('export-data', {
      body: { groupId: 'g1', format: 'csv', csvSeparator: ';' },
    });
  });

  it('scanReceiptText sends the pasted text as a text_paste in INR by default', async () => {
    h.invoke.mockResolvedValue(ok({ receiptId: 'r1' }));

    await api.scanReceiptText({ groupId: 'g1', rawText: 'Dosa 120' });

    expect(h.invoke).toHaveBeenCalledWith('receipt-parse', {
      body: { groupId: 'g1', rawText: 'Dosa 120', source: 'text_paste', currency: 'INR' },
    });
  });

  it('scanReceiptText keeps the caller’s source and currency', async () => {
    h.invoke.mockResolvedValue(ok({ receiptId: 'r1' }));

    await api.scanReceiptText({ groupId: 'g1', rawText: 'x', source: 'camera', currency: 'EUR' });

    expect(h.invoke.mock.calls[0]![1]).toEqual({
      body: { groupId: 'g1', rawText: 'x', source: 'camera', currency: 'EUR' },
    });
  });

  it('fetchFxRate URL-encodes the pair and uses GET', async () => {
    const rate = { from: 'EUR', to: 'INR' };
    h.invoke.mockResolvedValue(ok(rate));

    expect(await api.fetchFxRate('EUR', 'I&R')).toEqual(rate);
    expect(h.invoke).toHaveBeenCalledWith('fx-rate?from=EUR&to=I%26R', { method: 'GET' });
  });

  it('deleteMyAccount sends the reason and reads a missing answer as {}', async () => {
    h.invoke.mockResolvedValueOnce(ok({ memberships_anonymised: 4 }));
    expect(await api.deleteMyAccount('moving on')).toEqual({ memberships_anonymised: 4 });
    expect(h.invoke).toHaveBeenCalledWith('account-delete', { body: { reason: 'moving on' } });

    h.invoke.mockResolvedValueOnce(ok(null));
    expect(await api.deleteMyAccount(null)).toEqual({});
  });

  it.each([
    ['previewInvite', () => api.previewInvite('tok')],
    ['acceptInvite', () => api.acceptInvite({ token: 'tok' })],
    ['exportData', () => api.exportData({ format: 'json' })],
    ['scanReceiptText', () => api.scanReceiptText({ groupId: 'g1', rawText: 'x' })],
    ['fetchFxRate', () => api.fetchFxRate('EUR', 'INR')],
    ['deleteMyAccount', () => api.deleteMyAccount(null)],
  ])('%s surfaces the function’s own code and message on a refusal', async (_name, call) => {
    h.invoke.mockResolvedValue({
      data: null,
      error: functionError({ code: 'INVITE_EXPIRED', message: 'That link has expired' }),
    });
    await expect(call()).rejects.toThrow('INVITE_EXPIRED: That link has expired');
  });

  it('a refusal body with a message but no code surfaces the bare message', async () => {
    h.invoke.mockResolvedValue({ data: null, error: functionError({ message: 'Just this' }) });
    await expect(api.previewInvite('tok')).rejects.toThrow(/^Just this$/);
  });

  it('a refusal body with no message falls back to the transport message', async () => {
    // supabase-js hands back a FunctionsHttpError — an Error carrying the response.
    const error = Object.assign(
      new Error('Edge Function returned a non-2xx status code'),
      functionError({ code: 'X' }),
    );
    h.invoke.mockResolvedValue({ data: null, error });
    await expect(api.previewInvite('tok')).rejects.toThrow(
      'Edge Function returned a non-2xx status code',
    );
  });

  it('an error that is not an Error and has no body is stringified', async () => {
    h.invoke.mockResolvedValue({ data: null, error: 'offline' });
    await expect(api.previewInvite('tok')).rejects.toThrow('offline');
  });
});

// ─────────────────────────────────────── storage-backed uploads ──

describe('group photos', () => {
  it('uploads to <group>/cover.<ext> and links the path onto the group', async () => {
    const path = await api.uploadGroupPhoto({
      groupId: 'g1',
      base64: 'AAA',
      mimeType: 'image/png',
    });

    expect(path).toBe('g1/cover.png');
    expect(h.putImage).toHaveBeenCalledWith({
      bucket: 'group-photos',
      path: 'g1/cover.png',
      base64: 'AAA',
      contentType: 'image/png',
      groupId: 'g1',
    });
    const { table, ops } = onlyChain();
    expect(table).toBe('groups');
    expect(op(ops, 'update')).toEqual([{ photo_path: 'g1/cover.png' }]);
    expect(op(ops, 'eq')).toEqual(['id', 'g1']);
  });

  it.each([
    ['image/webp', 'webp', 'image/webp'],
    ['image/heic', 'jpg', 'image/jpeg'],
    [null, 'jpg', 'image/jpeg'],
    [undefined, 'jpg', 'image/jpeg'],
  ])('stores a %s upload as .%s (%s)', async (mimeType, ext, contentType) => {
    const path = await api.uploadGroupPhoto({ groupId: 'g1', base64: 'A', mimeType });
    expect(path).toBe(`g1/cover.${ext}`);
    expect(h.putImage.mock.calls[0]![0]).toMatchObject({ contentType });
  });

  it('throws when linking the path fails', async () => {
    h.result = fail('rls');
    await expect(api.uploadGroupPhoto({ groupId: 'g1', base64: 'A' })).rejects.toThrow('rls');
  });

  it('resolves a signed URL from the private bucket', async () => {
    h.imageUrl.mockResolvedValue('https://signed');
    expect(await api.groupPhotoUrl('g1/cover.jpg')).toBe('https://signed');
    expect(h.imageUrl).toHaveBeenCalledWith('group-photos', 'g1/cover.jpg');
  });

  it('removes the object and clears the column', async () => {
    await api.removeGroupPhoto('g1', 'g1/cover.jpg');

    expect(h.removeImage).toHaveBeenCalledWith('group-photos', 'g1/cover.jpg');
    const { table, ops } = onlyChain();
    expect(table).toBe('groups');
    expect(op(ops, 'update')).toEqual([{ photo_path: null }]);
  });

  it('throws when clearing the column fails', async () => {
    h.result = fail('rls');
    await expect(api.removeGroupPhoto('g1', null)).rejects.toThrow('rls');
  });
});

describe('capture photos', () => {
  it('uploads to <owner>/<capture>.<ext> against the owner’s own ceiling', async () => {
    const path = await api.uploadCapturePhoto({
      ownerUserId: 'u1',
      captureId: 'c1',
      base64: 'B',
      mimeType: 'image/webp',
    });

    expect(path).toBe('u1/c1.webp');
    // No groupId: a capture belongs to nobody's group yet.
    expect(h.putImage).toHaveBeenCalledWith({
      bucket: 'captures',
      path: 'u1/c1.webp',
      base64: 'B',
      contentType: 'image/webp',
    });
    expect(h.chains).toHaveLength(0);
  });

  it('resolves a capture photo from its own bucket', async () => {
    h.imageUrl.mockResolvedValue(null);
    expect(await api.capturePhotoUrl(null)).toBeNull();
    expect(h.imageUrl).toHaveBeenCalledWith('captures', null);
  });
});

describe('kept expense bills', () => {
  it('lives at a path derived from the two ids alone', () => {
    expect(api.expenseReceiptPath('g1', 'e1')).toBe('g1/e1.jpg');
  });

  it('uploads as .jpg with the real content type and logs an "added" audit line', async () => {
    const path = await api.uploadExpenseReceipt({
      groupId: 'g1',
      expenseId: 'e1',
      base64: 'C',
      mimeType: 'image/png',
    });

    expect(path).toBe('g1/e1.jpg');
    expect(h.putImage).toHaveBeenCalledWith({
      bucket: 'receipts',
      path: 'g1/e1.jpg',
      base64: 'C',
      contentType: 'image/png',
      groupId: 'g1',
    });
    expect(h.rpc).toHaveBeenCalledWith('waves_log_receipt_event', {
      p_event_id: 'uuid-1',
      p_group_id: 'g1',
      p_expense_id: 'e1',
      p_action: 'added',
    });
  });

  it('keeps the bill even when the audit line fails to write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.rpc.mockResolvedValue(fail('audit down'));
    try {
      await expect(
        api.uploadExpenseReceipt({ groupId: 'g1', expenseId: 'e1', base64: 'C' }),
      ).resolves.toBe('g1/e1.jpg');
      expect(warn).toHaveBeenCalledWith('receipt audit log failed', 'audit down');
    } finally {
      warn.mockRestore();
    }
  });

  it('removes the object and logs a "removed" audit line', async () => {
    await api.removeExpenseReceipt('g1', 'e1');

    expect(h.removeImage).toHaveBeenCalledWith('receipts', 'g1/e1.jpg');
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_action: 'removed', p_expense_id: 'e1' });
  });

  it('resolves the kept bill from the receipts bucket', async () => {
    h.imageUrl.mockResolvedValue('https://bill');
    expect(await api.expenseReceiptUrl('g1', 'e1')).toBe('https://bill');
    expect(h.imageUrl).toHaveBeenCalledWith('receipts', 'g1/e1.jpg');
  });
});

describe('avatars', () => {
  it('uploads to <profile>/avatar.<ext> and stores the path on the profile', async () => {
    const path = await api.uploadAvatar({ profileId: 'p1', base64: 'D' });

    expect(path).toBe('p1/avatar.jpg');
    expect(h.putImage).toHaveBeenCalledWith({
      bucket: 'avatars',
      path: 'p1/avatar.jpg',
      base64: 'D',
      contentType: 'image/jpeg',
    });
    const { table, ops } = onlyChain();
    expect(table).toBe('profiles');
    expect(op(ops, 'update')).toEqual([{ avatar_url: 'p1/avatar.jpg' }]);
    expect(op(ops, 'eq')).toEqual(['id', 'p1']);
  });

  it('throws when linking the avatar fails', async () => {
    h.result = fail('rls');
    await expect(api.uploadAvatar({ profileId: 'p1', base64: 'D' })).rejects.toThrow('rls');
  });

  it('shows a provider URL as-is, signs a storage path, and has nothing for nothing', async () => {
    h.imageUrl.mockResolvedValue('https://signed');

    expect(await api.avatarPhotoUrl('https://lh3.googleusercontent.com/a')).toBe(
      'https://lh3.googleusercontent.com/a',
    );
    expect(await api.avatarPhotoUrl(null)).toBeNull();
    expect(h.imageUrl).not.toHaveBeenCalled();

    expect(await api.avatarPhotoUrl('p1/avatar.jpg')).toBe('https://signed');
    expect(h.imageUrl).toHaveBeenCalledWith('avatars', 'p1/avatar.jpg');
  });

  it('deletes only our own object, and always clears the column', async () => {
    await api.removeAvatar('p1', 'https://lh3.googleusercontent.com/a');
    expect(h.removeImage).not.toHaveBeenCalled();

    await api.removeAvatar('p1', 'p1/avatar.png');
    expect(h.removeImage).toHaveBeenCalledWith('avatars', 'p1/avatar.png');

    expect(h.chains).toHaveLength(2);
    for (const chain of h.chains) {
      expect(chain.table).toBe('profiles');
      expect(op(chain.ops, 'update')).toEqual([{ avatar_url: null }]);
    }
  });

  it('throws when clearing the column fails', async () => {
    h.result = fail('rls');
    await expect(api.removeAvatar('p1', null)).rejects.toThrow('rls');
  });
});

describe('scanReceipt', () => {
  it('stores the photo under a fresh receipt id, then has receipt-parse read it', async () => {
    h.invoke.mockResolvedValue(ok({ receiptId: 'uuid-1', status: 'parsed' }));

    const result = await api.scanReceipt({ groupId: 'g1', base64: 'E', mimeType: 'image/png' });

    expect(result).toEqual({ receiptId: 'uuid-1', status: 'parsed' });
    expect(h.putImage).toHaveBeenCalledWith({
      bucket: 'receipts',
      path: 'g1/uuid-1.png',
      base64: 'E',
      contentType: 'image/png',
      groupId: 'g1',
    });
    expect(h.invoke).toHaveBeenCalledWith('receipt-parse', {
      body: {
        groupId: 'g1',
        receiptId: 'uuid-1',
        storagePath: 'g1/uuid-1.png',
        source: 'camera',
        currency: 'INR',
      },
    });
  });

  it('throws the function’s refusal', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: functionError({ code: 'QUOTA', message: 'No scans left' }),
    });
    await expect(api.scanReceipt({ groupId: 'g1', base64: 'E', currency: 'EUR' })).rejects.toThrow(
      'QUOTA: No scans left',
    );
  });
});

// ─────────────────────────────────────── adding a contact ──

describe('startAddingContact', () => {
  it('asks the auth service to attach a normalised email', async () => {
    await api.startAddingContact(api.ContactChannel.Email, '  Ravi@Example.COM ');
    expect(h.updateUser).toHaveBeenCalledWith({ email: 'ravi@example.com' });
    expect(h.sendPhoneCode).not.toHaveBeenCalled();
  });

  it('proves a phone through the phone-code path, never the auth service', async () => {
    await api.startAddingContact(api.ContactChannel.Phone, '+91 98765 43210');
    expect(h.sendPhoneCode).toHaveBeenCalledWith('+919876543210');
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it('refuses a number without a country code before sending anything', async () => {
    await expect(api.startAddingContact(api.ContactChannel.Phone, '9876543210')).rejects.toThrow(
      /country code/,
    );
    expect(h.sendPhoneCode).not.toHaveBeenCalled();
  });

  it('explains "manual linking is disabled" as configuration, not a mistake', async () => {
    h.updateUser.mockResolvedValue({ error: { message: 'Manual linking is disabled' } });
    await expect(api.startAddingContact(api.ContactChannel.Email, 'a@b.co')).rejects.toThrow(
      'Linking a contact is switched off for this Waves server. Nothing is lost — carry on as a guest.',
    );
  });

  it('passes any other auth error through', async () => {
    h.updateUser.mockResolvedValue({ error: { message: 'Email rate limit exceeded' } });
    await expect(api.startAddingContact(api.ContactChannel.Email, 'a@b.co')).rejects.toThrow(
      'Email rate limit exceeded',
    );
  });
});

describe('confirmContact', () => {
  it('verifies an email change with the trimmed code', async () => {
    await api.confirmContact(api.ContactChannel.Email, 'A@B.co', ' 123456 ');
    expect(h.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      token: '123456',
      type: 'email_change',
    });
  });

  it('attaches a phone through the phone-code path', async () => {
    await api.confirmContact(api.ContactChannel.Phone, '+919876543210', '654321 ');
    expect(h.attachPhoneCode).toHaveBeenCalledWith('+919876543210', '654321');
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it('throws the verification error', async () => {
    h.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } });
    await expect(api.confirmContact(api.ContactChannel.Email, 'a@b.co', '1')).rejects.toThrow(
      'Token has expired',
    );
  });
});

describe('re-exports', () => {
  it('exposes the invite link helpers from the one source of the site domain', () => {
    expect(typeof api.INVITE_BASE).toBe('string');
    expect(typeof api.groupJoinLink).toBe('function');
  });
});
