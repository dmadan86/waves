import { describe, expect, it, vi } from 'vitest';
import { launchUpi } from '../src/lib/upiLaunch';
const openURL = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Linking: { openURL } }));
describe('UPI launch seam', () => {
  it('launches the URI and returns no payment confirmation', async () => {
    openURL.mockResolvedValueOnce(undefined);
    await expect(launchUpi('upi://pay?pa=ravi@upi')).resolves.toBeNull();
    expect(openURL).toHaveBeenCalledWith('upi://pay?pa=ravi@upi');
  });
  it('propagates a failed handoff without recording a payment', async () => {
    openURL.mockRejectedValueOnce(new Error('no app'));
    await expect(launchUpi('upi://pay?pa=ravi@upi')).rejects.toThrow('no app');
  });
});
