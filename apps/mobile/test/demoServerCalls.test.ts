/**
 * The demo group is local fixture data: its ids (`demo-group-goa-trip`,
 * `demo-expense-flights`) are not UUIDs, so any read that reaches the server with
 * one comes back as "invalid input syntax for type uuid". Every server read a
 * demo screen can trigger answers locally instead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  invoke: vi.fn(),
  imageUrl: vi.fn(),
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@/lib/phoneAuth', () => ({ attachPhoneCode: vi.fn(), sendPhoneCode: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  imageUrl: h.imageUrl,
  putImage: vi.fn(),
  removeImage: vi.fn(),
}));
vi.mock('@/lib/backend', () => ({
  backendConfigured: true,
  backend: { rpc: h.rpc, from: h.from, functions: { invoke: h.invoke } },
}));

const api = await import('@/data/api');
const { DEMO_EXPENSE_FLIGHTS_ID, DEMO_GROUP_ID, isDemoId } = await import('@/demo/ids');

beforeEach(() => vi.clearAllMocks());

describe('demo ids never reach the server', () => {
  it('answers every group- and expense-keyed read locally', async () => {
    expect(await api.fetchOpenReceipts(DEMO_GROUP_ID)).toEqual([]);
    expect(await api.fetchMembers(DEMO_GROUP_ID)).toEqual([]);
    expect(await api.fetchBalances(DEMO_GROUP_ID)).toEqual([]);
    expect(await api.fetchMemberClaims(DEMO_GROUP_ID)).toEqual([]);
    expect(await api.fetchExpenseVersions(DEMO_EXPENSE_FLIGHTS_ID)).toEqual([]);
    expect(await api.canAddReceipt(DEMO_GROUP_ID)).toBe(true);
    expect(await api.canAddExpenseAttachment(DEMO_EXPENSE_FLIGHTS_ID)).toBe(true);
    expect(await api.canUploadGroupPhoto(DEMO_GROUP_ID)).toBe(false);
    expect(await api.expenseReceiptUrl(DEMO_GROUP_ID, DEMO_EXPENSE_FLIGHTS_ID)).toBeNull();

    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
    expect(h.imageUrl).not.toHaveBeenCalled();
  });

  it('still asks the server about a real group', async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    await api.fetchOpenReceipts('d668ae61-0000-4000-8000-000000000000');
    expect(h.rpc).toHaveBeenCalledWith('waves_open_receipts', {
      p_group_id: 'd668ae61-0000-4000-8000-000000000000',
    });
  });

  it('recognises demo ids and nothing else', () => {
    expect(isDemoId(DEMO_GROUP_ID)).toBe(true);
    expect(isDemoId(DEMO_EXPENSE_FLIGHTS_ID)).toBe(true);
    expect(isDemoId('d668ae61-0000-4000-8000-000000000000')).toBe(false);
    expect(isDemoId(null)).toBe(false);
  });
});
