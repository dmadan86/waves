/**
 * `AutoBackup` — the "Daily / Weekly / Monthly" half that runs itself.
 *
 * It is deliberately not a background task: it checks once on mount and again
 * whenever the app comes to the foreground, at most every five minutes, and
 * runs a backup only when one is due and the tier allows it. Every failure is
 * silent — the "Last backup" line on the settings screen is where a missed run
 * shows, not an alert over whatever the person is doing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AutoBackup } from '@/lib/backup/AutoBackup';
import { saveRecoveryKey } from '@/lib/backup/recoveryKey';
import { BackupFrequency } from '@/lib/backup/schedule';
import {
  loadBackupSettings,
  markKeySeen,
  saveFrequency,
  saveLastBackup,
  saveTier,
} from '@/lib/backup/settings';
import { BackupTier } from '@/lib/backup/tier';

import { renderHook } from './mocks/fakeReact';

vi.mock('react', () => import('./mocks/fakeReact'));

const h = vi.hoisted(() => ({
  keystore: new Map<string, string>(),
  session: { user: { id: 'alice' } } as { user: { id: string } } | null,
  records: [] as unknown[],
  appState: [] as ((state: string) => void)[],
  removed: vi.fn(),
  runBackup: vi.fn(),
  reportHandled: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_e: string, listener: (state: string) => void) => {
      h.appState.push(listener);
      return { remove: h.removed };
    },
  },
}));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'a',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'b',
  getItemAsync: async (key: string) => h.keystore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void h.keystore.set(key, value),
  deleteItemAsync: async (key: string) => void h.keystore.delete(key),
}));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
}));
vi.mock('expo-network', () => ({ NetworkStateType: { WIFI: 'wifi', CELLULAR: 'cellular' } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock('@/data/personal', () => ({ usePersonalRecords: () => h.records }));
vi.mock('@/lib/observability', () => ({ reportHandled: h.reportHandled }));
vi.mock('@/lib/backup/engine', () => ({ runBackup: h.runBackup }));

const NOW = Date.parse('2026-09-23T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const LAST = { at: NOW - 2 * DAY, size: 10, records: 1 };

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.keystore.clear();
  h.appState.length = 0;
  h.session = { user: { id: 'alice' } };
  h.records = [{ id: 'r1' }];
  h.runBackup.mockResolvedValue({ ok: true, last: { at: NOW, size: 20, records: 1 } });
  await AsyncStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AutoBackup', () => {
  it('renders nothing and does nothing when nobody is signed in', async () => {
    h.session = null;
    const { result } = renderHook(() => AutoBackup());
    await settle();
    expect(result.current).toBeNull();
    expect(h.appState).toHaveLength(0);
    expect(h.runBackup).not.toHaveBeenCalled();
  });

  it('does nothing while the schedule is off', async () => {
    renderHook(() => AutoBackup());
    await settle();
    expect(h.runBackup).not.toHaveBeenCalled();
  });

  it('runs a due Standard backup on mount, unattended, and records it', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    await saveLastBackup('alice', LAST);
    renderHook(() => AutoBackup());
    await settle();

    expect(h.runBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'alice',
        records: h.records,
        tier: BackupTier.Standard,
        manual: false,
      }),
    );
    expect((await loadBackupSettings('alice')).last?.at).toBe(NOW);
  });

  it('skips a backup that is not yet due', async () => {
    await saveFrequency('alice', BackupFrequency.Weekly);
    await saveLastBackup('alice', LAST);
    renderHook(() => AutoBackup());
    await settle();
    expect(h.runBackup).not.toHaveBeenCalled();
  });

  it('holds an Extra-protection backup until the key has been seen', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    await saveTier('alice', BackupTier.Extra);
    renderHook(() => AutoBackup());
    await settle();
    expect(h.runBackup).not.toHaveBeenCalled();
  });

  it('infers Extra for a pre-tier phone holding a kept key', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    await saveRecoveryKey('alice', new Uint8Array(32).fill(7));
    await markKeySeen('alice');
    renderHook(() => AutoBackup());
    await settle();
    expect(h.runBackup).toHaveBeenCalledWith(expect.objectContaining({ tier: BackupTier.Extra }));
  });

  it('checks again on foreground, but not within five minutes of the last check', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    h.runBackup.mockResolvedValue({ ok: false, refusal: 'metered' });
    renderHook(() => AutoBackup());
    await settle();
    expect(h.runBackup).toHaveBeenCalledTimes(1);

    h.appState[0]!('active');
    await settle();
    expect(h.runBackup).toHaveBeenCalledTimes(1);

    h.appState[0]!('background');
    vi.setSystemTime(NOW + 6 * 60 * 1000);
    await settle();
    expect(h.runBackup).toHaveBeenCalledTimes(1);

    h.appState[0]!('active');
    await settle();
    expect(h.runBackup).toHaveBeenCalledTimes(2);
    // A refused run records nothing.
    expect((await loadBackupSettings('alice')).last).toBeNull();
  });

  it('uses the newest records when a later check fires', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    h.runBackup.mockResolvedValue({ ok: false, refusal: 'metered' });
    const rendered = renderHook(() => AutoBackup());
    await settle();

    h.records = [{ id: 'r1' }, { id: 'r2' }];
    rendered.rerender();
    vi.setSystemTime(NOW + 6 * 60 * 1000);
    h.appState[0]!('active');
    await settle();
    expect(h.runBackup).toHaveBeenLastCalledWith(expect.objectContaining({ records: h.records }));
  });

  it('reports a failed check instead of throwing', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    h.runBackup.mockRejectedValue(new Error('drive down'));
    renderHook(() => AutoBackup());
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'backup.auto');
  });

  it('does not record a run that finished after unmount, and unsubscribes', async () => {
    await saveFrequency('alice', BackupFrequency.Daily);
    let finish!: (value: unknown) => void;
    h.runBackup.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const rendered = renderHook(() => AutoBackup());
    await settle();
    rendered.unmount();
    expect(h.removed).toHaveBeenCalledTimes(1);
    finish({ ok: true, last: { at: NOW, size: 1, records: 1 } });
    await settle();
    expect((await loadBackupSettings('alice')).last).toBeNull();
  });
});
