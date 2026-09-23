/**
 * Crash reporting wiring. Inert without a DSN; with one, every event and
 * breadcrumb goes through the scrubber, console breadcrumbs never leave, and no
 * PII, screenshot or view hierarchy is attached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  wrap: vi.fn(),
  scrub: vi.fn((value: unknown) => ({ scrubbed: value })),
  commit: 'abc123' as string | null,
}));

vi.mock('@sentry/react-native', () => ({
  init: h.init,
  setUser: h.setUser,
  captureException: h.captureException,
  wrap: h.wrap,
}));
vi.mock('@waves/core', () => ({ scrub: h.scrub }));
vi.mock('../src/lib/buildIdentity', () => ({ buildIdentity: () => ({ commit: h.commit }) }));

async function load(dsn: string, { dev = false, env }: { dev?: boolean; env?: string } = {}) {
  vi.stubEnv('EXPO_PUBLIC_SENTRY_DSN', dsn);
  vi.stubEnv('EXPO_PUBLIC_ENV', env);
  vi.stubGlobal('__DEV__', dev);
  vi.resetModules();
  return import('../src/lib/observability');
}

type Options = {
  environment: string;
  initialScope: { tags: { commit: string } };
  tracesSampleRate: number;
  sendDefaultPii: boolean;
  attachScreenshot: boolean;
  attachViewHierarchy: boolean;
  beforeSend: (event: unknown) => unknown;
  beforeBreadcrumb: (crumb: { category?: string }) => unknown;
};
const options = () => h.init.mock.calls[0]![0] as Options;

beforeEach(() => {
  vi.clearAllMocks();
  h.commit = 'abc123';
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('without a DSN', () => {
  it('reports nothing and never initialises', async () => {
    const obs = await load('');
    expect(obs.reportingEnabled).toBe(false);
    obs.initObservability();
    obs.identifyForReporting('user-1');
    obs.reportHandled(new Error('x'), 'sync');
    expect(h.init).not.toHaveBeenCalled();
    expect(h.setUser).not.toHaveBeenCalled();
    expect(h.captureException).not.toHaveBeenCalled();
  });
});

describe('with a DSN', () => {
  it('initialises for production with no PII, screenshots or hierarchy', async () => {
    const obs = await load('https://key@sentry.example/1');
    obs.initObservability();
    expect(options()).toMatchObject({
      dsn: 'https://key@sentry.example/1',
      environment: 'production',
      initialScope: { tags: { commit: 'abc123' } },
      enableAutoSessionTracking: true,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0.1,
    });
  });

  it('samples every trace in development and tags an unknown commit', async () => {
    h.commit = null;
    const obs = await load('dsn', { dev: true });
    obs.initObservability();
    expect(options()).toMatchObject({
      environment: 'development',
      tracesSampleRate: 1,
      initialScope: { tags: { commit: 'unknown' } },
    });
  });

  it('prefers the explicit environment name', async () => {
    const obs = await load('dsn', { env: 'staging' });
    obs.initObservability();
    expect(options().environment).toBe('staging');
  });

  it('scrubs every event and breadcrumb, and drops console breadcrumbs outright', async () => {
    const obs = await load('dsn');
    obs.initObservability();
    const { beforeSend, beforeBreadcrumb } = options();
    expect(beforeSend({ message: 'x' })).toEqual({ scrubbed: { message: 'x' } });
    expect(beforeBreadcrumb({ category: 'console' })).toBeNull();
    expect(beforeBreadcrumb({ category: 'navigation' })).toEqual({
      scrubbed: { category: 'navigation' },
    });
  });

  it('identifies by opaque id only, and clears on sign-out', async () => {
    const obs = await load('dsn');
    obs.identifyForReporting('user-1');
    expect(h.setUser).toHaveBeenLastCalledWith({ id: 'user-1' });
    obs.identifyForReporting(null);
    expect(h.setUser).toHaveBeenLastCalledWith(null);
  });

  it('reports a handled error tagged with where it happened', async () => {
    const obs = await load('dsn');
    const error = new Error('refused');
    obs.reportHandled(error, 'sync.flush');
    expect(h.captureException).toHaveBeenCalledWith(error, { tags: { where: 'sync.flush' } });
  });

  it('wraps the root with Sentry’s boundary', async () => {
    const obs = await load('dsn');
    expect(obs.withObservability).toBe(h.wrap);
  });
});
