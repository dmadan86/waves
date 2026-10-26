import { beforeEach, describe, expect, it, vi } from 'vitest';
import { launchUpi } from '../src/lib/upiLaunch';
const openURL = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ OS: 'ios' }));
const optionalModule = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Linking: { openURL }, Platform: platform }));
vi.mock('expo', () => ({ requireOptionalNativeModule: optionalModule }));
beforeEach(() => {
  vi.resetAllMocks();
  platform.OS = 'ios';
});
describe('UPI launch seam', () => {
  it('launches the URI and returns no payment confirmation', async () => {
    openURL.mockResolvedValueOnce(undefined);
    await expect(launchUpi('upi://pay?pa=ravi@upi')).resolves.toBeNull();
    expect(openURL).toHaveBeenCalledWith('upi://pay?pa=ravi@upi');
    expect(optionalModule).not.toHaveBeenCalled();
  });
  it('propagates a failed handoff without recording a payment', async () => {
    openURL.mockRejectedValueOnce(new Error('no app'));
    await expect(launchUpi('upi://pay?pa=ravi@upi')).rejects.toThrow('no app');
  });
  it('falls back to Linking on Android when the native module is missing', async () => {
    platform.OS = 'android';
    optionalModule.mockReturnValue(null);
    await expect(launchUpi('upi://pay?pa=ravi@upi')).resolves.toBeNull();
    expect(optionalModule).toHaveBeenCalledWith('WavesUpi');
    expect(openURL).toHaveBeenCalledWith('upi://pay?pa=ravi@upi');
  });
  it.each(['SUCCESS', 'FAILURE', 'SUBMITTED'])(
    'returns %s only as unverified prefill data',
    async (Status) => {
      platform.OS = 'android';
      const result = { txnId: 'id', ApprovalRefNo: '123456789012', Status };
      const nativeLaunch = vi.fn().mockResolvedValue(result);
      optionalModule.mockReturnValue({ launchUpi: nativeLaunch });
      await expect(launchUpi('upi://pay?pa=ravi@upi')).resolves.toEqual({
        ...result,
        utr: '123456789012',
      });
      expect(nativeLaunch).toHaveBeenCalledWith('upi://pay?pa=ravi@upi');
      expect(openURL).not.toHaveBeenCalled();
    },
  );
  it('keeps txnRef available for prefill when there is no transaction ID', async () => {
    platform.OS = 'android';
    optionalModule.mockReturnValue({ launchUpi: vi.fn().mockResolvedValue({ txnRef: 'ref' }) });
    await expect(launchUpi('upi://pay')).resolves.toEqual({ txnRef: 'ref' });
  });
  it('uses txnId as the reference hint when no approval reference is returned', async () => {
    platform.OS = 'android';
    optionalModule.mockReturnValue({ launchUpi: vi.fn().mockResolvedValue({ txnId: 'id' }) });
    await expect(launchUpi('upi://pay')).resolves.toEqual({ txnId: 'id', utr: 'id' });
  });
  it('returns null after cancellation or no app without launching again', async () => {
    platform.OS = 'android';
    optionalModule.mockReturnValue({ launchUpi: vi.fn().mockResolvedValue(null) });
    await expect(launchUpi('upi://pay')).resolves.toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });
  it('propagates native handoff errors without retrying Linking', async () => {
    platform.OS = 'android';
    optionalModule.mockReturnValue({ launchUpi: vi.fn().mockRejectedValue(new Error('busy')) });
    await expect(launchUpi('upi://pay')).rejects.toThrow('busy');
    expect(openURL).not.toHaveBeenCalled();
  });
});
