import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: { OS: 'android' },
  requireOptionalNativeModule: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: native.platform }));
vi.mock('expo', () => ({ requireOptionalNativeModule: native.requireOptionalNativeModule }));

const { isAvailable, shareImageWithText } = await import('../modules/waves-share');

const opts = { fileUri: 'file:///a.png', mimeType: 'image/png', text: 't', target: 'any' } as const;

beforeEach(() => {
  native.platform.OS = 'android';
  native.requireOptionalNativeModule.mockReset();
});

describe('waves-share', () => {
  it('passes the options to the native module with an empty default subject', async () => {
    const fn = vi.fn().mockResolvedValue('shared');
    native.requireOptionalNativeModule.mockReturnValue({ shareImageWithText: fn });
    await expect(shareImageWithText(opts)).resolves.toBe('shared');
    expect(fn).toHaveBeenCalledWith({ ...opts, subject: '' });
    expect(isAvailable()).toBe(true);
  });

  it('is unavailable when the binary lacks the module', async () => {
    native.requireOptionalNativeModule.mockReturnValue(null);
    expect(isAvailable()).toBe(false);
    await expect(shareImageWithText(opts)).resolves.toBe('unavailable');
  });

  it('is unavailable on web without looking for the module', async () => {
    native.platform.OS = 'web';
    await expect(shareImageWithText(opts)).resolves.toBe('unavailable');
    expect(native.requireOptionalNativeModule).not.toHaveBeenCalled();
  });
});
