import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  firstRunGateUp,
  overlayBusy,
  resetOverlayBusy,
  setOverlayBusy,
  tourMayStart,
  tourRectVisible,
} from '../src/lib/firstRun';
import { ensurePermission, permissionStep } from '../src/lib/permissionFlow';

const clear = {
  tourReady: true,
  tourSeen: false,
  dataReady: true,
  introVisible: false,
  busy: false,
  promptGranted: true,
  focused: true,
  interactionsDone: true,
};

describe('tourMayStart', () => {
  it('starts when everything is settled', () => {
    expect(tourMayStart(clear)).toBe(true);
  });
  it.each([
    ['tourReady', false],
    ['dataReady', false],
    ['introVisible', true],
    ['busy', true],
    ['promptGranted', false],
    ['focused', false],
    ['interactionsDone', false],
    ['tourSeen', true],
  ])('waits while %s = %s', (key, value) => {
    expect(tourMayStart({ ...clear, [key]: value })).toBe(false);
  });
});

describe('overlay busy set', () => {
  beforeEach(() => resetOverlayBusy());
  it('is busy while any reason is held', () => {
    setOverlayBusy('intro', true);
    setOverlayBusy('dialog', true);
    setOverlayBusy('intro', false);
    expect(overlayBusy()).toBe(true);
    setOverlayBusy('dialog', false);
    expect(overlayBusy()).toBe(false);
  });
});

describe('permissionStep', () => {
  it('maps status to the next step', () => {
    expect(permissionStep({ granted: true, canAskAgain: true })).toBe('proceed');
    expect(permissionStep({ granted: false, canAskAgain: true })).toBe('explain');
    expect(permissionStep({ granted: false, canAskAgain: false })).toBe('settings');
  });
});

describe('ensurePermission', () => {
  beforeEach(() => resetOverlayBusy());

  it('is silent when already granted', async () => {
    const request = vi.fn();
    const explain = vi.fn();
    const r = await ensurePermission('mic', {
      check: async () => ({ granted: true, canAskAgain: true }),
      request,
      explain,
    });
    expect(r.granted).toBe(true);
    expect(explain).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('asks natively only after the explainer resolves with continue', async () => {
    const order: string[] = [];
    const r = await ensurePermission('mic', {
      check: async () => ({ granted: false, canAskAgain: true }),
      explain: async () => {
        order.push('explain');
        return 'continue';
      },
      request: async () => {
        order.push('request');
        expect(overlayBusy()).toBe(true);
        return { granted: true, canAskAgain: true };
      },
    });
    expect(order).toEqual(['explain', 'request']);
    expect(r.granted).toBe(true);
    expect(overlayBusy()).toBe(false);
  });

  it('never requests when the explainer is cancelled', async () => {
    const request = vi.fn();
    const r = await ensurePermission('location', {
      check: async () => ({ granted: false, canAskAgain: true }),
      explain: async () => 'cancel',
      request,
    });
    expect(r.granted).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('offers settings, not the native dialog, when blocked', async () => {
    const request = vi.fn();
    const openSettings = vi.fn();
    const explain = vi.fn(async () => 'settings' as const);
    const r = await ensurePermission('mic', {
      check: async () => ({ granted: false, canAskAgain: false }),
      explain,
      request,
      openSettings,
    });
    expect(explain).toHaveBeenCalledWith('mic', 'settings');
    expect(openSettings).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(r.granted).toBe(false);
  });
});

describe('first-run gate and tour spotlight', () => {
  it('holds the tour while the intro or the setup flow covers Home', () => {
    expect(firstRunGateUp({ showIntro: true, signedIn: true, flow: 'skip' })).toBe(true);
    expect(firstRunGateUp({ showIntro: false, signedIn: true, flow: 'show' })).toBe(true);
    expect(firstRunGateUp({ showIntro: false, signedIn: true, flow: 'skip' })).toBe(false);
    expect(firstRunGateUp({ showIntro: true, signedIn: false, flow: 'wait' })).toBe(false);
  });
  it('ignores a target that is unmeasured or off screen', () => {
    expect(tourRectVisible(undefined, 400, 800)).toBe(false);
    expect(tourRectVisible({ x: 500, y: 10, width: 50, height: 50 }, 400, 800)).toBe(false);
    expect(tourRectVisible({ x: 10, y: 10, width: 0, height: 50 }, 400, 800)).toBe(false);
    expect(tourRectVisible({ x: 10, y: 10, width: 50, height: 50 }, 400, 800)).toBe(true);
  });
});
