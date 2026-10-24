import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginBackground,
  finishBackground,
  backupSnapshot,
  recoverBackground,
} from '@/lib/backup/background';
const h = vi.hoisted(() => ({
  request: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  update: vi.fn(),
  events: new Map<string, () => void>(),
}));
vi.mock('@/lib/backup/native', () => ({
  native: {
    start: h.start,
    stop: h.stop,
    update: h.update,
    addListener: (event: string, callback: () => void) => {
      h.events.set(event, callback);
      return { remove: () => h.events.delete(event) };
    },
  },
  requestBackupNotification: h.request,
  notificationLabels: () => ({}),
}));

beforeEach(async () => {
  await finishBackground('owner', 'complete');
  await AsyncStorage.clear();
  vi.clearAllMocks();
  h.events.clear();
});
describe('background lifecycle', () => {
  it('requests permission once per install and continues when notifications are denied', async () => {
    // The native permission helper resolves on denial as well as grant.
    const dispose = await beginBackground('owner', () => undefined, true);
    expect(h.start).toHaveBeenCalledOnce();
    expect(h.request).toHaveBeenCalledOnce();
    dispose();
    await finishBackground('owner', 'cancelled');
    const second = await beginBackground('owner', () => undefined, true);
    expect(h.request).toHaveBeenCalledOnce();
    second();
    await finishBackground('owner', 'complete');
    expect(h.events.size).toBe(0);
  });
  it('delivers cancel and timeout and removes native subscriptions', async () => {
    const abort = vi.fn();
    const dispose = await beginBackground('owner', abort, true);
    h.events.get('cancel')!();
    h.events.get('timeout')!();
    expect(abort.mock.calls).toEqual([[], ['timeout']]);
    dispose();
    expect(h.events.size).toBe(0);
  });
  it('recovers interrupted runs as retryable without claiming success', async () => {
    await AsyncStorage.setItem('waves.backup.interrupted.owner', '1');
    await recoverBackground('owner');
    expect(backupSnapshot()).toEqual({ status: 'failed', percent: null });
  });
});
