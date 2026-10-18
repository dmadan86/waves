import { describe, expect, it } from 'vitest';

import {
  createShareDedupe,
  isAcceptableShareUri,
  parseIncomingShare,
} from '../modules/waves-share/incoming';
import { isShareLaunchUrl, shareDecodeMode, shareRoute } from '../src/lib/sharedReceipt';

describe('parseIncomingShare', () => {
  const good = {
    id: 'a1',
    uri: 'file:///data/cache/incoming-share/a1.jpg',
    mimeType: 'image/JPEG',
  };

  it('accepts a cached image and lower-cases the type', () => {
    expect(parseIncomingShare(good)).toEqual({ ...good, mimeType: 'image/jpeg' });
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no id', { ...good, id: '' }],
    ['a content uri', { ...good, uri: 'content://media/1' }],
    ['text', { ...good, mimeType: 'text/plain' }],
    ['a pdf', { ...good, mimeType: 'application/pdf' }],
    ['a missing type', { id: 'a', uri: good.uri }],
  ])('rejects %s', (_name, raw) => {
    expect(parseIncomingShare(raw)).toBeNull();
  });
});

describe('createShareDedupe', () => {
  it('accepts a delivery once', () => {
    const d = createShareDedupe();
    expect(d.accept('a')).toBe(true);
    expect(d.accept('a')).toBe(false);
    expect(d.accept('b')).toBe(true);
  });

  it('forgets the oldest beyond its cap', () => {
    const d = createShareDedupe(2);
    d.accept('a');
    d.accept('b');
    d.accept('c');
    expect(d.accept('a')).toBe(true);
    expect(d.accept('c')).toBe(false);
  });
});

describe('shareDecodeMode', () => {
  const base = { tierLoading: false, isPro: true, capStatus: 'allowed' as const };

  it('reads the photo for Pro', () => {
    expect(shareDecodeMode(base)).toBe('decode');
  });

  it('attaches only for Free', () => {
    expect(shareDecodeMode({ ...base, isPro: false })).toBe('attach');
  });

  it('waits for the tier, then for the cap, before deciding', () => {
    expect(shareDecodeMode({ ...base, tierLoading: true })).toBe('wait');
    expect(shareDecodeMode({ ...base, capStatus: 'loading' })).toBe('wait');
  });

  it('does not wait on the cap for Free', () => {
    expect(shareDecodeMode({ ...base, isPro: false, capStatus: 'loading' })).toBe('attach');
  });

  it('respects a locked receipt cap', () => {
    expect(shareDecodeMode({ ...base, capStatus: 'locked' })).toBe('attach');
  });
});

describe('shareRoute', () => {
  const groupIds = new Set(['g1', 'g2']);

  it('opens add-expense in the last used group that still exists', () => {
    expect(
      shareRoute({ receiptKey: 'rk1', recents: ['group:gone', 'group:g2', 'group:g1'], groupIds }),
    ).toBe('/group/g2/add-expense?receipt=rk1&shared=1');
  });

  it('falls to the quick-add draft form with no usable group', () => {
    expect(shareRoute({ receiptKey: 'rk1', recents: [], groupIds })).toBe(
      '/capture?receipt=rk1&shared=1',
    );
    expect(shareRoute({ receiptKey: 'rk1', recents: ['group:gone'], groupIds })).toBe(
      '/capture?receipt=rk1&shared=1',
    );
  });

  it('does not skip past a private-ledger destination', () => {
    expect(shareRoute({ receiptKey: 'rk1', recents: ['personal', 'group:g1'], groupIds })).toBe(
      '/capture?receipt=rk1&shared=1',
    );
  });
});

describe('isShareLaunchUrl', () => {
  it('recognises the links a share launches the app with', () => {
    expect(isShareLaunchUrl('content://media/external/images/1')).toBe(true);
    expect(isShareLaunchUrl('file:///x.jpg')).toBe(true);
    expect(isShareLaunchUrl('waves://share-receipt')).toBe(true);
    expect(isShareLaunchUrl('waves://share-receipt?x=1')).toBe(true);
  });

  it('leaves real routes alone', () => {
    expect(isShareLaunchUrl('waves:///capture')).toBe(false);
    expect(isShareLaunchUrl('/group/1')).toBe(false);
  });
});

describe('isAcceptableShareUri', () => {
  const pkg = 'app.waves.mobile';
  const photos = 'com.google.android.apps.photos';

  it('accepts another app content provider', () => {
    expect(isAcceptableShareUri('content', `${photos}.contentprovider`, pkg, photos)).toBe(true);
    expect(isAcceptableShareUri('content', 'media', pkg, 'com.android.providers.media')).toBe(true);
  });

  it('rejects file and other schemes', () => {
    expect(isAcceptableShareUri('file', '', pkg, photos)).toBe(false);
    expect(isAcceptableShareUri('http', 'example.com', pkg, photos)).toBe(false);
    expect(isAcceptableShareUri(null, 'media', pkg, photos)).toBe(false);
  });

  it('rejects our own providers by prefix or by resolved package', () => {
    expect(isAcceptableShareUri('content', `${pkg}.wavesshare.fileprovider`, pkg, pkg)).toBe(false);
    expect(isAcceptableShareUri('content', 'androidx-startup', pkg, pkg)).toBe(false);
  });

  it('rejects userinfo tricks, unresolved providers and a missing authority', () => {
    expect(isAcceptableShareUri('content', `x@${pkg}.provider`, pkg, photos)).toBe(false);
    expect(isAcceptableShareUri('content', 'media', pkg, null)).toBe(false);
    expect(isAcceptableShareUri('content', '', pkg, photos)).toBe(false);
    expect(isAcceptableShareUri('content', null, pkg, photos)).toBe(false);
  });
});
