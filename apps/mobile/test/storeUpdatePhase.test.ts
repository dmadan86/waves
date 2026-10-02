import { describe, expect, it } from 'vitest';

import {
  isPutOff,
  newerStoreVersion,
  NO_UPDATE,
  phaseAfter,
  phaseFromCheck,
  progressOf,
  type PlayUpdateInfo,
} from '@/lib/storeUpdatePhase';

const INFO: PlayUpdateInfo = {
  available: true,
  inProgress: false,
  versionCode: 9,
  flexible: true,
  immediate: true,
  status: 'UNKNOWN',
  downloaded: 0,
  total: 0,
};

describe('a fresh check', () => {
  it('offers an update Play says is there', () => {
    expect(phaseFromCheck(INFO)).toEqual({ kind: 'available', version: '9' });
  });

  it('says nothing when Play has nothing, or could not be asked', () => {
    expect(phaseFromCheck({ ...INFO, available: false })).toEqual(NO_UPDATE);
    expect(phaseFromCheck(null)).toEqual(NO_UPDATE);
  });

  it('only offers what can download in the background', () => {
    expect(phaseFromCheck({ ...INFO, flexible: false })).toEqual(NO_UPDATE);
  });

  it('picks a download up where it is', () => {
    expect(phaseFromCheck({ ...INFO, status: 'DOWNLOADING', downloaded: 25, total: 100 })).toEqual({
      kind: 'downloading',
      version: '9',
      progress: 0.25,
    });
  });

  it('remembers a download that finished while the app was away', () => {
    expect(phaseFromCheck({ ...INFO, status: 'DOWNLOADED' })).toEqual({
      kind: 'ready',
      version: '9',
    });
  });
});

describe('what Play reports next', () => {
  const offer = { kind: 'available', version: '9' } as const;

  it('starts showing a download once the sheet is accepted', () => {
    expect(phaseAfter(offer, { status: 'ACCEPTED' })).toEqual({
      kind: 'downloading',
      version: '9',
      progress: null,
    });
  });

  it('follows the bytes', () => {
    const downloading = phaseAfter(offer, { status: 'DOWNLOADING', downloaded: 3, total: 4 });
    expect(downloading).toEqual({ kind: 'downloading', version: '9', progress: 0.75 });
  });

  it('waits for the person to restart once downloaded', () => {
    expect(phaseAfter(offer, { status: 'DOWNLOADED' })).toEqual({ kind: 'ready', version: '9' });
  });

  it('goes back to the offer after a no, a cancel or a failure', () => {
    for (const status of ['DECLINED', 'CANCELED', 'FAILED']) {
      expect(phaseAfter({ kind: 'downloading', version: '9', progress: 0.5 }, { status })).toEqual(
        offer,
      );
    }
  });

  it('gets out of the way while Play installs', () => {
    expect(phaseAfter({ kind: 'ready', version: '9' }, { status: 'INSTALLING' })).toEqual(
      NO_UPDATE,
    );
  });

  it('ignores events when there was never an update', () => {
    expect(phaseAfter(NO_UPDATE, { status: 'DOWNLOADED' })).toEqual(NO_UPDATE);
  });
});

describe('progress', () => {
  it('is unknown until Play says how big the download is', () => {
    expect(progressOf(10, 0)).toBeNull();
    expect(progressOf(undefined, 100)).toBeNull();
  });

  it('stays between nothing and all of it', () => {
    expect(progressOf(150, 100)).toBe(1);
    expect(progressOf(-5, 100)).toBe(0);
  });
});

describe('the App Store check on iOS', () => {
  const lookup = (version: unknown) => ({ resultCount: 1, results: [{ version }] });

  it('offers a newer store version', () => {
    expect(newerStoreVersion('1.1.0', lookup('1.2.0'))).toBe('1.2.0');
  });

  it('stays quiet for the same or an older version', () => {
    expect(newerStoreVersion('1.2.0', lookup('1.2'))).toBeNull();
    expect(newerStoreVersion('1.3.0', lookup('1.2.0'))).toBeNull();
  });

  it('stays quiet for an answer it cannot read', () => {
    expect(newerStoreVersion('1.1.0', { resultCount: 0, results: [] })).toBeNull();
    expect(newerStoreVersion('1.1.0', lookup(42))).toBeNull();
    expect(newerStoreVersion('1.1.0', null)).toBeNull();
    expect(newerStoreVersion(null, lookup('9.0.0'))).toBeNull();
  });
});

describe('"Not now"', () => {
  it('holds for the version it was said about', () => {
    expect(isPutOff({ kind: 'available', version: '9' }, '9')).toBe(true);
  });

  it('does not hold for a newer version', () => {
    expect(isPutOff({ kind: 'available', version: '10' }, '9')).toBe(false);
  });

  it('never hides a download or a finished one', () => {
    expect(isPutOff({ kind: 'downloading', version: '9', progress: 0.5 }, '9')).toBe(false);
    expect(isPutOff({ kind: 'ready', version: '9' }, '9')).toBe(false);
  });
});
