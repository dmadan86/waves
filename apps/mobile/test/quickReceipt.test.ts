import { beforeEach, describe, expect, it, vi } from 'vitest';

import { receiptPhotoActions } from '@/lib/receiptPhotoActions';

import { flush, renderHook } from './support/fakeReact';

const h = vi.hoisted(() => ({
  choose: vi.fn(),
  captureReceipt: vi.fn(),
  pickReceiptImage: vi.fn(),
}));

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ choose: h.choose }) }));
vi.mock('@/lib/image', () => ({
  captureReceipt: h.captureReceipt,
  pickReceiptImage: h.pickReceiptImage,
}));
vi.mock('@/i18n', () => ({
  useStrings: () => ({
    t: {
      quickExpense: {
        addReceipt: 'Add receipt',
        takePhoto: 'Take photo',
        chooseFromLibrary: 'Choose from library',
        removeReceipt: 'Remove receipt',
      },
    },
  }),
}));

const { useQuickReceipt } = await import('@/lib/quickReceipt');

const labels = { takePhoto: 'Take photo', chooseFromLibrary: 'Choose from library' };

describe('receiptPhotoActions', () => {
  it('offers the camera and the library, in that order, with no third row', () => {
    // Unlike the avatar sheet this has no destructive option — removing an
    // attached receipt is the chip's own "x", not a choice offered here.
    expect(receiptPhotoActions(labels)).toEqual([
      { id: 'camera', label: 'Take photo', icon: 'camera-outline' },
      { id: 'library', label: 'Choose from library', icon: 'images-outline' },
    ]);
  });
});

describe('useQuickReceipt', () => {
  const PICKED = { base64: 'QUJD', mimeType: 'image/jpeg', uri: 'file:///bill.jpg' };

  beforeEach(() => {
    h.choose.mockReset();
    h.captureReceipt.mockReset().mockResolvedValue(PICKED);
    h.pickReceiptImage.mockReset().mockResolvedValue(PICKED);
  });

  async function openAndChoose(answer: string | null) {
    h.choose.mockResolvedValue(answer);
    const view = renderHook(() => useQuickReceipt());
    view.result.current.attach();
    await flush();
    return view;
  }

  it('asks which door before picking anything', async () => {
    await openAndChoose(null);
    expect(h.choose).toHaveBeenCalledWith({
      title: 'Add receipt',
      options: receiptPhotoActions(labels),
    });
    expect(h.captureReceipt).not.toHaveBeenCalled();
    expect(h.pickReceiptImage).not.toHaveBeenCalled();
  });

  it('holds the camera photo without uploading it', async () => {
    const view = await openAndChoose('camera');
    expect(h.captureReceipt).toHaveBeenCalled();
    expect(h.pickReceiptImage).not.toHaveBeenCalled();
    expect(view.result.current.receipt).toEqual(PICKED);
    expect(view.result.current.busy).toBe(false);
  });

  it('holds a library photo the same way', async () => {
    const view = await openAndChoose('library');
    expect(h.pickReceiptImage).toHaveBeenCalled();
    expect(h.captureReceipt).not.toHaveBeenCalled();
    expect(view.result.current.receipt).toEqual(PICKED);
  });

  it('keeps nothing held when the picker is backed out of', async () => {
    h.captureReceipt.mockResolvedValue(null);
    const view = await openAndChoose('camera');
    expect(view.result.current.receipt).toBeNull();
  });

  it('clears the held receipt on demand', async () => {
    const view = await openAndChoose('camera');
    expect(view.result.current.receipt).toEqual(PICKED);

    view.result.current.clear();
    await flush();
    expect(view.result.current.receipt).toBeNull();
  });
});
