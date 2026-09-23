/**
 * Choosing a picture and making it a sensible size before it leaves the phone.
 *
 * The fakes below stand in for the picker, the file system, the document
 * scanner and `expo-image-manipulator`. The manipulator records what it was
 * asked to do (which edge was capped, which format was saved), so these tests
 * can say what the phone would actually upload.
 *
 * `image.ts` caches whether the manipulator loaded, so every test loads a fresh
 * copy of the module (`vi.resetModules`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Asset = { uri: string; width: number; height: number; mimeType?: string };
type SaveOptions = { base64: boolean; compress: number; format: string };

const h = vi.hoisted(() => {
  const state = {
    platform: { OS: 'ios' as string },
    /** What `Image.getSize` reports; null makes it fail. */
    size: { width: 1000, height: 3000 } as { width: number; height: number } | null,
    formats: { WEBP: 'webp' as string | undefined, JPEG: 'jpeg' },
    webpThrows: false,
    webpNoBase64: false,
    jpegNoBase64: false,
    renderThrows: false,
    /** base64 the tiny preview comes back as. */
    previewBase64: 'cHJldmlldw==' as string | undefined,
    /** Every manipulation, in order: the source and the operations applied. */
    manipulations: [] as { uri: string; ops: unknown[][] }[],
    saves: [] as (SaveOptions & { uri: string })[],
    fileBase64: 'b3JpZ2luYWw=',
    permissions: { camera: true, library: true },
    launch: {
      camera: vi.fn(),
      library: vi.fn(),
    },
    scan: vi.fn(),
  };
  return state;
});

vi.mock('react-native', () => ({
  Platform: h.platform,
  Image: {
    getSize: (
      _uri: string,
      ok: (width: number, height: number) => void,
      fail: (error: unknown) => void,
    ) => (h.size ? ok(h.size.width, h.size.height) : fail(new Error('unreadable'))),
  },
}));

vi.mock('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}
    async base64() {
      return h.fileBase64;
    }
  },
}));

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: async () => ({ granted: h.permissions.camera }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: h.permissions.library }),
  launchCameraAsync: (options: unknown) => h.launch.camera(options),
  launchImageLibraryAsync: (options: unknown) => h.launch.library(options),
}));

vi.mock('../src/lib/scanner', () => ({ scanDocument: () => h.scan() }));

vi.mock('expo-image-manipulator', () => ({
  get SaveFormat() {
    return h.formats;
  },
  ImageManipulator: {
    manipulate(uri: string) {
      const record = { uri, ops: [] as unknown[][] };
      h.manipulations.push(record);
      const context = {
        resize(size: unknown) {
          record.ops.push(['resize', size]);
          return context;
        },
        rotate(degrees: number) {
          record.ops.push(['rotate', degrees]);
          return context;
        },
        crop(rect: unknown) {
          record.ops.push(['crop', rect]);
          return context;
        },
        async renderAsync() {
          if (h.renderThrows) throw new Error('decode failed');
          return {
            async saveAsync(options: SaveOptions) {
              const out = `${uri}#${h.saves.length}.${options.format}`;
              h.saves.push({ ...options, uri: out });
              if (options.format === 'webp' && h.webpThrows) throw new Error('no WebP encoder');
              const isPreview = options.compress === 0.5;
              const noBytes =
                (options.format === 'webp' && h.webpNoBase64) ||
                (options.format === 'jpeg' && !isPreview && h.jpegNoBase64);
              const base64 = !options.base64
                ? undefined
                : isPreview
                  ? h.previewBase64
                  : noBytes
                    ? undefined
                    : `${options.format}-bytes`;
              return { uri: out, base64 };
            },
          };
        },
      };
      return context;
    },
  },
}));

type Host = { expo?: { modules?: Record<string, unknown> } };
const host = globalThis as Host;

function picked(asset: Asset | null, canceled = false) {
  return canceled
    ? { canceled: true, assets: null }
    : { canceled: false, assets: asset ? [asset] : [] };
}

const PHOTO: Asset = { uri: 'file:///photo.jpg', width: 4000, height: 3000 };

beforeEach(() => {
  vi.resetModules();
  host.expo = { modules: { ExpoImageManipulator: {} } };
  h.platform.OS = 'ios';
  h.size = { width: 1000, height: 3000 };
  h.formats = { WEBP: 'webp', JPEG: 'jpeg' };
  h.webpThrows = false;
  h.webpNoBase64 = false;
  h.jpegNoBase64 = false;
  h.renderThrows = false;
  h.previewBase64 = 'cHJldmlldw==';
  h.manipulations = [];
  h.saves = [];
  h.fileBase64 = 'b3JpZ2luYWw=';
  h.permissions = { camera: true, library: true };
  h.launch.camera.mockReset().mockResolvedValue(picked(PHOTO));
  h.launch.library.mockReset().mockResolvedValue(picked(PHOTO));
  h.scan.mockReset().mockResolvedValue({ kind: 'unavailable' });
});

const load = () => import('../src/lib/image');

/** Drop the manipulator from the native registry: a dev client built before it. */
function withoutManipulator() {
  host.expo = { modules: {} };
}

describe('a square photo (avatar, cover)', () => {
  it('caps the longer edge of a landscape photo and prefers WebP', async () => {
    const { pickSquarePhoto } = await load();

    const result = await pickSquarePhoto(512);

    expect(result).toEqual({
      base64: 'webp-bytes',
      mimeType: 'image/webp',
      uri: expect.any(String),
    });
    expect(h.manipulations[0]).toEqual({ uri: PHOTO.uri, ops: [['resize', { width: 512 }]] });
    expect(h.saves[0]).toMatchObject({ format: 'webp', compress: 0.7, base64: true });
    expect(h.launch.library).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      base64: false,
    });
  });

  it('caps the height of a portrait photo, and leaves a small one its size', async () => {
    const { pickSquarePhoto } = await load();

    h.launch.library.mockResolvedValue(picked({ uri: 'tall', width: 1000, height: 3000 }));
    await pickSquarePhoto(512);
    h.launch.library.mockResolvedValue(picked({ uri: 'small', width: 300, height: 200 }));
    await pickSquarePhoto(512);

    expect(h.manipulations.map((m) => m.ops)).toEqual([[['resize', { height: 512 }]], []]);
  });

  it('falls back to JPEG where the WebP encoder throws', async () => {
    h.webpThrows = true;
    const { pickSquarePhoto } = await load();

    const result = await pickSquarePhoto(512);

    expect(result).toMatchObject({ base64: 'jpeg-bytes', mimeType: 'image/jpeg' });
    // A rendered context cannot be re-saved, so the JPEG attempt re-renders.
    expect(h.manipulations).toHaveLength(2);
  });

  it('falls back to JPEG when WebP comes back without bytes, or is not offered', async () => {
    h.webpNoBase64 = true;
    let { pickSquarePhoto } = await load();
    await expect(pickSquarePhoto(512)).resolves.toMatchObject({ mimeType: 'image/jpeg' });

    vi.resetModules();
    h.webpNoBase64 = false;
    h.saves = [];
    h.formats = { WEBP: undefined, JPEG: 'jpeg' };
    ({ pickSquarePhoto } = await load());
    await expect(pickSquarePhoto(512)).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    expect(h.saves.every((s) => s.format === 'jpeg')).toBe(true);
  });

  it('says it could not read the image rather than upload nothing', async () => {
    h.formats = { WEBP: undefined, JPEG: 'jpeg' };
    h.jpegNoBase64 = true;
    const { pickSquarePhoto } = await load();

    await expect(pickSquarePhoto(512)).rejects.toThrow('Could not read that image.');
  });

  it('uploads the original, as JPEG, from a build without the manipulator', async () => {
    withoutManipulator();
    const { pickSquarePhoto } = await load();

    await expect(pickSquarePhoto(512)).resolves.toEqual({
      base64: 'b3JpZ2luYWw=',
      mimeType: 'image/jpeg',
      uri: PHOTO.uri,
    });
    expect(h.manipulations).toHaveLength(0);
  });

  it('refuses an original it cannot read', async () => {
    withoutManipulator();
    h.fileBase64 = '';
    const { pickSquarePhoto } = await load();

    await expect(pickSquarePhoto(512)).rejects.toThrow('Could not read that image.');
  });

  it('opens the camera when asked for the camera, and nothing when it is declined', async () => {
    const { pickSquarePhoto } = await load();

    await expect(pickSquarePhoto(512, 'camera')).resolves.not.toBeNull();
    expect(h.launch.camera).toHaveBeenCalledTimes(1);
    expect(h.launch.library).not.toHaveBeenCalled();

    h.permissions.camera = false;
    await expect(pickSquarePhoto(512, 'camera')).resolves.toBeNull();
    expect(h.launch.library).not.toHaveBeenCalled();
  });

  it('treats a declined library, a cancel, or no asset as an ordinary no', async () => {
    const { pickSquarePhoto } = await load();

    h.permissions.library = false;
    await expect(pickSquarePhoto(512)).resolves.toBeNull();
    h.permissions.library = true;
    h.launch.library.mockResolvedValue(picked(null, true));
    await expect(pickSquarePhoto(512)).resolves.toBeNull();
    h.launch.library.mockResolvedValue(picked(null));
    await expect(pickSquarePhoto(512)).resolves.toBeNull();
  });

  it('sizes avatars and covers to their own budgets', async () => {
    const { AVATAR_MAX_EDGE, COVER_MAX_EDGE, pickAvatarPhoto, pickGroupPhoto } = await load();

    await pickAvatarPhoto();
    await pickAvatarPhoto('camera');
    await pickGroupPhoto();

    expect(h.manipulations.map((m) => m.ops[0])).toEqual([
      ['resize', { width: AVATAR_MAX_EDGE }],
      ['resize', { width: AVATAR_MAX_EDGE }],
      ['resize', { width: COVER_MAX_EDGE }],
    ]);
    expect(h.launch.camera).toHaveBeenCalledTimes(1);
  });

  it('on web needs no native registry to resize', async () => {
    h.platform.OS = 'web';
    host.expo = undefined;
    const { pickSquarePhoto } = await load();

    await expect(pickSquarePhoto(512)).resolves.toMatchObject({ mimeType: 'image/webp' });
  });
});

describe('an album photo', () => {
  it('re-encodes (stripping EXIF) at the album budget', async () => {
    const { ALBUM_MAX_EDGE, pickAlbumPhoto } = await load();

    await expect(pickAlbumPhoto()).resolves.toMatchObject({ mimeType: 'image/webp' });
    expect(h.manipulations[0]!.ops).toEqual([['resize', { width: ALBUM_MAX_EDGE }]]);
    expect(h.saves[0]!.compress).toBe(0.8);
  });

  it('adds nothing, rather than leak the original, without the manipulator', async () => {
    withoutManipulator();
    const { pickAlbumPhoto } = await load();

    await expect(pickAlbumPhoto()).resolves.toBeNull();
  });

  it('treats a declined library, a cancel, or no asset as an ordinary no', async () => {
    const { pickAlbumPhoto } = await load();

    h.permissions.library = false;
    await expect(pickAlbumPhoto()).resolves.toBeNull();
    h.permissions.library = true;
    h.launch.library.mockResolvedValue(picked(null, true));
    await expect(pickAlbumPhoto()).resolves.toBeNull();
    h.launch.library.mockResolvedValue(picked(null));
    await expect(pickAlbumPhoto()).resolves.toBeNull();
  });
});

describe('a receipt photo', () => {
  it('comes from the camera at receipt fidelity', async () => {
    const { RECEIPT_MAX_EDGE, pickReceiptPhoto } = await load();

    await expect(pickReceiptPhoto()).resolves.toMatchObject({ mimeType: 'image/webp' });
    expect(h.launch.camera).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 1,
      base64: false,
    });
    expect(h.manipulations[0]!.ops).toEqual([['resize', { width: RECEIPT_MAX_EDGE }]]);
    expect(h.saves[0]!.compress).toBe(0.9);
  });

  it('falls back to the library when the camera is declined, and to nothing if that is too', async () => {
    const { pickReceiptPhoto } = await load();
    h.permissions.camera = false;

    await expect(pickReceiptPhoto()).resolves.not.toBeNull();
    expect(h.launch.library).toHaveBeenCalledTimes(1);
    expect(h.launch.camera).not.toHaveBeenCalled();

    h.permissions.library = false;
    await expect(pickReceiptPhoto()).resolves.toBeNull();
  });

  it('treats a cancel or no asset as no receipt', async () => {
    const { pickReceiptPhoto } = await load();

    h.launch.camera.mockResolvedValue(picked(null, true));
    await expect(pickReceiptPhoto()).resolves.toBeNull();
    h.launch.camera.mockResolvedValue(picked(null));
    await expect(pickReceiptPhoto()).resolves.toBeNull();
  });

  it('keeps the original when there is no manipulator', async () => {
    withoutManipulator();
    const { pickReceiptPhoto } = await load();

    await expect(pickReceiptPhoto()).resolves.toMatchObject({
      base64: 'b3JpZ2luYWw=',
      mimeType: 'image/jpeg',
    });
  });
});

describe('a receipt from the library', () => {
  it('is sized exactly like a camera receipt', async () => {
    const { pickReceiptImage, RECEIPT_MAX_EDGE } = await load();

    await expect(pickReceiptImage()).resolves.toMatchObject({ mimeType: 'image/webp' });
    expect(h.launch.library).toHaveBeenCalledTimes(1);
    expect(h.manipulations[0]!.ops).toEqual([['resize', { width: RECEIPT_MAX_EDGE }]]);
  });

  it('keeps the original without a manipulator', async () => {
    withoutManipulator();
    const { pickReceiptImage } = await load();
    await expect(pickReceiptImage()).resolves.toMatchObject({ base64: 'b3JpZ2luYWw=' });
  });

  it('treats a declined library, a cancel, or no asset as no receipt', async () => {
    const { pickReceiptImage } = await load();

    h.permissions.library = false;
    await expect(pickReceiptImage()).resolves.toBeNull();
    h.permissions.library = true;
    h.launch.library.mockResolvedValue(picked(null, true));
    await expect(pickReceiptImage()).resolves.toBeNull();
    h.launch.library.mockResolvedValue(picked(null));
    await expect(pickReceiptImage()).resolves.toBeNull();
  });
});

describe('capturing a receipt, however the phone can', () => {
  it('uses the plain camera where there is no scanner', async () => {
    const { captureReceipt } = await load();

    await expect(captureReceipt()).resolves.toMatchObject({ mimeType: 'image/webp' });
    expect(h.launch.camera).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the person backs out of the scanner', async () => {
    h.scan.mockResolvedValue({ kind: 'cancelled' });
    const { captureReceipt } = await load();

    await expect(captureReceipt()).resolves.toBeNull();
    expect(h.launch.camera).not.toHaveBeenCalled();
  });

  it('resizes a scanned page by the size read off the file', async () => {
    h.scan.mockResolvedValue({ kind: 'image', uri: 'file:///scan.jpg' });
    h.size = { width: 1500, height: 4000 };
    const { captureReceipt } = await load();

    await expect(captureReceipt()).resolves.toMatchObject({ mimeType: 'image/webp' });
    expect(h.manipulations[0]).toEqual({
      uri: 'file:///scan.jpg',
      ops: [['resize', { height: 2000 }]],
    });
  });

  it('keeps a scan whose size cannot be read, unresized', async () => {
    h.scan.mockResolvedValue({ kind: 'image', uri: 'file:///scan.jpg' });
    h.size = null;
    const { captureReceipt } = await load();

    await expect(captureReceipt()).resolves.toEqual({
      base64: 'b3JpZ2luYWw=',
      mimeType: 'image/jpeg',
      uri: 'file:///scan.jpg',
    });
    expect(h.manipulations).toHaveLength(0);
  });
});

describe('picking a receipt original to show at once', () => {
  it('hands back the library asset untouched', async () => {
    h.launch.library.mockResolvedValue(picked({ ...PHOTO, mimeType: 'image/png' }));
    const { pickReceiptAsset } = await load();

    await expect(pickReceiptAsset()).resolves.toEqual({ ...PHOTO, mimeType: 'image/png' });
    expect(h.manipulations).toHaveLength(0);
  });

  it('treats a declined library, a cancel, or no asset as no receipt', async () => {
    const { pickReceiptAsset } = await load();

    h.permissions.library = false;
    await expect(pickReceiptAsset()).resolves.toBeNull();
    h.permissions.library = true;
    h.launch.library.mockResolvedValue(picked(null, true));
    await expect(pickReceiptAsset()).resolves.toBeNull();
    h.launch.library.mockResolvedValue(picked(null));
    await expect(pickReceiptAsset()).resolves.toBeNull();
  });
});

describe('capturing a receipt original to show at once', () => {
  it('returns the scanned page with the size read off the file', async () => {
    h.scan.mockResolvedValue({ kind: 'image', uri: 'file:///scan.jpg' });
    h.size = { width: 1200, height: 1800 };
    const { captureReceiptAsset } = await load();

    await expect(captureReceiptAsset()).resolves.toEqual({
      uri: 'file:///scan.jpg',
      width: 1200,
      height: 1800,
    });
  });

  it('reports zero dimensions for a scan it cannot measure', async () => {
    h.scan.mockResolvedValue({ kind: 'image', uri: 'file:///scan.jpg' });
    h.size = null;
    const { captureReceiptAsset } = await load();

    await expect(captureReceiptAsset()).resolves.toEqual({
      uri: 'file:///scan.jpg',
      width: 0,
      height: 0,
    });
  });

  it('is a cancel when the scanner is backed out of', async () => {
    h.scan.mockResolvedValue({ kind: 'cancelled' });
    const { captureReceiptAsset } = await load();

    await expect(captureReceiptAsset()).resolves.toBeNull();
    expect(h.launch.camera).not.toHaveBeenCalled();
  });

  it('uses the camera where there is no scanner, then the library, then nothing', async () => {
    const { captureReceiptAsset } = await load();

    await expect(captureReceiptAsset()).resolves.toEqual({
      uri: PHOTO.uri,
      width: PHOTO.width,
      height: PHOTO.height,
      mimeType: undefined,
    });
    expect(h.launch.camera).toHaveBeenCalledTimes(1);

    h.permissions.camera = false;
    await expect(captureReceiptAsset()).resolves.not.toBeNull();
    expect(h.launch.library).toHaveBeenCalledTimes(1);

    h.permissions.library = false;
    await expect(captureReceiptAsset()).resolves.toBeNull();
  });

  it('treats a camera cancel or no asset as no receipt', async () => {
    const { captureReceiptAsset } = await load();

    h.launch.camera.mockResolvedValue(picked(null, true));
    await expect(captureReceiptAsset()).resolves.toBeNull();
    h.launch.camera.mockResolvedValue(picked(null));
    await expect(captureReceiptAsset()).resolves.toBeNull();
  });
});

describe('preparing a picked receipt for the queue', () => {
  it('resizes to a file without building base64, and cuts the preview from the result', async () => {
    const { prepareReceipt } = await load();

    const result = await prepareReceipt(PHOTO);

    expect(h.saves[0]).toMatchObject({ format: 'webp', base64: false, compress: 0.9 });
    expect(result).toEqual({
      uri: h.saves[0]!.uri,
      mimeType: 'image/webp',
      preview: 'data:image/jpeg;base64,cHJldmlldw==',
    });
    // The preview was cut from the resized file, not from the original.
    expect(h.manipulations[1]!.uri).toBe(h.saves[0]!.uri);
  });

  it('falls back to a JPEG file where WebP cannot be encoded', async () => {
    h.webpThrows = true;
    const { prepareReceipt } = await load();

    await expect(prepareReceipt(PHOTO)).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    expect(h.saves[1]).toMatchObject({ format: 'jpeg', base64: false });
  });

  it('keeps an unmeasured original as it came, still asking for a preview', async () => {
    const { prepareReceipt } = await load();

    await expect(
      prepareReceipt({ uri: 'file:///x.png', width: 0, height: 0, mimeType: 'image/png' }),
    ).resolves.toEqual({
      uri: 'file:///x.png',
      mimeType: 'image/png',
      preview: 'data:image/jpeg;base64,cHJldmlldw==',
    });
  });

  it('keeps the original with no preview, guessing JPEG, without a manipulator', async () => {
    withoutManipulator();
    const { prepareReceipt } = await load();

    await expect(prepareReceipt(PHOTO)).resolves.toEqual({
      uri: PHOTO.uri,
      mimeType: 'image/jpeg',
      preview: null,
    });
  });
});

describe('the tiny placeholder preview', () => {
  it('shrinks a landscape image to 32px wide, as a JPEG data URI', async () => {
    const { PREVIEW_MAX_EDGE, previewDataUri } = await load();

    await expect(previewDataUri('file:///a', { width: 400, height: 300 })).resolves.toBe(
      'data:image/jpeg;base64,cHJldmlldw==',
    );
    expect(h.manipulations[0]!.ops).toEqual([['resize', { width: PREVIEW_MAX_EDGE }]]);
    expect(h.saves[0]).toMatchObject({ format: 'jpeg', compress: 0.5, base64: true });
  });

  it('reads the size off the file when none is given, and caps a portrait by height', async () => {
    const { previewDataUri } = await load();

    await previewDataUri('file:///a');
    await previewDataUri('file:///b', { width: 0, height: 10 });

    expect(h.manipulations.map((m) => m.ops)).toEqual([
      [['resize', { height: 32 }]],
      [['resize', { height: 32 }]],
    ]);
  });

  it('has no preview for an unreadable file, a failed encode, or one too long to store', async () => {
    const { previewDataUri } = await load();

    h.size = null;
    await expect(previewDataUri('file:///a')).resolves.toBeNull();

    h.size = { width: 10, height: 10 };
    h.previewBase64 = undefined;
    await expect(previewDataUri('file:///a')).resolves.toBeNull();

    h.previewBase64 = 'x'.repeat(5000);
    await expect(previewDataUri('file:///a')).resolves.toBeNull();

    h.renderThrows = true;
    await expect(previewDataUri('file:///a')).resolves.toBeNull();
  });

  it('has no preview without a manipulator', async () => {
    withoutManipulator();
    const { previewDataUri } = await load();

    await expect(previewDataUri('file:///a', { width: 1, height: 1 })).resolves.toBeNull();
  });
});

describe('rotating and cropping a receipt', () => {
  const CROP = { originX: 10, originY: 20, width: 300, height: 400 };

  it('bakes the rotation then the crop, as WebP with a fresh preview', async () => {
    const { transformReceipt } = await load();

    const result = await transformReceipt('file:///r.jpg', { rotate: 90, crop: CROP });

    expect(h.manipulations[0]!.ops).toEqual([
      ['rotate', 90],
      ['crop', CROP],
    ]);
    expect(result).toEqual({
      base64: 'webp-bytes',
      uri: h.saves[0]!.uri,
      mimeType: 'image/webp',
      preview: 'data:image/jpeg;base64,cHJldmlldw==',
    });
  });

  it('skips the operations it was not given', async () => {
    const { transformReceipt } = await load();

    await transformReceipt('file:///r.jpg', {});
    expect(h.manipulations[0]!.ops).toEqual([]);
  });

  it('falls back to JPEG when WebP throws or comes back empty', async () => {
    const { transformReceipt } = await load();

    h.webpThrows = true;
    await expect(transformReceipt('a', { rotate: 90 })).resolves.toMatchObject({
      base64: 'jpeg-bytes',
      mimeType: 'image/jpeg',
    });

    h.webpThrows = false;
    h.webpNoBase64 = true;
    await expect(transformReceipt('a', { rotate: 90 })).resolves.toMatchObject({
      mimeType: 'image/jpeg',
    });
  });

  it('says it could not read the result when JPEG also comes back empty', async () => {
    h.formats = { WEBP: undefined, JPEG: 'jpeg' };
    h.jpegNoBase64 = true;
    const { transformReceipt } = await load();

    await expect(transformReceipt('a', { rotate: 90 })).rejects.toThrow(
      'Could not read that image.',
    );
  });

  it('has nothing to bake with without a manipulator', async () => {
    withoutManipulator();
    const { transformReceipt } = await load();

    await expect(transformReceipt('a', { rotate: 90 })).resolves.toBeNull();
  });
});

describe('loading the manipulator', () => {
  it('treats a module that throws while loading as absent, and remembers it', async () => {
    vi.doMock('expo-image-manipulator', () => {
      throw new Error("Cannot find native module 'ExpoImageManipulator'");
    });
    try {
      const { previewDataUri, transformReceipt } = await load();
      await expect(previewDataUri('a', { width: 1, height: 1 })).resolves.toBeNull();
      await expect(transformReceipt('a', {})).resolves.toBeNull();
    } finally {
      vi.doUnmock('expo-image-manipulator');
    }
  });
});
