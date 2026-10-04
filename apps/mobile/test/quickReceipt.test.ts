import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flush, renderHook } from './support/fakeReact';

const h = vi.hoisted(() => ({
  available: true,
  captureReceipt: vi.fn(),
  pickReceiptImage: vi.fn(),
  receiptFromFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('@/lib/image', () => ({
  captureReceipt: h.captureReceipt,
  pickReceiptImage: h.pickReceiptImage,
  receiptFromFile: h.receiptFromFile,
}));
vi.mock('@/lib/qrScan', () => ({ cameraAvailable: () => h.available }));
vi.mock('@/lib/toast', () => ({ useToast: () => ({ show: h.toast }) }));
vi.mock('@/i18n', () => ({
  useStrings: () => ({ t: { quickExpense: { receiptCameraDenied: 'Camera is off' } } }),
}));

const { useQuickReceipt } = await import('@/lib/quickReceipt');

const PICKED = { base64: 'QUJD', mimeType: 'image/jpeg', uri: 'file:///bill.jpg' };
const SHOT = { uri: 'file:///shot.jpg', width: 3000, height: 4000 };

describe('useQuickReceipt', () => {
  beforeEach(() => {
    h.available = true;
    h.captureReceipt.mockReset().mockResolvedValue(PICKED);
    h.pickReceiptImage.mockReset().mockResolvedValue(PICKED);
    h.receiptFromFile.mockReset().mockResolvedValue(PICKED);
    h.toast.mockReset();
  });

  it('opens the camera directly, with no chooser and no picking yet', async () => {
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    expect(view.result.current.cameraOpen).toBe(true);
    expect(h.captureReceipt).not.toHaveBeenCalled();
    expect(h.pickReceiptImage).not.toHaveBeenCalled();
  });

  it('falls back to the scanner / system camera when the binary has no camera module', async () => {
    h.available = false;
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    expect(view.result.current.cameraOpen).toBe(false);
    expect(h.captureReceipt).toHaveBeenCalled();
    expect(view.result.current.receipt).toEqual(PICKED);
  });

  it('holds a shot, closes the camera and hands the dimensions on', async () => {
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    view.result.current.onShot(SHOT);
    await flush();
    expect(h.receiptFromFile).toHaveBeenCalledWith(SHOT.uri, SHOT);
    expect(view.result.current.cameraOpen).toBe(false);
    expect(view.result.current.receipt).toEqual(PICKED);
    expect(view.result.current.busy).toBe(false);
  });

  it('takes a library pick from the camera and closes it', async () => {
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    view.result.current.onLibrary();
    await flush();
    expect(h.pickReceiptImage).toHaveBeenCalled();
    expect(view.result.current.receipt).toEqual(PICKED);
    expect(view.result.current.cameraOpen).toBe(false);
  });

  it('stays on the camera when the library pick is cancelled', async () => {
    h.pickReceiptImage.mockResolvedValue(null);
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    view.result.current.onLibrary();
    await flush();
    expect(view.result.current.receipt).toBeNull();
    expect(view.result.current.cameraOpen).toBe(true);
  });

  it('on a permission refusal, says so and opens the library', async () => {
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    view.result.current.onDenied();
    await flush();
    expect(h.toast).toHaveBeenCalledWith('Camera is off');
    expect(h.pickReceiptImage).toHaveBeenCalled();
    expect(view.result.current.cameraOpen).toBe(false);
    expect(view.result.current.receipt).toEqual(PICKED);
  });

  it('closes the camera on back-out and clears the held receipt on demand', async () => {
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    view.result.current.closeCamera();
    await flush();
    expect(view.result.current.cameraOpen).toBe(false);

    view.result.current.onShot(SHOT);
    await flush();
    view.result.current.clear();
    await flush();
    expect(view.result.current.receipt).toBeNull();
  });
});
