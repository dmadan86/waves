import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackupReminderInput } from '../src/lib/backup/reminder';

// `settings.ts` reaches the sync-network module, which imports expo-network for
// a type-level enum. Nothing here touches a network; this only has to load.
vi.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'wifi', CELLULAR: 'cellular', NONE: 'none' },
}));

const { wantsBackupReminder, REMINDER_FRESH_MS } = await import('../src/lib/backup/reminder');
const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
const { clearBackupSettings, loadBackupReminderDay, saveBackupReminderDay } =
  await import('../src/lib/backup/settings');

const NOW = Date.UTC(2026, 9, 2, 9, 0, 0);

const base: BackupReminderInput = {
  signedIn: true,
  isGuest: false,
  configured: true,
  recordCount: 12,
  lastBackupAt: null,
  answeredOn: null,
  today: '2026-10-02',
  now: NOW,
  settled: true,
};

describe('wantsBackupReminder', () => {
  it('asks a signed-in account with records and no backup', () => {
    expect(wantsBackupReminder(base)).toBe(true);
  });

  it('asks again when the last backup is more than a day old', () => {
    expect(wantsBackupReminder({ ...base, lastBackupAt: NOW - REMINDER_FRESH_MS - 1 })).toBe(true);
  });

  it('stays quiet after a backup inside the last day', () => {
    expect(wantsBackupReminder({ ...base, lastBackupAt: NOW - 60_000 })).toBe(false);
  });

  it('asks at most once a day', () => {
    expect(wantsBackupReminder({ ...base, answeredOn: '2026-10-02' })).toBe(false);
    expect(wantsBackupReminder({ ...base, answeredOn: '2026-10-01' })).toBe(true);
  });

  it('never asks before everything has been read', () => {
    expect(wantsBackupReminder({ ...base, settled: false })).toBe(false);
  });

  it('never asks a guest, a signed-out phone, or a build that cannot reach Drive', () => {
    expect(wantsBackupReminder({ ...base, isGuest: true })).toBe(false);
    expect(wantsBackupReminder({ ...base, signedIn: false })).toBe(false);
    expect(wantsBackupReminder({ ...base, configured: false })).toBe(false);
  });

  it('has nothing to say with no records on the phone', () => {
    expect(wantsBackupReminder({ ...base, recordCount: 0 })).toBe(false);
  });
});

describe('reminder day storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('remembers the day per account and is wiped on sign-out', async () => {
    await saveBackupReminderDay('a', '2026-10-02');
    expect(await loadBackupReminderDay('a')).toBe('2026-10-02');
    expect(await loadBackupReminderDay('b')).toBeNull();
    await clearBackupSettings('a');
    expect(await loadBackupReminderDay('a')).toBeNull();
  });
});
