/**
 * The app's router seam. Forward navigation to the same place twice inside the
 * window is one navigation; leaving a screen always happens and clears the
 * record; the tab bar is exempt; and the back chevron is gated per call site.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const expo = vi.hoisted(() => ({
  push: vi.fn(),
  navigate: vi.fn(),
  replace: vi.fn(),
  dismissTo: vi.fn(),
  back: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
  canGoBack: vi.fn(() => true),
  setParams: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: {
    push: expo.push,
    navigate: expo.navigate,
    replace: expo.replace,
    dismissTo: expo.dismissTo,
    back: expo.back,
    dismiss: expo.dismiss,
    dismissAll: expo.dismissAll,
    canGoBack: expo.canGoBack,
    setParams: expo.setParams,
  },
  useRouter: expo.useRouter,
}));

type Navigation = typeof import('../src/lib/navigation');
let nav: Navigation;

beforeAll(async () => {
  // The guard captures `Date.now` when the module loads, so the clock is faked
  // first and the window can then be walked past deterministically.
  vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
  nav = await import('../src/lib/navigation');
});

beforeEach(() => {
  vi.clearAllMocks();
  expo.canGoBack.mockReturnValue(true);
  // Leave the previous test's screen, clearing whatever it recorded.
  nav.router.back();
  expo.back.mockClear();
  vi.setSystemTime(Date.now() + 10_000);
});

describe('the guarded router', () => {
  it('drops a second push to the same place inside the window', () => {
    nav.router.push('/group/1');
    nav.router.push('/group/1');
    expect(expo.push).toHaveBeenCalledTimes(1);
    expect(expo.push).toHaveBeenCalledWith('/group/1', undefined);
  });

  it('lets a push to somewhere else through, and the same place once the window has passed', () => {
    nav.router.push('/group/1');
    nav.router.push('/group/2');
    vi.setSystemTime(Date.now() + 5_000);
    nav.router.push('/group/1');
    expect(expo.push.mock.calls.map((c) => c[0])).toEqual(['/group/1', '/group/2', '/group/1']);
  });

  it('guards navigate the same way', () => {
    nav.router.navigate('/settings');
    nav.router.navigate('/settings');
    expect(expo.navigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['replace', () => nav.router.replace('/home'), expo.replace],
    ['dismissTo', () => nav.router.dismissTo('/home'), expo.dismissTo],
    ['back', () => nav.router.back(), expo.back],
    ['dismiss', () => nav.router.dismiss(2), expo.dismiss],
    ['dismissAll', () => nav.router.dismissAll(), expo.dismissAll],
  ] as const)('%s always happens and clears the record', (_name, leave, target) => {
    nav.router.push('/group/1');
    leave();
    leave();
    expect(target).toHaveBeenCalledTimes(2);
    nav.router.push('/group/1');
    expect(expo.push).toHaveBeenCalledTimes(2);
  });

  it('passes through what it does not wrap', () => {
    nav.router.setParams({ a: '1' });
    expect(expo.setParams).toHaveBeenCalledWith({ a: '1' });
  });
});

describe('switchTab', () => {
  it('is never swallowed, however fast the bar is tapped', () => {
    nav.switchTab('/(tabs)/friends');
    nav.switchTab('/(tabs)/friends');
    expect(expo.navigate).toHaveBeenCalledTimes(2);
  });
});

describe('useRouter', () => {
  it('returns the guarded router, not expo-router’s', () => {
    const view = renderHook(() => nav.useRouter());
    expect(view.result.current).toBe(nav.router);
    expect(expo.useRouter).toHaveBeenCalled();
  });
});

describe('useGoBack', () => {
  it('pops once however often the chevron is tapped', () => {
    const view = renderHook(() => nav.useGoBack());
    view.result.current();
    view.result.current();
    expect(expo.back).toHaveBeenCalledTimes(1);
  });

  it('replaces to the fallback on a cold open with nothing to pop', () => {
    expo.canGoBack.mockReturnValue(false);
    const view = renderHook(() => nav.useGoBack('/home'));
    view.result.current();
    expect(expo.replace).toHaveBeenCalledWith('/home', undefined);
    expect(expo.back).not.toHaveBeenCalled();
  });

  it('pops rather than replacing when there is history, fallback or not', () => {
    const view = renderHook(() => nav.useGoBack('/home'));
    view.result.current();
    expect(expo.back).toHaveBeenCalledTimes(1);
    expect(expo.replace).not.toHaveBeenCalled();
  });
});
