import { beforeEach, it, expect, vi } from 'vitest';
import { renderHook, flush } from './support/fakeReact';
import { useInlineReceipt } from '../src/components/assistant/inline/useInlineReceipt';
vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
const w = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  picker: { receipt: null as any, attach: vi.fn(), onLibrary: vi.fn(), clear: vi.fn() },
}));
vi.mock('@/data/api', () => ({ uploadExpenseReceipt: w.upload, removeExpenseReceipt: w.remove }));
vi.mock('@/lib/quickReceipt', () => ({ useQuickReceipt: () => w.picker }));
const image = { base64: 'same-photo', mimeType: 'image/jpeg', uri: 'file://photo' };
const attached = vi.fn(),
  removed = vi.fn();
function mount(groupId: string | null = 'g') {
  return renderHook(() =>
    useInlineReceipt({ groupId, expenseId: 'e', onAttached: attached, onRemoved: removed }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  w.picker.receipt = null;
  w.upload.mockResolvedValue(undefined);
  w.remove.mockResolvedValue(undefined);
  w.picker.clear.mockImplementation(() => {
    w.picker.receipt = null;
  });
});
it('IN-R-01 picked photo uploads exactly once with image and expense identifiers', async () => {
  let resolve!: () => void;
  w.upload.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  const r = mount();
  w.picker.receipt = image;
  r.rerender();
  expect(r.result.current.status).toBe('uploading');
  r.rerender();
  expect(w.upload).toHaveBeenCalledExactlyOnceWith({
    groupId: 'g',
    expenseId: 'e',
    base64: image.base64,
    mimeType: image.mimeType,
  });
  resolve();
  await flush();
  expect(r.result.current.status).toBe('attached');
  expect(attached).toHaveBeenCalledOnce();
  r.unmount();
});
it('IN-R-02 failed upload keeps photo; retry sends same image and succeeds', async () => {
  w.upload.mockRejectedValueOnce(Error());
  w.picker.receipt = image;
  const r = mount();
  await flush();
  expect(r.result.current.status).toBe('failed');
  expect(r.result.current.image).toBe(image);
  r.result.current.retry();
  await flush();
  expect(w.upload).toHaveBeenCalledTimes(2);
  expect(w.upload.mock.calls[0]).toEqual(w.upload.mock.calls[1]);
  expect(r.result.current.status).toBe('attached');
  expect(attached).toHaveBeenCalledOnce();
  r.unmount();
});
it('IN-R-03 retry during upload does not start another', async () => {
  let resolve!: () => void;
  w.upload.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  w.picker.receipt = image;
  const r = mount();
  r.result.current.retry();
  r.result.current.retry();
  expect(w.upload).toHaveBeenCalledOnce();
  resolve();
  await flush();
  expect(r.result.current.status).toBe('attached');
  r.unmount();
});
it('IN-R-04 removal calls API, clears photo and reports idle', async () => {
  w.picker.receipt = image;
  const r = mount();
  await flush();
  r.result.current.remove();
  await flush();
  expect(w.remove).toHaveBeenCalledExactlyOnceWith('g', 'e');
  expect(w.picker.clear).toHaveBeenCalledOnce();
  expect(r.result.current.status).toBe('idle');
  expect(removed).toHaveBeenCalledOnce();
  r.unmount();
});
it('IN-R-05 removal failure keeps photo and reports removeFailed', async () => {
  w.remove.mockRejectedValue(Error());
  w.picker.receipt = image;
  const r = mount();
  await flush();
  r.result.current.remove();
  await flush();
  expect(r.result.current.status).toBe('removeFailed');
  expect(w.picker.clear).not.toHaveBeenCalled();
  expect(removed).not.toHaveBeenCalled();
  r.unmount();
});
it('IN-R-06 personal receipt never uploads; scan and pick forward to picker', async () => {
  w.picker.receipt = image;
  const r = mount(null);
  r.result.current.retry();
  r.result.current.scan();
  r.result.current.pick();
  await flush();
  expect(w.upload).not.toHaveBeenCalled();
  expect(w.picker.attach).toHaveBeenCalledOnce();
  expect(w.picker.onLibrary).toHaveBeenCalledOnce();
  r.unmount();
});
