/**
 * `useBackup` — the backup screen's state and every action on it.
 *
 * The engine, the tiers and the on-disk settings are tested on their own
 * (`backupEscrow`, `backupTiers`, `backupAccountScope`). What this covers is
 * the seam the screen stands on: that the first load reads the three local
 * stores and nothing on the network, that switching accounts re-arms loading
 * rather than showing somebody else's answers, and that each action leaves the
 * screen in the state the disk is now in — including the refusals, which each
 * have a different way out.
 *
 * Settings, tier and recovery-key helpers run for real against the in-memory
 * AsyncStorage and a Map standing in for the keystore; only the engine, the
 * provider and the OAuth tokens are stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MutationKind, personalScope } from '@waves/core';

import { bytesToHex, loadRecoveryKey, saveRecoveryKey } from '@/lib/backup/recoveryKey';
import { BackupFrequency } from '@/lib/backup/schedule';
import { loadBackupSettings, markKeySeen, saveLastBackup, saveTier } from '@/lib/backup/settings';
import { BackupTier } from '@/lib/backup/tier';
import { useBackup } from '@/lib/backup/useBackup';
import { SyncNetworkPreference } from '@/lib/syncNetwork';

import { renderHook } from './mocks/fakeReact';

vi.mock('react', () => import('./mocks/fakeReact'));

const h = vi.hoisted(() => ({
  keystore: new Map<string, string>(),
  session: { user: { id: 'alice' } } as { user: { id: string } } | null,
  records: [] as { id: string; created_at: string }[],
  localIds: new Set<string>(),
  mutate: vi.fn(async (..._args: unknown[]) => 'm'),
  flush: vi.fn(async (_ids?: string[]) => undefined),
  tokens: new Map<string, unknown>(),
  provider: {
    isConfigured: vi.fn(() => true),
    connect: vi.fn(async (): Promise<unknown> => ({ accessToken: 'at' })),
    revoke: vi.fn(async (_t: unknown) => undefined),
    account: vi.fn(async (_t: unknown): Promise<string | null> => 'alice@example.com'),
  },
  runBackup: vi.fn(),
  scanBackup: vi.fn(),
  upgradeToExtra: vi.fn(),
  clearBackupState: vi.fn(async (_owner: string) => undefined),
}));

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: async (key: string) => h.keystore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void h.keystore.set(key, value),
  deleteItemAsync: async (key: string) => void h.keystore.delete(key),
}));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
}));
vi.mock('expo-network', () => ({ NetworkStateType: { WIFI: 'wifi', CELLULAR: 'cellular' } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock('@/sync', () => ({ useSync: () => ({ mutate: h.mutate, flush: h.flush }) }));
vi.mock('@/data/personal', () => ({
  usePersonalRecords: () => h.records,
  usePersonalRecordIds: () => h.localIds,
}));
vi.mock('@/lib/cloud/providers', () => ({ providerFor: () => h.provider }));
vi.mock('@/lib/cloud/tokens', () => ({
  loadTokens: async (_p: string, owner: string) => h.tokens.get(owner) ?? null,
  saveTokens: async (_p: string, owner: string, tokens: unknown) =>
    void h.tokens.set(owner, tokens),
}));
vi.mock('@/lib/backup/engine', () => ({
  PRIMARY_PROVIDER: 'gdrive',
  runBackup: h.runBackup,
  scanBackup: h.scanBackup,
  upgradeToExtra: h.upgradeToExtra,
  clearBackupState: h.clearBackupState,
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

async function mount() {
  const rendered = renderHook(() => useBackup());
  await settle();
  return rendered;
}

const KEY_HEX = 'ab'.repeat(32);
const LAST = { at: Date.parse('2026-09-01T00:00:00Z'), size: 100, records: 2 };

beforeEach(async () => {
  vi.clearAllMocks();
  h.keystore.clear();
  h.tokens.clear();
  h.session = { user: { id: 'alice' } };
  h.records = [];
  h.localIds = new Set();
  h.provider.isConfigured.mockReturnValue(true);
  h.provider.account.mockResolvedValue('alice@example.com');
  h.provider.connect.mockResolvedValue({ accessToken: 'at' });
  await AsyncStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the first load', () => {
  it('starts loading, then settles on a fresh setup: Standard, unlinked, no key', async () => {
    const rendered = renderHook(() => useBackup());
    expect(rendered.result.current.loading).toBe(true);
    await settle();
    const state = rendered.result.current;
    expect(state.loading).toBe(false);
    expect(state.connected).toBe(false);
    expect(state.account).toBeNull();
    expect(state.hasKey).toBe(false);
    expect(state.tier).toBe(BackupTier.Standard);
    expect(state.configured).toBe(true);
    // The answer is written down, so the tier is state from here on.
    expect((await loadBackupSettings('alice')).tier).toBe(BackupTier.Standard);
  });

  it('carries a pre-tier phone that holds a kept key onto Extra protection', async () => {
    await saveRecoveryKey('alice', new Uint8Array(32).fill(1));
    await markKeySeen('alice');
    const { result } = await mount();
    expect(result.current.hasKey).toBe(true);
    expect(result.current.tier).toBe(BackupTier.Extra);
    expect((await loadBackupSettings('alice')).tier).toBe(BackupTier.Extra);
  });

  it('shows the linked account, filled in without holding up loading', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    const { result } = await mount();
    expect(result.current.connected).toBe(true);
    expect(result.current.account).toBe('alice@example.com');
  });

  it('falls back to no address when Drive will not say', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    h.provider.account.mockRejectedValue(new Error('offline'));
    const { result } = await mount();
    expect(result.current.connected).toBe(true);
    expect(result.current.account).toBeNull();
  });

  it('re-arms loading, and reads the new account, when somebody else signs in', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    const rendered = await mount();
    expect(rendered.result.current.connected).toBe(true);

    h.session = { user: { id: 'bob' } };
    rendered.rerender();
    // Until bob's reads land, alice's answers must not stand for his.
    expect(rendered.result.current.loading).toBe(true);
    await settle();
    expect(rendered.result.current.loading).toBe(false);
    expect(rendered.result.current.connected).toBe(false);
  });

  it('ignores reads that land after unmount', async () => {
    const rendered = renderHook(() => useBackup());
    rendered.unmount();
    await settle();
    expect(rendered.result.current.loading).toBe(true);
  });

  it('counts records added since the last backup into its standing', async () => {
    await saveLastBackup('alice', LAST);
    h.records = [
      { id: 'r1', created_at: '2026-08-01T00:00:00Z' },
      { id: 'r2', created_at: '2026-09-02T00:00:00Z' },
    ];
    const { result } = await mount();
    expect(result.current.recordCount).toBe(2);
    expect(result.current.standing.newSince).toBe(1);
    expect(result.current.standing.everBackedUp).toBe(true);
    expect(result.current.standing.upToDate).toBe(false);
  });

  it('treats every record as new before the first backup', async () => {
    h.records = [{ id: 'r1', created_at: '2026-08-01T00:00:00Z' }];
    const { result } = await mount();
    expect(result.current.standing.newSince).toBe(1);
    expect(result.current.standing.everBackedUp).toBe(false);
  });

  it('works for a signed-out caller without touching storage', async () => {
    h.session = null;
    const { result } = await mount();
    expect(result.current.loading).toBe(false);
    expect(result.current.connected).toBe(false);
    expect(await result.current.connect()).toBe(false);
    await result.current.disconnect();
    expect(h.clearBackupState).not.toHaveBeenCalled();
    expect(await result.current.revealKey()).toBeNull();
    expect(
      await result.current.applyRestore({ ok: true, plan: { restore: [{ id: 'x' }] } } as never),
    ).toBe(0);
  });
});

describe('connecting and disconnecting', () => {
  it('saves the grant and shows the account on connect', async () => {
    const rendered = await mount();
    expect(await rendered.result.current.connect()).toBe(true);
    await settle();
    expect(h.tokens.get('alice')).toEqual({ accessToken: 'at' });
    expect(rendered.result.current.connected).toBe(true);
    expect(rendered.result.current.account).toBe('alice@example.com');
  });

  it('treats a closed consent page as a cancel, not an error', async () => {
    h.provider.connect.mockResolvedValue(null);
    const rendered = await mount();
    expect(await rendered.result.current.connect()).toBe(false);
    expect(h.tokens.size).toBe(0);
  });

  it('revokes, wipes and resets on disconnect, even when the revoke fails', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    h.provider.revoke.mockRejectedValueOnce(new Error('network'));
    const rendered = await mount();
    h.clearBackupState.mockImplementationOnce(async () => void h.tokens.delete('alice'));

    await rendered.result.current.disconnect();

    expect(h.provider.revoke).toHaveBeenCalledWith({ accessToken: 'at' });
    expect(h.clearBackupState).toHaveBeenCalledWith('alice');
    expect(rendered.result.current.connected).toBe(false);
    expect(rendered.result.current.account).toBeNull();
    expect(rendered.result.current.hasKey).toBe(false);
    expect(rendered.result.current.outcome).toBeNull();
  });

  it('skips the revoke when nothing was linked', async () => {
    const rendered = await mount();
    await rendered.result.current.disconnect();
    expect(h.provider.revoke).not.toHaveBeenCalled();
    expect(h.clearBackupState).toHaveBeenCalledWith('alice');
  });
});

describe('backing up now', () => {
  it('records the run, shows the phases, and notes the key it may have minted', async () => {
    h.records = [{ id: 'r1', created_at: '2026-08-01T00:00:00Z' }];
    const phases: unknown[] = [];
    h.runBackup.mockImplementation(
      async (input: { onPhase: (p: string) => void; manual: boolean }) => {
        input.onPhase('sealing');
        phases.push('sealing');
        return { ok: true, last: LAST };
      },
    );
    const rendered = await mount();

    const outcome = await rendered.result.current.backupNow();

    expect(outcome).toEqual({ kind: 'ok', records: 2 });
    expect(h.runBackup).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'alice', manual: true, tier: BackupTier.Standard }),
    );
    expect(rendered.result.current.outcome).toEqual(outcome);
    expect(rendered.result.current.phase).toBeNull();
    expect(rendered.result.current.hasKey).toBe(true);
    expect(rendered.result.current.settings.last).toEqual(LAST);
    expect((await loadBackupSettings('alice')).last).toEqual(LAST);
  });

  it('shows a refusal, and re-reads the link when the grant died', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    h.runBackup.mockImplementation(async () => {
      h.tokens.delete('alice'); // the engine clears a dead grant
      return { ok: false, refusal: 'auth' };
    });
    const rendered = await mount();
    expect(rendered.result.current.connected).toBe(true);

    const outcome = await rendered.result.current.backupNow();

    expect(outcome).toEqual({ kind: 'refused', refusal: 'auth' });
    expect(rendered.result.current.outcome).toEqual(outcome);
    expect(rendered.result.current.connected).toBe(false);
  });

  it('leaves the link alone on any other refusal', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    h.runBackup.mockResolvedValue({ ok: false, refusal: 'metered' });
    const rendered = await mount();
    expect(await rendered.result.current.backupNow()).toEqual({
      kind: 'refused',
      refusal: 'metered',
    });
    expect(rendered.result.current.connected).toBe(true);
  });

  it('clears the phase even when the run throws', async () => {
    h.runBackup.mockImplementation(async (input: { onPhase: (p: string) => void }) => {
      input.onPhase('uploading');
      throw new Error('boom');
    });
    const rendered = await mount();
    await expect(rendered.result.current.backupNow()).rejects.toThrow('boom');
    expect(rendered.result.current.phase).toBeNull();
  });
});

describe('preferences', () => {
  it('updates and stores the frequency and the network', async () => {
    const rendered = await mount();
    await rendered.result.current.setFrequency(BackupFrequency.Weekly);
    await rendered.result.current.setNetwork(SyncNetworkPreference.Both);
    expect(rendered.result.current.settings.frequency).toBe(BackupFrequency.Weekly);
    expect(rendered.result.current.settings.network).toBe(SyncNetworkPreference.Both);
    const stored = await loadBackupSettings('alice');
    expect(stored.frequency).toBe(BackupFrequency.Weekly);
    expect(stored.network).toBe(SyncNetworkPreference.Both);
  });

  it('confirms the key has been seen', async () => {
    const rendered = await mount();
    await rendered.result.current.confirmKeySeen();
    expect(rendered.result.current.settings.keySeen).toBe(true);
    expect((await loadBackupSettings('alice')).keySeen).toBe(true);
  });
});

describe('the recovery key', () => {
  it('mints and stores a key, and shows it again on request', async () => {
    const rendered = await mount();
    const hex = await rendered.result.current.createKey();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(rendered.result.current.hasKey).toBe(true);
    expect(await rendered.result.current.revealKey()).toBe(hex);
  });

  it('has nothing to reveal when this phone holds no key', async () => {
    const rendered = await mount();
    expect(await rendered.result.current.revealKey()).toBeNull();
  });

  it('accepts a key typed in from elsewhere, and moves the account to Extra', async () => {
    const rendered = await mount();
    expect(await rendered.result.current.acceptKey(KEY_HEX)).toBe(true);
    expect(bytesToHex((await loadRecoveryKey('alice'))!)).toBe(KEY_HEX);
    expect(rendered.result.current.hasKey).toBe(true);
    expect(rendered.result.current.tier).toBe(BackupTier.Extra);
    expect(rendered.result.current.settings.keySeen).toBe(true);
    const stored = await loadBackupSettings('alice');
    expect(stored.tier).toBe(BackupTier.Extra);
    expect(stored.keySeen).toBe(true);
  });

  it('refuses something that is not a key, and stores nothing', async () => {
    const rendered = await mount();
    expect(await rendered.result.current.acceptKey('not a key')).toBe(false);
    expect(await loadRecoveryKey('alice')).toBeNull();
  });
});

describe('the upgrade to Extra protection', () => {
  it('hands back a key to show and stores nothing until it is committed', async () => {
    const rendered = await mount();
    const hex = rendered.result.current.beginExtra();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(await loadRecoveryKey('alice')).toBeNull();
    expect(rendered.result.current.tier).toBe(BackupTier.Standard);
  });

  it('commits: re-seals, then records the tier, the key and the backup', async () => {
    h.upgradeToExtra.mockResolvedValue({ ok: true, last: LAST });
    const rendered = await mount();

    const outcome = await rendered.result.current.commitExtra(KEY_HEX);

    expect(outcome).toEqual({ kind: 'ok', records: 2 });
    expect(h.upgradeToExtra).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'alice' }));
    expect(rendered.result.current.tier).toBe(BackupTier.Extra);
    expect(rendered.result.current.hasKey).toBe(true);
    expect(rendered.result.current.settings).toMatchObject({ keySeen: true, last: LAST });
    expect((await loadBackupSettings('alice')).keySeen).toBe(true);
  });

  it('refuses a mangled key without calling the engine', async () => {
    const rendered = await mount();
    expect(await rendered.result.current.commitExtra('zz')).toEqual({
      kind: 'refused',
      refusal: 'no-key',
    });
    expect(h.upgradeToExtra).not.toHaveBeenCalled();
  });

  it('reports an engine refusal, re-reading the link on a dead grant', async () => {
    h.tokens.set('alice', { accessToken: 'at' });
    h.upgradeToExtra.mockImplementation(async () => {
      h.tokens.delete('alice');
      return { ok: false, refusal: 'auth' };
    });
    const rendered = await mount();
    expect(await rendered.result.current.commitExtra(KEY_HEX)).toEqual({
      kind: 'refused',
      refusal: 'auth',
    });
    expect(rendered.result.current.connected).toBe(false);
    expect(rendered.result.current.tier).toBe(BackupTier.Standard);

    h.upgradeToExtra.mockResolvedValue({ ok: false, refusal: 'busy' });
    expect(await rendered.result.current.commitExtra(KEY_HEX)).toEqual({
      kind: 'refused',
      refusal: 'busy',
    });
  });
});

describe('restoring', () => {
  it('asks the engine what a restore would write, passing the local ids', async () => {
    h.localIds = new Set(['r1']);
    h.scanBackup.mockResolvedValue({ ok: false, reason: 'missing' });
    const rendered = await mount();
    expect(await rendered.result.current.scan()).toEqual({ ok: false, reason: 'missing' });
    expect(h.scanBackup).toHaveBeenCalledWith({ ownerId: 'alice', localIds: h.localIds });
  });

  it('queues each planned record through the offline queue and asks it to leave', async () => {
    const rendered = await mount();
    const plan = {
      restore: [
        { id: 'r1', kind: 'expense', data: { amount: '1' } },
        { id: 'r2', kind: 'income', data: { amount: '2' } },
      ],
    };
    const written = await rendered.result.current.applyRestore({ ok: true, plan } as never);

    expect(written).toBe(2);
    const scope = personalScope('alice');
    expect(h.mutate).toHaveBeenNthCalledWith(1, MutationKind.PersonalUpsert, scope, {
      recordId: 'r1',
      recordKind: 'expense',
      data: { amount: '1' },
    });
    expect(h.mutate).toHaveBeenCalledTimes(2);
    expect(h.flush).toHaveBeenCalledWith([scope]);
  });
});

describe('an unconfigured build', () => {
  it('says so, and cannot back up even when linked', async () => {
    h.provider.isConfigured.mockReturnValue(false);
    h.tokens.set('alice', { accessToken: 'at' });
    await saveTier('alice', BackupTier.Standard);
    const { result } = await mount();
    expect(result.current.configured).toBe(false);
    expect(result.current.standing.canBackUp).toBe(false);
  });
});
