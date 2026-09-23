/**
 * The Supabase client, as each kind of build constructs it.
 *
 * Three things here are silent when wrong: a build missing its keys must load
 * (and say so) instead of crashing above every error boundary; the session must
 * go to the keystore adapter and use PKCE; and tokens must only refresh while
 * the app is in front of somebody.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({
  os: 'android',
  created: [] as { url: string; key: string; options: { auth: Record<string, unknown> } }[],
  appState: [] as ((state: string) => void)[],
  started: 0,
  stopped: 0,
}));

vi.mock('react-native-url-polyfill/auto', () => ({}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return world.os;
    },
  },
  AppState: {
    addEventListener: (_: string, fn: (state: string) => void) => {
      world.appState.push(fn);
      return { remove: () => {} };
    },
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: { auth: Record<string, unknown> }) => {
    world.created.push({ url, key, options });
    return {
      auth: {
        startAutoRefresh: async () => {
          world.started += 1;
        },
        stopAutoRefresh: async () => {
          world.stopped += 1;
        },
      },
    };
  },
}));
vi.mock('@/lib/secureStorage', () => ({ secureAuthStorage: { name: 'keystore-adapter' } }));

async function load() {
  vi.resetModules();
  return import('../src/lib/supabase');
}

beforeEach(() => {
  world.os = 'android';
  world.created = [];
  world.appState = [];
  world.started = 0;
  world.stopped = 0;
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a build missing its keys', () => {
  it('still loads, says so, and never wires the placeholder to anything', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubGlobal('window', {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await load();

    expect(mod.supabaseConfigured).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('misconfigured'));
    // Empty strings are not undefined, so what reaches createClient is what the
    // build shipped — the flag, not the client, is what keeps it unused.
    expect(world.created).toHaveLength(1);
    expect(world.appState).toHaveLength(0);
  });

  it('gets a well-formed placeholder when the variables are absent altogether', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await load();

    expect(world.created[0]).toMatchObject({
      url: 'https://placeholder.supabase.co',
      key: 'placeholder-anon-key',
    });
  });
});

describe('a phone build', () => {
  it('keeps the session in the keystore adapter and asks for PKCE', async () => {
    vi.stubGlobal('window', {});
    const mod = await load();

    expect(mod.supabaseConfigured).toBe(true);
    expect(world.created[0]).toMatchObject({
      url: 'https://project.supabase.co',
      key: 'anon-key',
      options: {
        auth: {
          storage: { name: 'keystore-adapter' },
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
      },
    });
  });

  it('refreshes tokens only while the app is in the foreground', async () => {
    vi.stubGlobal('window', {});
    await load();
    expect(world.appState).toHaveLength(1);

    world.appState[0]!('active');
    world.appState[0]!('background');
    world.appState[0]!('inactive');
    await Promise.resolve();

    expect(world.started).toBe(1);
    expect(world.stopped).toBe(2);
  });
});

describe('the web', () => {
  it('reads a session handed over in the URL', async () => {
    vi.stubGlobal('window', {});
    world.os = 'web';
    await load();
    expect(world.created[0]!.options.auth.detectSessionInUrl).toBe(true);
  });

  it('constructs for the server pre-render without touching storage or the app state', async () => {
    // No `window` — node, where Expo Router pre-renders web routes.
    await load();
    expect(world.created[0]!.options.auth).toMatchObject({
      storage: undefined,
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    });
    expect(world.appState).toHaveLength(0);
  });
});
