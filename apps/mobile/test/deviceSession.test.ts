/**
 * The device cap as a running app sees it: register on sign-in, heartbeat on a
 * foreground, and a soft gate when a free account is over its limit.
 *
 * Driven through the synchronous fake React in `support/fakeReact`. The gate is
 * a child component, so it is found in the provider's tree and mounted on its
 * own to press its buttons.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findAll, firstProvider, flush, renderHook, textOf } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const world = vi.hoisted(() => ({
  auth: { session: null as unknown, isGuest: false },
  appState: null as ((state: string) => void) | null,
  appStateRemoved: 0,
  register: vi.fn(),
  signOutOthersTable: vi.fn(),
  signOut: vi.fn(),
  identity: vi.fn(),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  View: 'View',
  AppState: {
    addEventListener: (_: string, fn: (state: string) => void) => {
      world.appState = fn;
      return {
        remove: () => {
          world.appStateRemoved += 1;
        },
      };
    },
  },
}));
vi.mock('@waves/ui', () => ({
  Button: 'Button',
  Popup: 'Popup',
  Text: 'Text',
  iconSize: { xxxl: 48 },
  useTheme: () => ({
    spacing: { lg: 16, sm: 8, md: 12, xs: 4 },
    radius: { pill: 999 },
    color: { brandSoft: '#eef', brand: '#00f', surfaceMuted: '#eee', onButtonPrimary: '#fff' },
  }),
}));
vi.mock('@/i18n', () => ({
  fill: (template: string, values: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k])),
  useStrings: () => ({
    t: {
      devices: {
        gateDismiss: 'Not now',
        gateTitle: 'Too many phones',
        gateBody: 'Sign the others out',
        gateCount: '{active} devices · {limit} allowed',
        gateAction: 'Sign out other devices',
      },
    },
  }),
}));
vi.mock('@/data/api', () => ({
  registerDevice: (...args: unknown[]) => world.register(...args),
  signOutOtherDevices: (...args: unknown[]) => world.signOutOthersTable(...args),
}));
vi.mock('@/lib/device', () => ({ deviceIdentity: () => world.identity() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => world.auth }));
vi.mock('@/lib/backend', () => ({
  backend: { auth: { signOut: (...args: unknown[]) => world.signOut(...args) } },
}));

const { DeviceSessionProvider, useDeviceSession } = await import('../src/lib/deviceSession');

type Value = ReturnType<typeof useDeviceSession>;

const OVER = { overLimit: true, activeCount: 3, limit: 2 };
const UNDER = { overLimit: false, activeCount: 1, limit: 2 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T10:00:00Z'));
  world.auth = { session: { user: { id: 'u1' } }, isGuest: false };
  world.appState = null;
  world.appStateRemoved = 0;
  world.register = vi.fn(async () => UNDER);
  world.signOutOthersTable = vi.fn(async () => 2);
  world.signOut = vi.fn(async () => ({ error: null }));
  world.identity = vi.fn(async () => ({ deviceId: 'dev-1', label: 'Pixel' }));
});

afterEach(() => {
  vi.useRealTimers();
});

async function mount() {
  const view = renderHook(() => DeviceSessionProvider({ children: 'app' }));
  await flush();
  return {
    view,
    get value() {
      return firstProvider(view.result.current)!.value as Value;
    },
    get gate() {
      return findAll(view.result.current, (n) => typeof n.type === 'function')[0];
    },
  };
}

describe('registering this phone', () => {
  it('registers on sign-in and reports where the account stands', async () => {
    const app = await mount();
    expect(world.register).toHaveBeenCalledWith({ deviceId: 'dev-1', label: 'Pixel' });
    expect(app.value.status).toEqual(UNDER);
    expect(app.gate).toBeUndefined();
  });

  it('skips guests and signed-out phones entirely', async () => {
    world.auth = { session: { user: { id: 'g1' } }, isGuest: true };
    const guest = await mount();
    expect(world.register).not.toHaveBeenCalled();
    await guest.value.refresh();
    expect(world.register).not.toHaveBeenCalled();
    expect(guest.value.status).toBeNull();

    world.auth = { session: null, isGuest: false };
    await mount();
    expect(world.register).not.toHaveBeenCalled();
  });

  it('never keeps somebody out when registration fails', async () => {
    world.register.mockRejectedValue(new Error('offline'));
    const app = await mount();
    expect(app.value.status).toBeNull();
    await expect(app.value.refresh()).resolves.toBeUndefined();
  });

  it('drops a registration that lands after unmount', async () => {
    const view = renderHook(() => DeviceSessionProvider({ children: null }));
    view.unmount();
    await flush();
    expect((firstProvider(view.result.current)!.value as Value).status).toBeNull();
    expect(world.appStateRemoved).toBe(1);
  });

  it('forgets the previous account’s answer when the account changes', async () => {
    world.register.mockResolvedValueOnce(OVER);
    const app = await mount();
    expect(app.value.status).toEqual(OVER);

    world.auth = { session: { user: { id: 'u2' } }, isGuest: false };
    world.register.mockImplementationOnce(() => new Promise(() => {}));
    app.view.rerender();
    expect(app.value.status).toBeNull();
    expect(app.gate).toBeUndefined();
  });
});

describe('the heartbeat', () => {
  it('re-registers on a foreground only once the last one is an hour old', async () => {
    await mount();
    expect(world.register).toHaveBeenCalledTimes(1);

    world.appState!('active');
    await flush();
    expect(world.register).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-01T11:00:01Z'));
    world.appState!('background');
    await flush();
    expect(world.register).toHaveBeenCalledTimes(1);

    world.appState!('active');
    await flush();
    expect(world.register).toHaveBeenCalledTimes(2);
  });
});

describe('the gate', () => {
  it('shows a free account over its limit the count, and can be dismissed', async () => {
    world.register.mockResolvedValue(OVER);
    const app = await mount();
    const gate = app.gate!;
    expect(gate.props.status).toEqual(OVER);

    const rendered = renderHook(() => (gate.type as (p: unknown) => unknown)(gate.props));
    expect(textOf(rendered.result.current)).toContain('3 devices · 2 allowed');

    const [notNow] = findAll(rendered.result.current, (n) => n.props.label === 'Not now');
    (notNow!.props.onPress as () => void)();
    expect(app.gate).toBeUndefined();
  });

  it('states no count it does not have', async () => {
    world.register.mockResolvedValue(OVER);
    const app = await mount();
    const gate = app.gate!;
    const rendered = renderHook(() =>
      (gate.type as (p: unknown) => unknown)({ ...gate.props, status: null }),
    );
    expect(textOf(rendered.result.current)).not.toContain('allowed');
  });

  it('signs the other phones out, shows a spinner meanwhile, and stays up if that fails', async () => {
    world.register.mockResolvedValue(OVER);
    const app = await mount();
    const gate = app.gate!;
    let finish: (value: number) => void = () => {};
    const onSignOutOthers = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const rendered = renderHook(() =>
      (gate.type as (p: unknown) => unknown)({ ...gate.props, onSignOutOthers }),
    );
    const action = () =>
      findAll(rendered.result.current, (n) => n.props.label === 'Sign out other devices')[0]!;

    const pressed = (action().props.onPress as () => Promise<void>)();
    expect(action().props.disabled).toBe(true);
    expect(action().props.icon).toBeTruthy();
    finish(1);
    await pressed;
    expect(action().props.disabled).toBe(false);
    expect(action().props.icon).toBeUndefined();

    onSignOutOthers.mockRejectedValueOnce(new Error('offline'));
    await expect((action().props.onPress as () => Promise<void>)()).resolves.toBeUndefined();
    expect(action().props.disabled).toBe(false);
  });
});

describe('signing the other phones out', () => {
  it('revokes the sessions, dismisses the gate, then reconciles the list', async () => {
    world.register.mockResolvedValue(OVER);
    const app = await mount();

    await expect(app.value.signOutOthers()).resolves.toBe(2);
    await flush();

    expect(world.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(world.signOutOthersTable).toHaveBeenCalledWith('dev-1');
    expect(app.gate).toBeUndefined();
  });

  it('reports an unconfirmed count, not a false zero, when only the list update fails', async () => {
    world.register.mockResolvedValue(OVER);
    world.signOutOthersTable.mockRejectedValueOnce(new Error('flaky'));
    const app = await mount();

    await expect(app.value.signOutOthers()).resolves.toBeNull();
    await flush();
    expect(app.gate).toBeUndefined();
  });

  it('keeps the gate and rejects when the revocation itself failed', async () => {
    world.register.mockResolvedValue(OVER);
    world.signOut.mockResolvedValueOnce({ error: new Error('revoke failed') });
    const app = await mount();
    const before = world.register.mock.calls.length;

    await expect(app.value.signOutOthers()).rejects.toThrow('revoke failed');
    await flush();

    expect(world.signOutOthersTable).not.toHaveBeenCalled();
    expect(world.register.mock.calls.length).toBe(before + 1);
    expect(app.gate).toBeDefined();
  });
});

describe('reading it from a screen', () => {
  it('refuses to run outside the provider', () => {
    expect(() => renderHook(() => useDeviceSession())).toThrow(/inside DeviceSessionProvider/);
  });

  it('hands consumers the provided value', async () => {
    const app = await mount();
    const { ctx, value } = firstProvider(app.view.result.current)!;
    expect(renderHook(() => useDeviceSession(), { contexts: [[ctx, value]] }).result.current).toBe(
      value,
    );
  });
});
