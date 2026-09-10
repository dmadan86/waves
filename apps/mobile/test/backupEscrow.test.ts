/**
 * The escrowed key, end to end, against a fake appDataFolder.
 *
 * `backupTiers.test.ts` pins the decisions; this one pins the I/O they ask for,
 * because the states that matter are all about *what is left in the folder*
 * when something stops halfway. Three claims in particular are load-bearing and
 * would otherwise only ever be tested by somebody on a new phone:
 *
 * 1. An account made under the build before tiers keeps working, and its
 *    envelope — which carries no tier at all — stays readable.
 * 2. The upgrade deletes the escrowed key only after the re-seal has landed.
 * 3. A restore knows which tier the blob it found belongs to, and asks for a
 *    key only when there is one to ask for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  keystore: new Map<string, string>(),
  folder: new Map<string, { remoteId: string; name: string; content: string }>(),
  /** Every provider call in order, so an ordering claim can be asserted. */
  calls: [] as string[],
  /** When set, the next `put` of this name throws instead of writing. */
  failPut: null as string | null,
  /** When set, `remove` throws. */
  failRemove: false,
  nextId: 1,
}));

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: async (key: string) => hoisted.keystore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    hoisted.keystore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    hoisted.keystore.delete(key);
  },
}));

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  },
}));

vi.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isInternetReachable: true, type: 'wifi' }),
  NetworkStateType: { WIFI: 'wifi', CELLULAR: 'cellular' },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));

vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: () => undefined }));
vi.mock('@/lib/observability', () => ({ reportHandled: vi.fn() }));

vi.mock('expo-auth-session', () => ({
  AuthRequest: class {},
  exchangeCodeAsync: async () => ({}),
  makeRedirectUri: () => 'waves://oauthredirect',
  refreshAsync: async () => ({}),
}));

/**
 * A Drive appDataFolder that actually holds files, so the engine's two-file
 * dance can be watched rather than stubbed. Names are the engine's own, which
 * is what makes "the key file is gone" expressible as a test.
 */
vi.mock('@/lib/cloud/providers', () => {
  const provider = {
    id: 'gdrive' as const,
    label: 'Google Drive',
    isConfigured: () => true,
    connect: async () => null,
    ensureValid: async (tokens: unknown) => tokens,
    account: async () => 'someone@example.com',
    async find(_tokens: unknown, name: string) {
      hoisted.calls.push(`find:${name}`);
      const file = hoisted.folder.get(name);
      return file
        ? { remoteId: file.remoteId, name, size: file.content.length, modifiedAt: null }
        : null;
    },
    async put(_tokens: unknown, name: string, content: string, existingId: string | null) {
      hoisted.calls.push(`put:${name}`);
      if (hoisted.failPut === name) throw new Error('drive said no');
      const remoteId = existingId ?? `file-${hoisted.nextId++}`;
      hoisted.folder.set(name, { remoteId, name, content });
      return { remoteId, name, size: content.length, modifiedAt: null };
    },
    async read(_tokens: unknown, remoteId: string) {
      hoisted.calls.push(`read:${remoteId}`);
      for (const file of hoisted.folder.values())
        if (file.remoteId === remoteId) return file.content;
      throw new Error('no such file');
    },
    async remove(_tokens: unknown, remoteId: string) {
      hoisted.calls.push(`remove:${remoteId}`);
      if (hoisted.failRemove) throw new Error('drive said no');
      for (const [name, file] of hoisted.folder)
        if (file.remoteId === remoteId) hoisted.folder.delete(name);
    },
  };
  return { providerFor: () => provider, allProviders: () => [provider] };
});

const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
const { saveTokens } = await import('../src/lib/cloud/tokens');
const { runBackup, scanBackup, upgradeToExtra, backupFileName } =
  await import('../src/lib/backup/engine');
const { backupAad, buildBody, buildFile, BACKUP_FORMAT, BACKUP_VERSION, BACKUP_ALG } =
  await import('../src/lib/backup/payload');
const { bytesToHex, loadRecoveryKey, parseRecoveryKey, saveRecoveryKey, sealBackup, backupNonce } =
  await import('../src/lib/backup/recoveryKey');
const { BackupTier, escrowFileName, parseEscrow } = await import('../src/lib/backup/tier');
const { loadBackupSettings } = await import('../src/lib/backup/settings');
const { SyncNetworkPreference } = await import('../src/lib/syncNetwork');

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OLD_KEY = parseRecoveryKey('11'.repeat(32))!;
const TOKENS = { accessToken: 'at', refreshToken: 'rt', expiresAt: null };

const BLOB = backupFileName(OWNER);
const ESCROW = escrowFileName(OWNER);

/**
 * Forget only this device's recovery key.
 *
 * Not the whole keystore: the OAuth tokens live there too, so clearing it
 * outright unlinks the Google account and every "a new phone" case below turns
 * into "not connected" instead of the state it meant to describe.
 */
const forgetDeviceKey = (): void => {
  for (const key of [...hoisted.keystore.keys()]) {
    if (key.includes('recovery_key')) hoisted.keystore.delete(key);
  }
};

const row = (id: string) => ({
  id,
  record_kind: 'expense',
  data: { amount: 1200 },
  created_at: '2026-09-01T00:00:00.000Z',
  deleted_at: null,
});

const run = (tier: (typeof BackupTier)[keyof typeof BackupTier], records = [row('a')]) =>
  runBackup({
    ownerId: OWNER,
    records,
    tier,
    network: SyncNetworkPreference.Both,
    manual: true,
  });

/** The envelope currently in the folder, parsed as JSON. */
const envelope = (): Record<string, unknown> =>
  JSON.parse(hoisted.folder.get(BLOB)!.content) as Record<string, unknown>;

beforeEach(async () => {
  hoisted.keystore.clear();
  hoisted.folder.clear();
  hoisted.calls.length = 0;
  hoisted.failPut = null;
  hoisted.failRemove = false;
  hoisted.nextId = 1;
  await AsyncStorage.clear();
  await saveTokens('gdrive', OWNER, TOKENS);
});

describe('Standard, on a phone that has never held a key', () => {
  it('mints one, puts a copy in the folder, and says so in the envelope', async () => {
    expect((await run(BackupTier.Standard)).ok).toBe(true);

    const escrowed = parseEscrow(hoisted.folder.get(ESCROW)!.content);
    expect(escrowed.tier).toBe(BackupTier.Standard);
    expect(envelope().tier).toBe(BackupTier.Standard);
    // And the key is on the phone too, so the next run needs no round trip.
    expect(bytesToHex((await loadRecoveryKey(OWNER))!)).toBe(escrowed.key);
  });

  it('escrows before it stores locally, so the folder is never the one without it', async () => {
    await run(BackupTier.Standard);
    // The state Standard must never be in is a key on the phone with no copy in
    // the folder, because the screen is at that moment promising a new phone
    // will find it.
    expect(hoisted.calls.indexOf(`put:${ESCROW}`)).toBeLessThan(
      hoisted.calls.indexOf(`put:${BLOB}`),
    );
  });
});

describe('Standard, on a second phone signed into the same Google account', () => {
  it('adopts the escrowed key instead of minting a rival one', async () => {
    await run(BackupTier.Standard);
    const first = hoisted.folder.get(ESCROW)!.content;

    // A new phone: same folder, no key of its own.
    forgetDeviceKey();
    expect((await run(BackupTier.Standard)).ok).toBe(true);

    expect(hoisted.folder.get(ESCROW)!.content).toBe(first);
    expect(bytesToHex((await loadRecoveryKey(OWNER))!)).toBe(parseEscrow(first).key);
  });

  it('restores with nothing asked of anybody', async () => {
    await run(BackupTier.Standard, [row('a'), row('b')]);
    forgetDeviceKey();

    const scan = await scanBackup({ ownerId: OWNER, localIds: new Set() });
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.tier).toBe(BackupTier.Standard);
    expect(scan.plan.restore.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('throws the phone’s stale key away rather than sealing under it', async () => {
    await run(BackupTier.Standard);
    const escrowed = parseEscrow(hoisted.folder.get(ESCROW)!.content).key;
    // The half-finished-upgrade state: a newer key on the phone, the older one
    // still in the folder, the blob still sealed under the older one.
    await saveRecoveryKey(OWNER, parseRecoveryKey('22'.repeat(32))!);

    await run(BackupTier.Standard);
    expect(bytesToHex((await loadRecoveryKey(OWNER))!)).toBe(escrowed);
    expect((await scanBackup({ ownerId: OWNER, localIds: new Set() })).ok).toBe(true);
  });
});

describe('an account made under the build before tiers', () => {
  /** Exactly what the first build wrote: no tier field, no key in the folder. */
  const writeLegacyBlob = (records: readonly ReturnType<typeof row>[]) => {
    const body = buildBody(OWNER, records, new Date('2026-09-01T00:00:00.000Z'));
    const sealed = sealBackup(OLD_KEY, backupNonce(), JSON.stringify(body), backupAad(OWNER));
    hoisted.folder.set(BLOB, {
      remoteId: 'legacy-1',
      name: BLOB,
      content: JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        alg: BACKUP_ALG,
        createdAt: body.createdAt,
        sealed,
      }),
    });
  };

  it('still opens, with no prompt and no loss', async () => {
    writeLegacyBlob([row('a'), row('b')]);
    await saveRecoveryKey(OWNER, OLD_KEY);

    const scan = await scanBackup({ ownerId: OWNER, localIds: new Set() });
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    // A file with no tier is an extra-protection file, because that is what it
    // was — the key was never anywhere but that phone.
    expect(scan.tier).toBe(BackupTier.Extra);
    expect(scan.plan.restore).toHaveLength(2);
  });

  it('keeps backing up on Extra without ever touching the folder’s key file', async () => {
    writeLegacyBlob([row('a')]);
    await saveRecoveryKey(OWNER, OLD_KEY);

    expect((await run(BackupTier.Extra)).ok).toBe(true);
    expect(hoisted.folder.has(ESCROW)).toBe(false);
    expect(envelope().tier).toBe(BackupTier.Extra);
    // And the key it used is still theirs, unchanged.
    expect(bytesToHex((await loadRecoveryKey(OWNER))!)).toBe(bytesToHex(OLD_KEY));
  });

  it('refuses rather than minting a second key when the keystore is empty', async () => {
    writeLegacyBlob([row('a')]);
    expect(await run(BackupTier.Extra)).toEqual({ ok: false, refusal: 'no-key' });
    expect(hoisted.folder.get(BLOB)!.remoteId).toBe('legacy-1');
  });
});

describe('a restore that cannot happen from here', () => {
  it('tells the person which key to find, and says what it found', async () => {
    await saveRecoveryKey(OWNER, OLD_KEY);
    await run(BackupTier.Extra);
    forgetDeviceKey();

    const scan = await scanBackup({ ownerId: OWNER, localIds: new Set() });
    expect(scan.ok).toBe(false);
    if (scan.ok) return;
    expect(scan.refusal).toBe('needs-key');
    // The metadata is outside the AEAD, so the fork can be offered before the
    // attempt rather than reported after it.
    expect(scan.found?.tier).toBe(BackupTier.Extra);
    expect(scan.found?.size).toBeGreaterThan(0);
  });

  it('says a Standard backup is beyond saving when its key file has gone', async () => {
    await run(BackupTier.Standard);
    // Drive's storage settings offer "Delete hidden app data", and it deletes
    // exactly this. There is nothing to type, so nothing may ask for it.
    hoisted.folder.delete(ESCROW);
    forgetDeviceKey();

    const scan = await scanBackup({ ownerId: OWNER, localIds: new Set() });
    expect(scan.ok).toBe(false);
    if (scan.ok) return;
    expect(scan.refusal).toBe('key-lost');
  });
});

describe('turning Extra protection on', () => {
  const NEW_KEY = parseRecoveryKey('33'.repeat(32))!;

  it('re-seals first and only then deletes the escrowed key', async () => {
    await run(BackupTier.Standard, [row('a'), row('b')]);
    hoisted.calls.length = 0;

    const result = await upgradeToExtra({ ownerId: OWNER, records: [], key: NEW_KEY });
    expect(result.ok).toBe(true);

    const put = hoisted.calls.indexOf(`put:${BLOB}`);
    const removed = hoisted.calls.findIndex((call) => call.startsWith('remove:'));
    expect(put).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(put);
    expect(hoisted.folder.has(ESCROW)).toBe(false);
    expect(envelope().tier).toBe(BackupTier.Extra);
  });

  it('carries the records over rather than starting a new backup', async () => {
    await run(BackupTier.Standard, [row('a'), row('b')]);
    await upgradeToExtra({ ownerId: OWNER, records: [], key: NEW_KEY });

    const scan = await scanBackup({ ownerId: OWNER, localIds: new Set() });
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.plan.restore.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('leaves the key in the folder when the re-seal fails', async () => {
    await run(BackupTier.Standard, [row('a')]);
    const before = hoisted.folder.get(BLOB)!.content;
    hoisted.failPut = BLOB;

    await expect(upgradeToExtra({ ownerId: OWNER, records: [], key: NEW_KEY })).rejects.toThrow();

    // Nothing on Drive moved: the escrowed key is still there, the blob is
    // still the one it opens, and the account is still Standard. That is the
    // failure the ordering exists to make cheap.
    expect(hoisted.folder.has(ESCROW)).toBe(true);
    expect(hoisted.folder.get(BLOB)!.content).toBe(before);
    expect((await loadBackupSettings(OWNER)).tier).toBeNull();
    expect((await scanBackup({ ownerId: OWNER, localIds: new Set() })).ok).toBe(true);
  });

  it('still counts as done when only the delete fails, and sweeps it next run', async () => {
    await run(BackupTier.Standard, [row('a')]);
    hoisted.failRemove = true;

    const result = await upgradeToExtra({ ownerId: OWNER, records: [], key: NEW_KEY });
    expect(result.ok).toBe(true);
    // The blob is already sealed under a key Google does not hold, which is the
    // promise; the file left behind opens nothing, because a restore reads the
    // blob's tier and not the folder's contents.
    expect(result.ok && result.state.escrowCleared).toBe(false);
    expect(hoisted.folder.has(ESCROW)).toBe(true);
    expect((await loadBackupSettings(OWNER)).tier).toBe(BackupTier.Extra);

    hoisted.failRemove = false;
    expect((await run(BackupTier.Extra)).ok).toBe(true);
    expect(hoisted.folder.has(ESCROW)).toBe(false);
  });

  it('works from nothing at all, sealing the ledger in hand', async () => {
    // Somebody who links an account and turns Extra protection on before a
    // single backup has run. There is no body to re-seal, so the live ledger is
    // what goes up — the same bytes an ordinary run would have sent.
    const result = await upgradeToExtra({
      ownerId: OWNER,
      records: [row('a')],
      key: NEW_KEY,
    });
    expect(result.ok).toBe(true);
    expect(envelope().tier).toBe(BackupTier.Extra);
    expect(hoisted.folder.has(ESCROW)).toBe(false);
  });
});
