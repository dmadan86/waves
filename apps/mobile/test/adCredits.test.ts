import { beforeEach, expect, it, vi } from 'vitest';
import { readCredits, spendCredits } from '@/lib/adCredits';
import { decideGate } from '@/lib/adGateEngine';
import { showCreditsRow } from '@/lib/adCreditsPure';
import { withScanCredits } from '@/lib/scanCredits';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/backend', () => ({ backend: { rpc } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'event-id' }));
beforeEach(() => {
  rpc.mockReset();
});
const wallet = {
  credits: 6,
  walletCap: 30,
  perAd: 6,
  costs: { voice: 1, scan: 2, export: 6, group: 6 },
  canWatch: true,
  reason: null,
  nextAt: null,
};
it.each(['error', 'null', 'throw'])(
  'missing credit RPCs (%s) preserve legacy ad path and hide Settings row',
  async (failure) => {
    if (failure === 'throw') rpc.mockRejectedValue(new Error('missing function'));
    else
      rpc.mockResolvedValue(
        failure === 'error'
          ? { error: { code: 'PGRST202' }, data: null }
          : { error: null, data: null },
      );
    const status = await readCredits();
    expect(status).toBeNull();
    expect(showCreditsRow(false, status)).toBe(false);
    expect(
      decideGate({
        paid: false,
        online: true,
        required: true,
        placement: 'export_rewarded',
        localGroups: 1,
        credits: status?.credits ?? 0,
        passesUsed: 0,
      }),
    ).toBe('ask');
    expect(await spendCredits('export')).toBeNull();
  },
);
it('uses an event UUID for a server spend', async () => {
  rpc.mockResolvedValue({ data: { ok: true, spent: 2, credits: 4 }, error: null });
  expect(await spendCredits('scan')).toMatchObject({ ok: true, spent: 2 });
  expect(rpc).toHaveBeenCalledWith('waves_spend_credits', {
    p_kind: 'scan',
    p_event_id: 'event-id',
  });
});
it('does not read or spend wallet credits while free scan allowance remains', async () => {
  const toast = vi.fn();
  expect(await withScanCredits(async () => 'scan', toast)).toBe('scan');
  expect(rpc).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});
it('buys one scan only after quota refusal, then retries the same scan once', async () => {
  const scan = vi
    .fn()
    .mockRejectedValueOnce(new Error('SCAN_QUOTA_REACHED'))
    .mockResolvedValue('scan');
  rpc
    .mockResolvedValueOnce({ data: wallet, error: null })
    .mockResolvedValueOnce({ data: { ok: true, spent: 2, credits: 4 }, error: null });
  const toast = vi.fn();
  expect(await withScanCredits(scan, toast)).toBe('scan');
  expect(scan).toHaveBeenCalledTimes(2);
  expect(toast).toHaveBeenCalledWith(2);
});
