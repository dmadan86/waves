/**
 * Registering for push. The contract worth pinning: nothing throws, a failure
 * comes back as a reason that says whose problem it is, permission is only
 * asked for by `enablePush`, and signing out revokes rather than deletes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  os: 'android' as string,
  isDevice: true,
  extra: { eas: { projectId: 'proj-1' } } as unknown,
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  getSession: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
  secureGet: vi.fn(),
  secureSet: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: h.secureGet,
  setItemAsync: h.secureSet,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-3333-4444-555555555555' }));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: h.extra };
    },
  },
}));
vi.mock('expo-device', () => ({
  get isDevice() {
    return h.isDevice;
  },
  modelName: 'Pixel 9',
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: h.getPermissionsAsync,
  requestPermissionsAsync: h.requestPermissionsAsync,
  setNotificationChannelAsync: h.setNotificationChannelAsync,
  getExpoPushTokenAsync: h.getExpoPushTokenAsync,
}));
vi.mock('../src/lib/backend', () => ({
  backend: { auth: { getSession: h.getSession }, from: h.from, rpc: h.rpc },
}));

type Push = typeof import('../src/lib/push');

async function load(os = 'android'): Promise<Push> {
  h.os = os;
  vi.resetModules();
  return import('../src/lib/push');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.isDevice = true;
  h.extra = { eas: { projectId: 'proj-1' } };
  h.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  h.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  h.setNotificationChannelAsync.mockResolvedValue(undefined);
  h.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  h.getSession.mockResolvedValue({ data: { session: { user: { id: 'profile-1' } } } });
  h.upsert.mockResolvedValue({ error: null });
  h.rpc.mockResolvedValue({ error: null });
  h.secureGet.mockResolvedValue(null);
  h.secureSet.mockResolvedValue(undefined);
  h.eq.mockResolvedValue({ error: null });
  h.update.mockReturnValue({ eq: h.eq });
  h.from.mockReturnValue({ upsert: h.upsert, update: h.update });
});

describe('where push exists at all', () => {
  it('is only on the two phone platforms', async () => {
    expect((await load('android')).pushSupported).toBe(true);
    expect((await load('ios')).pushSupported).toBe(true);
    expect((await load('web')).pushSupported).toBe(false);
  });

  it('reports every web call as unsupported without touching the native module', async () => {
    const push = await load('web');
    await expect(push.pushPermission()).resolves.toBe(push.PushPermission.Denied);
    await expect(push.localNotificationsAllowed()).resolves.toBe(false);
    await expect(push.ensureLocalNotificationPermission()).resolves.toBe(false);
    await expect(push.enablePush()).resolves.toEqual({ ok: false, why: 'unsupported' });
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: false, why: 'unsupported' });
    await expect(push.revokePushToken()).resolves.toBeUndefined();
    expect(h.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('the Android channel', () => {
  it('is created on Android and skipped on iOS', async () => {
    await (await load('android')).ensureAndroidChannel();
    expect(h.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ name: 'Waves', importance: 3 }),
    );
    h.setNotificationChannelAsync.mockClear();
    await (await load('ios')).ensureAndroidChannel();
    expect(h.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});

describe('pushPermission', () => {
  it('maps the OS status to the three answers', async () => {
    const push = await load();
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    await expect(push.pushPermission()).resolves.toBe('granted');
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    await expect(push.pushPermission()).resolves.toBe('undetermined');
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(push.pushPermission()).resolves.toBe('denied');
  });

  it('says denied on a simulator, which has no token to give', async () => {
    const push = await load();
    h.isDevice = false;
    await expect(push.pushPermission()).resolves.toBe('denied');
    expect(h.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('local notifications', () => {
  it('are allowed on a simulator when the OS says granted, and never ask', async () => {
    const push = await load();
    h.isDevice = false;
    await expect(push.localNotificationsAllowed()).resolves.toBe(true);
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(push.localNotificationsAllowed()).resolves.toBe(false);
    h.getPermissionsAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(push.localNotificationsAllowed()).resolves.toBe(false);
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks only when not yet granted, and makes the channel once allowed', async () => {
    const push = await load();
    await expect(push.ensureLocalNotificationPermission()).resolves.toBe(true);
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(h.setNotificationChannelAsync).toHaveBeenCalledTimes(1);

    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    h.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(push.ensureLocalNotificationPermission()).resolves.toBe(false);
    expect(h.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(h.setNotificationChannelAsync).toHaveBeenCalledTimes(1);

    h.getPermissionsAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(push.ensureLocalNotificationPermission()).resolves.toBe(false);
  });
});

describe('enablePush', () => {
  it('is unsupported on a simulator', async () => {
    const push = await load();
    h.isDevice = false;
    await expect(push.enablePush()).resolves.toEqual({ ok: false, why: 'unsupported' });
  });

  it('comes back denied when the person says no', async () => {
    const push = await load();
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    h.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    await expect(push.enablePush()).resolves.toEqual({ ok: false, why: 'denied' });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('asks, then registers the token for whoever is signed in', async () => {
    const push = await load();
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    await expect(push.enablePush()).resolves.toEqual({ ok: true });
    expect(h.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(h.setNotificationChannelAsync).toHaveBeenCalled();
    // Through the RPC that moves the token to the signed-in profile — never a
    // direct upsert, which RLS refused once another account owned the device's
    // token.
    // With this install's secret: minted once, kept in the keystore, and the
    // proof the server needs before a token can move to another account.
    const secret = '1111111122223333444455555555555511111111222233334444555555555555';
    expect(h.rpc).toHaveBeenCalledWith('waves_register_push_token', {
      p_token: 'ExponentPushToken[abc]',
      p_platform: 'android',
      p_device_name: 'Pixel 9',
      p_install_secret: secret,
    });
    expect(h.secureSet).toHaveBeenCalledWith('waves.push.installSecret', secret);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

describe('refreshPushToken', () => {
  it('does nothing without permission — it never asks', async () => {
    const push = await load();
    h.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' });
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: false, why: 'denied' });
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('blames the build, not the person, when there is no EAS project id', async () => {
    const push = await load();
    h.extra = undefined;
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: false, why: 'not_configured' });
  });

  it('needs somebody signed in to hang the token on', async () => {
    const push = await load();
    h.getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: false, why: 'not_signed_in' });
  });

  it('turns a token request that rejects into not_configured instead of throwing', async () => {
    const push = await load();
    h.getExpoPushTokenAsync.mockRejectedValueOnce(
      new Error('Default FirebaseApp is not initialized'),
    );
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: false, why: 'not_configured' });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('reports a failed save, and labels an iPhone as ios', async () => {
    const push = await load('ios');
    h.rpc.mockResolvedValueOnce({ error: { message: 'NOT_SIGNED_IN' } });
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: false, why: 'save_failed' });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_platform: 'ios' });
  });
});

describe('revokePushToken', () => {
  it('stamps the row revoked rather than deleting it', async () => {
    const push = await load();
    await push.revokePushToken();
    expect(h.update).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
    expect(h.eq).toHaveBeenCalledWith('expo_push_token', 'ExponentPushToken[abc]');
  });

  it('never stops a sign-out: no project id, a simulator, or a failure are all quiet', async () => {
    const push = await load();
    h.extra = {};
    await expect(push.revokePushToken()).resolves.toBeUndefined();
    h.extra = { eas: { projectId: 'p' } };
    h.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('offline'));
    await expect(push.revokePushToken()).resolves.toBeUndefined();
    h.isDevice = false;
    await expect(push.revokePushToken()).resolves.toBeUndefined();
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('routeForNotification', () => {
  const response = (data: unknown) =>
    ({ notification: { request: { content: { data } } } }) as never;

  it('turns the waves:// link into an in-app path', async () => {
    const push = await load();
    expect(push.routeForNotification(response({ url: 'waves://group/g1' }))).toBe('/group/g1');
    expect(push.routeForNotification(response({ url: '/settle/x' }))).toBe('/settle/x');
  });

  it('goes nowhere without a string url', async () => {
    const push = await load();
    expect(push.routeForNotification(response(undefined))).toBeNull();
    expect(push.routeForNotification(response({ url: 42 }))).toBeNull();
    expect(push.routeForNotification(response({ url: '' }))).toBeNull();
  });
});

describe('the install secret', () => {
  it('is minted once and reused, never re-minted per sign-in', async () => {
    const push = await load('ios');
    h.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    h.secureGet.mockResolvedValue('kept-from-the-first-launch-0123456789abcdef');
    await push.refreshPushToken();
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({
      p_install_secret: 'kept-from-the-first-launch-0123456789abcdef',
    });
    expect(h.secureSet).not.toHaveBeenCalled();
  });

  it('is sent as null when the keystore will not answer, rather than failing', async () => {
    const push = await load('ios');
    h.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    h.secureGet.mockRejectedValue(new Error('keystore locked'));
    await expect(push.refreshPushToken()).resolves.toEqual({ ok: true });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_install_secret: null });
  });
});
