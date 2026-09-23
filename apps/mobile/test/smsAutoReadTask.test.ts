/**
 * The hourly background read, and — the part that matters — tearing it down.
 *
 * A job that kept reading somebody's messages after the feature was switched
 * off, the permission revoked or the account signed out is the failure this
 * file exists to prevent, so every stand-down path is pinned here.
 */

import { createRequire } from 'node:module';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  defined: new Map<string, () => Promise<number>>(),
  register: vi.fn(async (_name: string, _options: unknown) => {}),
  unregister: vi.fn(async (_name: string) => {}),
  armedOwner: null as string | null,
  disarm: vi.fn(async () => {}),
  gatesOpen: true,
  run: vi.fn(async (_owner: string) => ({
    read: true,
    backfill: false,
    written: 0,
    checkedAt: '2026-03-10T09:00:00.000Z' as string | null,
  })),
}));

// Both native modules are reached through `require`, which `vi.mock` does not
// intercept, so they are stubbed in Node's require cache instead.
const nodeRequire = createRequire(import.meta.url);
function stubRequire(specifier: string, exports: unknown): string {
  const path = nodeRequire.resolve(specifier);
  nodeRequire.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
  return path;
}
const stubbed = [
  stubRequire('expo-task-manager', {
    defineTask: (name: string, fn: () => Promise<number>) => h.defined.set(name, fn),
  }),
  stubRequire('expo-background-task', {
    BackgroundTaskResult: { Success: 1, Failed: 2 },
    registerTaskAsync: h.register,
    unregisterTaskAsync: h.unregister,
  }),
];
afterAll(() => {
  for (const path of stubbed) delete nodeRequire.cache[path];
});
vi.mock('@/lib/smsAutoReadRun', () => ({
  deviceGatesOpen: async () => h.gatesOpen,
  runAutoReadFor: h.run,
}));
vi.mock('@/lib/smsAutoReadStore', () => ({
  loadArmedOwner: async () => h.armedOwner,
  disarmAutoRead: h.disarm,
}));

const task = await import('@/lib/smsAutoReadTask');
const scheduledPass = (): Promise<number> => h.defined.get(task.SMS_AUTO_READ_TASK)!();

beforeEach(() => {
  h.register.mockClear();
  h.unregister.mockClear();
  h.disarm.mockClear();
  h.run.mockClear();
  h.armedOwner = 'alice';
  h.gatesOpen = true;
});

describe('defining the job', () => {
  it('defines the task by its namespaced name at import, so a headless wake-up finds it', () => {
    expect(task.SMS_AUTO_READ_TASK).toBe('waves.sms-auto-read');
    expect(h.defined.has('waves.sms-auto-read')).toBe(true);
  });
});

describe('a scheduled pass', () => {
  it('reads for the armed account and keeps the job', async () => {
    await expect(scheduledPass()).resolves.toBe(1);

    expect(h.run).toHaveBeenCalledWith('alice');
    expect(h.unregister).not.toHaveBeenCalled();
    expect(h.disarm).not.toHaveBeenCalled();
  });

  it('stands itself down when nobody armed it', async () => {
    h.armedOwner = null;

    await expect(scheduledPass()).resolves.toBe(1);

    expect(h.run).not.toHaveBeenCalled();
    expect(h.unregister).toHaveBeenCalledWith('waves.sms-auto-read');
  });

  it('disarms and unregisters when the permission was revoked while the app was closed', async () => {
    h.run.mockResolvedValueOnce({ read: false, backfill: false, written: 0, checkedAt: null });
    h.gatesOpen = false;

    await expect(scheduledPass()).resolves.toBe(1);

    expect(h.disarm).toHaveBeenCalledTimes(1);
    expect(h.unregister).toHaveBeenCalledTimes(1);
  });

  it('keeps the job after a read that failed for a passing reason', async () => {
    h.run.mockResolvedValueOnce({ read: false, backfill: false, written: 0, checkedAt: null });

    await expect(scheduledPass()).resolves.toBe(1);

    expect(h.unregister).not.toHaveBeenCalled();
  });

  it('reports failure to the scheduler when something throws, and says nothing else', async () => {
    h.run.mockRejectedValueOnce(new Error('boom'));
    await expect(scheduledPass()).resolves.toBe(2);
  });
});

describe('putting the schedule where the gates say', () => {
  it('registers hourly when enabled', async () => {
    await task.syncAutoReadTask(true);

    expect(h.register).toHaveBeenCalledWith('waves.sms-auto-read', { minimumInterval: 60 });
    expect(h.disarm).not.toHaveBeenCalled();
  });

  it('disarms and unregisters together when disabled', async () => {
    await task.syncAutoReadTask(false);

    expect(h.disarm).toHaveBeenCalledTimes(1);
    expect(h.unregister).toHaveBeenCalledWith('waves.sms-auto-read');
    expect(h.register).not.toHaveBeenCalled();
  });

  it('turns only the wake-up on or off for the preference, never the armed record', async () => {
    await task.syncAutoReadSchedule(true);
    expect(h.register).toHaveBeenCalledTimes(1);

    await task.syncAutoReadSchedule(false);
    expect(h.unregister).toHaveBeenCalledTimes(1);
    expect(h.disarm).not.toHaveBeenCalled();
  });

  it('swallows a scheduler that refuses either way', async () => {
    h.register.mockRejectedValueOnce(new Error('background work restricted'));
    h.unregister.mockRejectedValueOnce(new Error('not registered'));

    await expect(task.registerAutoReadTask()).resolves.toBeUndefined();
    await expect(task.unregisterAutoReadTask()).resolves.toBeUndefined();
  });
});
