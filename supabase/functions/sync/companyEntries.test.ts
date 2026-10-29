import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const MEMBER_ID = '11111111-2222-3333-4444-555555555555';

function caller() {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === 'waves_my_member_id' ? MEMBER_ID : {}, error: null }),
  );
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { rpc, from } as never, rpc };
}

function service() {
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { from } as never };
}

function mutation(kind: string, payload: Record<string, unknown>) {
  return {
    clientMutationId: kind,
    kind,
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-10-19T04:00:00.000Z',
    payload,
  } as never;
}

const ENTRY = '00000000-0000-4000-8000-0000000000aa';
const data = { amount: '100', occurredOn: '2026-11-04' };
const cases = [
  [
    'company.settings_set',
    { defaultDailyRateMinor: '0', approvalsEnabled: true },
    'waves_company_settings_set',
    { p_group_id: GROUP_ID, p_default_daily_rate_minor: '0', p_approvals_enabled: true },
  ],
  [
    'company.settings_set',
    { defaultDailyRateMinor: null, approvalsEnabled: false },
    'waves_company_settings_set',
    { p_group_id: GROUP_ID, p_default_daily_rate_minor: null, p_approvals_enabled: false },
  ],
  [
    'company_entry.create',
    { entryId: ENTRY, memberId: MEMBER_ID, entryKind: 'expense', data },
    'waves_company_entry_create',
    {
      p_group_id: GROUP_ID,
      p_entry_id: ENTRY,
      p_member_id: MEMBER_ID,
      p_entry_kind: 'expense',
      p_data: data,
    },
  ],
  [
    'company_entry.create',
    {
      entryId: ENTRY,
      memberId: null,
      entryKind: 'expense',
      data: { ...data, paidByCompany: true },
    },
    'waves_company_entry_create',
    {
      p_group_id: GROUP_ID,
      p_entry_id: ENTRY,
      p_member_id: null,
      p_entry_kind: 'expense',
      p_data: { ...data, paidByCompany: true },
    },
  ],
  [
    'company_entry.update',
    { entryId: ENTRY, patch: { note: 'Taxi' } },
    'waves_company_entry_update',
    { p_entry_id: ENTRY, p_patch: { note: 'Taxi' } },
  ],
  [
    'company_entry.void',
    { entryId: ENTRY, reason: 'Correction' },
    'waves_company_entry_void',
    { p_entry_id: ENTRY, p_reason: 'Correction' },
  ],
  [
    'company_entry.transition',
    { entryId: ENTRY, to: 'approved', note: 'Checked', expectedVersion: 3 },
    'waves_company_entry_transition',
    { p_entry_id: ENTRY, p_to: 'approved', p_note: 'Checked', p_expected_version: 3 },
  ],
  [
    'company_member.rate_set',
    { memberId: MEMBER_ID, dailyRateMinor: '40000' },
    'waves_company_member_rate_set',
    { p_group_id: GROUP_ID, p_member_id: MEMBER_ID, p_daily_rate_minor: '40000' },
  ],
  [
    'company_member.rate_set',
    { memberId: MEMBER_ID, dailyRateMinor: null },
    'waves_company_member_rate_set',
    { p_group_id: GROUP_ID, p_member_id: MEMBER_ID, p_daily_rate_minor: null },
  ],
  [
    'company_pool.post',
    {
      entryId: ENTRY,
      managerId: MEMBER_ID,
      kind: 'pool_adjustment',
      amountMinor: '-25',
      projectId: null,
      occurredOn: '2026-11-04',
      reason: 'Counted cash',
    },
    'waves_company_pool_post',
    {
      p_group_id: GROUP_ID,
      p_entry_id: ENTRY,
      p_manager_id: MEMBER_ID,
      p_kind: 'pool_adjustment',
      p_amount_minor: '-25',
      p_project_id: null,
      p_occurred_on: '2026-11-04',
      p_reason: 'Counted cash',
    },
  ],
  [
    'company_member.assign',
    { memberId: MEMBER_ID, managerId: null, reason: '' },
    'waves_company_member_assign',
    { p_member_id: MEMBER_ID, p_manager_id: null, p_reason: null },
  ],
  [
    'company_wage.pay',
    {
      runId: ENTRY,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-07',
      paidOn: '2026-11-07',
      lines: [
        {
          paymentEntryId: ENTRY.replace('aa', 'bb'),
          memberId: MEMBER_ID,
          projectId: null,
          fundingManagerId: null,
          calcMode: 'fixed_weekly',
          days: null,
          rateMinor: null,
          fixedMinor: '600',
          claimIds: [],
          expectedGrossMinor: '600',
          expectedRecoveryMinor: '100',
          expectedNetMinor: '500',
          note: null,
        },
      ],
    },
    'waves_company_wage_pay',
    {
      p_group_id: GROUP_ID,
      p_run_id: ENTRY,
      p_period_start: '2026-11-01',
      p_period_end: '2026-11-07',
      p_paid_on: '2026-11-07',
      p_lines: [
        {
          paymentEntryId: ENTRY.replace('aa', 'bb'),
          memberId: MEMBER_ID,
          projectId: null,
          fundingManagerId: null,
          calcMode: 'fixed_weekly',
          days: null,
          rateMinor: null,
          fixedMinor: '600',
          claimIds: [],
          expectedGrossMinor: '600',
          expectedRecoveryMinor: '100',
          expectedNetMinor: '500',
          note: null,
        },
      ],
    },
  ],
] as const;
describe('company sync mutations', () => {
  it.each(cases)('dispatches %s as caller', async (kind, payload, rpc, args) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);
    expect(await session.apply(mutation(kind, payload))).toMatchObject({ status: 'applied' });
    expect(scoped.rpc).toHaveBeenCalledWith(rpc, args);
  });
  it.each([
    ['company_entry.create', { memberId: MEMBER_ID, entryKind: 'expense', data }],
    [
      'company_entry.create',
      { entryId: ENTRY, memberId: MEMBER_ID, entryKind: 'expense', data: { amount: 100 } },
    ],
    ['company_entry.create', { entryId: ENTRY, memberId: null, entryKind: 'expense', data }],
    [
      'company_entry.create',
      { entryId: ENTRY, memberId: MEMBER_ID, entryKind: 'expense', data: { ...data, paidByCompany: true } },
    ],
    [
      'company_entry.create',
      { entryId: ENTRY, memberId: null, entryKind: 'expense', data: { ...data, paidByCompany: 'yes' } },
    ],
    ['company_entry.update', { entryId: ENTRY, patch: [] }],
    ['company_entry.update', { entryId: ENTRY, patch: { status: 'approved' } }],
    ['company_entry.void', { entryId: ENTRY, reason: 5 }],
    ['company_entry.transition', { entryId: ENTRY }],
    ['company_entry.transition', { entryId: ENTRY, to: 'approved' }],
    ['company_entry.transition', { entryId: ENTRY, to: 'approved', expectedVersion: '2' }],
    ['company.settings_set', { defaultDailyRateMinor: '100' }],
    ['company.settings_set', { defaultDailyRateMinor: 100, approvalsEnabled: true }],
    ['company_member.rate_set', { memberId: MEMBER_ID, dailyRateMinor: 40000 }],
  ])('rejects malformed %s before RPC', async (kind, payload) => {
    const scoped = caller();
    const session = new SyncSession(scoped.client, service().client, OWNER);
    expect(
      await session.apply(mutation(kind as string, payload as Record<string, unknown>)),
    ).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(scoped.rpc).not.toHaveBeenCalled();
  });
});

it('returns stale reviews as deterministic conflicts', async () => {
  const scoped = caller();
  scoped.rpc.mockResolvedValueOnce({
    data: null,
    error: { code: '23514', message: 'VERSION_CONFLICT: entry changed; refresh before review' },
  } as never);
  const session = new SyncSession(scoped.client, service().client, OWNER);
  expect(
    await session.apply(
      mutation('company_entry.transition', { entryId: ENTRY, to: 'approved', expectedVersion: 1 }),
    ),
  ).toMatchObject({ status: 'rejected', code: 'VERSION_CONFLICT' });
});

const policies = {
  version: 1,
  rules: [
    {
      id: 'fuel-month',
      type: 'period_limit',
      target: 'fuel',
      period: 'month',
      limitMinor: '50000',
      effect: 'block',
    },
    { id: 'receipt', type: 'receipt_above', limitMinor: '10000', effect: 'warn' },
  ],
};
const reimbursement = {
  reimbursementId: ENTRY,
  memberId: MEMBER_ID,
  claims: [{ entryId: GROUP_ID, expectedVersion: 2 }],
  adjustments: [],
  cutoff: '2026-11-30',
  paidOn: '2026-12-01',
  expectedAmountMinor: '100',
  note: null,
};

it.each([
  [
    'company.policies_set',
    { policies, expectedRevision: 0 },
    'waves_company_policies_set',
    { p_group_id: GROUP_ID, p_policies: policies, p_expected_revision: 0 },
  ],
  [
    'company.mileage_rate_set',
    { memberId: null, rateMinor: '0' },
    'waves_company_mileage_rate_set',
    { p_group_id: GROUP_ID, p_member_id: null, p_rate_minor: '0' },
  ],
  [
    'company.mileage_rate_set',
    { memberId: MEMBER_ID, rateMinor: null },
    'waves_company_mileage_rate_set',
    { p_group_id: GROUP_ID, p_member_id: MEMBER_ID, p_rate_minor: null },
  ],
  [
    'company.reimburse',
    reimbursement,
    'waves_company_reimburse',
    {
      p_group_id: GROUP_ID,
      p_reimbursement_id: ENTRY,
      p_member_id: MEMBER_ID,
      p_claims: reimbursement.claims,
      p_adjustments: [],
      p_cutoff: reimbursement.cutoff,
      p_paid_on: reimbursement.paidOn,
      p_expected_amount_minor: '100',
      p_note: null,
    },
  ],
  [
    'company_entry.update',
    {
      entryId: ENTRY,
      patch: {
        vendor: 'Shop',
        gstin: '27AAPFU0939F1ZV',
        invoiceNo: 'INV-1',
        gstRateBps: 1800,
        gstAmountMinor: '15',
        distanceKm: null,
        fromText: null,
        toText: null,
      },
    },
    'waves_company_entry_update',
    {
      p_entry_id: ENTRY,
      p_patch: {
        vendor: 'Shop',
        gstin: '27AAPFU0939F1ZV',
        invoiceNo: 'INV-1',
        gstRateBps: 1800,
        gstAmountMinor: '15',
        distanceKm: null,
        fromText: null,
        toText: null,
      },
    },
  ],
  [
    'company_entry.create',
    {
      entryId: ENTRY,
      memberId: MEMBER_ID,
      entryKind: 'expense',
      data: {
        ...data,
        calcMode: 'distance_rate',
        category: 'fuel',
        distanceKm: '1.25',
        rateMinor: '3',
        fromText: 'A',
        toText: 'B',
      },
    },
    'waves_company_entry_create',
    {
      p_group_id: GROUP_ID,
      p_entry_id: ENTRY,
      p_member_id: MEMBER_ID,
      p_entry_kind: 'expense',
      p_data: {
        ...data,
        calcMode: 'distance_rate',
        category: 'fuel',
        distanceKm: '1.25',
        rateMinor: '3',
        fromText: 'A',
        toText: 'B',
      },
    },
  ],
])('dispatches Phase 3 %s as caller', async (kind, payload, rpc, args) => {
  const scoped = caller();
  const session = new SyncSession(scoped.client, service().client, OWNER);
  expect(
    await session.apply(mutation(kind as string, payload as Record<string, unknown>)),
  ).toMatchObject({ status: 'applied' });
  expect(scoped.rpc).toHaveBeenCalledWith(rpc, args);
});

it.each([
  ['company.policies_set', { policies, expectedRevision: -1 }],
  [
    'company.policies_set',
    {
      policies: {
        version: 1,
        rules: [{ id: 'r', type: 'receipt_above', effect: 'block', limitMinor: '1' }],
      },
      expectedRevision: 0,
    },
  ],
  [
    'company.policies_set',
    {
      policies: {
        version: 1,
        rules: [
          {
            id: 'r',
            type: 'period_limit',
            effect: 'block',
            limitMinor: 1,
            target: 'fuel',
            period: 'year',
          },
        ],
      },
      expectedRevision: 0,
    },
  ],
  ['company.mileage_rate_set', { memberId: MEMBER_ID, rateMinor: 10 }],
  ['company.mileage_rate_set', { memberId: MEMBER_ID, rateMinor: '-1' }],
  ['company.mileage_rate_set', { memberId: 'foreign', rateMinor: '1' }],
  ['company.reimburse', { ...reimbursement, expectedAmountMinor: 100 }],
  ['company.reimburse', { ...reimbursement, claims: [] }],
  [
    'company.reimburse',
    { ...reimbursement, claims: [{ entryId: GROUP_ID, expectedVersion: '2' }] },
  ],
  ['company.reimburse', { ...reimbursement, adjustments: null }],
  ['company.reimburse', { ...reimbursement, cutoff: '2026-02-30' }],
  ['company_entry.update', { entryId: ENTRY, patch: { gstRateBps: '1800' } }],
  ['company_entry.update', { entryId: ENTRY, patch: { gstAmountMinor: 10 } }],
  ['company_entry.update', { entryId: ENTRY, patch: { distanceKm: '1.001' } }],
  ['company_entry.update', { entryId: ENTRY, patch: { policyFlags: [] } }],
  ['company_entry.update', { entryId: ENTRY, patch: { reimbursementId: ENTRY } }],
])('rejects malformed Phase 3 %s', async (kind, payload) => {
  const scoped = caller();
  const session = new SyncSession(scoped.client, service().client, OWNER);
  expect(
    await session.apply(mutation(kind as string, payload as Record<string, unknown>)),
  ).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
  expect(scoped.rpc).not.toHaveBeenCalled();
});

it.each(['POLICY_BLOCKED', 'ENTRY_REIMBURSED', 'SELECTION_CHANGED', 'IDEMPOTENCY_CONFLICT'])(
  'preserves %s',
  async (code) => {
    const scoped = caller();
    scoped.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: `${code}: detail` },
    } as never);
    const session = new SyncSession(scoped.client, service().client, OWNER);
    expect(await session.apply(mutation('company.reimburse', reimbursement))).toMatchObject({
      status: 'rejected',
      code,
    });
  },
);

it.each([
  [
    'company_tag.add',
    { key: 'cement-bags', label: 'Cement', unit: 'bag' },
    'waves_company_tag_add',
    { p_group_id: GROUP_ID, p_key: 'cement-bags', p_label: 'Cement', p_unit: 'bag' },
  ],
  [
    'company_tag.add',
    { key: 'cement', label: 'Cement' },
    'waves_company_tag_add',
    { p_group_id: GROUP_ID, p_key: 'cement', p_label: 'Cement', p_unit: null },
  ],
  [
    'company_tags.set',
    {
      tags: [{ key: 'cement', label: 'Cement', hidden: true, addedBy: MEMBER_ID }],
      industry: 'construction',
    },
    'waves_company_tags_set',
    {
      p_group_id: GROUP_ID,
      p_tags: [{ key: 'cement', label: 'Cement', hidden: true, addedBy: MEMBER_ID }],
      p_industry: 'construction',
    },
  ],
  [
    'company_tags.set',
    { tags: [], industry: null },
    'waves_company_tags_set',
    { p_group_id: GROUP_ID, p_tags: [], p_industry: null },
  ],
  [
    'company.policies_set',
    {
      policies: {
        version: 1,
        rules: [
          {
            id: 'custom',
            type: 'period_limit',
            target: 'cement-bags',
            period: 'month',
            effect: 'block',
            limitMinor: '100',
          },
        ],
      },
      expectedRevision: 0,
    },
    'waves_company_policies_set',
    {
      p_group_id: GROUP_ID,
      p_policies: {
        version: 1,
        rules: [
          {
            id: 'custom',
            type: 'period_limit',
            target: 'cement-bags',
            period: 'month',
            effect: 'block',
            limitMinor: '100',
          },
        ],
      },
      p_expected_revision: 0,
    },
  ],
])('dispatches tag contract %s as caller', async (kind, payload, rpc, args) => {
  const scoped = caller();
  const session = new SyncSession(scoped.client, service().client, OWNER);
  expect(
    await session.apply(mutation(kind as string, payload as Record<string, unknown>)),
  ).toMatchObject({ status: 'applied' });
  expect(scoped.rpc).toHaveBeenCalledWith(rpc, args);
});

it.each([
  ['company_tag.add', { key: 'BAD', label: 'Cement' }],
  ['company_tag.add', { key: 'cement', label: '' }],
  ['company_tag.add', { key: 'cement', label: 'x'.repeat(41) }],
  ['company_tag.add', { key: 'cement', label: 'Cement', hidden: true }],
  ['company_tag.add', { key: 'cement', label: 'Cement', unit: null }],
  ['company_tags.set', { tags: [], industry: 'agriculture' }],
  ['company_tags.set', { tags: [] }],
  [
    'company_tags.set',
    {
      tags: [
        { key: 'a', label: 'A' },
        { key: 'a', label: 'B' },
      ],
      industry: null,
    },
  ],
  ['company_tags.set', { tags: [{ key: 'a', label: 'A', hidden: 'yes' }], industry: null }],
  ['company_tags.set', { tags: [{ key: 'a', label: 'A', addedBy: 'invalid' }], industry: null }],
  [
    'company_tags.set',
    { tags: Array.from({ length: 51 }, (_, i) => ({ key: `a${i}`, label: 'A' })), industry: null },
  ],
])('rejects invalid tag contract %s before RPC', async (kind, payload) => {
  const scoped = caller();
  const session = new SyncSession(scoped.client, service().client, OWNER);
  expect(
    await session.apply(mutation(kind as string, payload as Record<string, unknown>)),
  ).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
  expect(scoped.rpc).not.toHaveBeenCalled();
});
