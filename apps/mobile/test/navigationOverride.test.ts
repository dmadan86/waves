/** The guarded router's back override: what makes a header chevron follow the bar's Back. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
}));
vi.mock('expo-router', () => ({ router: expo, useRouter: vi.fn() }));

let nav: typeof import('../src/lib/navigation');
beforeAll(async () => {
  nav = await import('../src/lib/navigation');
});
afterEach(() => {
  nav.setBackOverride(null);
  vi.clearAllMocks();
});

describe('router.back with a back override', () => {
  it('runs the override instead of popping', () => {
    const override = vi.fn();
    nav.setBackOverride(override);
    nav.router.back();
    expect(override).toHaveBeenCalledOnce();
    expect(expo.back).not.toHaveBeenCalled();
  });
  it('pops normally once the override is cleared', () => {
    nav.setBackOverride(vi.fn());
    nav.setBackOverride(null);
    nav.router.back();
    expect(expo.back).toHaveBeenCalledOnce();
  });
});
