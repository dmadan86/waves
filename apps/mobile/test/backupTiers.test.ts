/**
 * The tier arithmetic: which promise an account is on, which key opens what,
 * and the one ordering rule the upgrade must never break.
 *
 * All of it pure, which is the point of putting it in `tier.ts` rather than in
 * the engine — the mobile suite has no renderer and no network, and these are
 * exactly the decisions that would otherwise only be exercised by a person on a
 * new phone at the worst moment of their week.
 */

import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildFile,
  fileTier,
  parseFile,
} from '../src/lib/backup/payload';
import {
  advanceUpgrade,
  backupStanding,
  BackupTier,
  buildEscrow,
  DEFAULT_TIER,
  escrowFileName,
  EscrowFormatError,
  ESCROW_FORMAT,
  keyForBackup,
  keyForRestore,
  KeySource,
  mayClearEscrow,
  parseEscrow,
  parseTier,
  resolveTier,
  tierAllowsBackup,
  UPGRADE_START,
  UpgradeStage,
  type UpgradeState,
} from '../src/lib/backup/tier';

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const KEY_HEX = '11'.repeat(32);

describe('which tier somebody is on', () => {
  it('defaults a fresh account to Standard, which is the whole point', () => {
    expect(DEFAULT_TIER).toBe(BackupTier.Standard);
    expect(resolveTier(null, false)).toBe(BackupTier.Standard);
  });

  it('carries a pre-tier user onto Extra protection, because that is what they have', () => {
    // The migration, and the only inference in the module. A phone that set a
    // backup up under the build before tiers has a key in its keystore and
    // nothing stored about tiers; that key *is* Extra protection, and reading
    // it as Standard would silently promise that Google could recover a backup
    // Google has never had the key to.
    expect(resolveTier(null, true)).toBe(BackupTier.Extra);
  });

  it('lets the stored answer win over the phone, both ways round', () => {
    // Once written down it is state, not a guess — including for the account
    // that turned Extra protection on and then had its keystore cleared, and
    // for a Standard phone that holds a minted key.
    expect(resolveTier(BackupTier.Extra, false)).toBe(BackupTier.Extra);
    expect(resolveTier(BackupTier.Standard, true)).toBe(BackupTier.Standard);
  });

  it('reads a stored value it does not recognise as nothing stored', () => {
    expect(parseTier('gold')).toBeNull();
    expect(parseTier(null)).toBeNull();
    expect(parseTier(BackupTier.Standard)).toBe(BackupTier.Standard);
  });
});

describe('the "have you kept it?" gate', () => {
  it('still holds every Extra backup until the key has been acknowledged', () => {
    expect(tierAllowsBackup(BackupTier.Extra, false)).toBe(false);
    expect(tierAllowsBackup(BackupTier.Extra, true)).toBe(true);
  });

  it('does not apply on Standard, where there is nothing to have kept', () => {
    expect(tierAllowsBackup(BackupTier.Standard, false)).toBe(true);
  });
});

describe('an existing device-only backup', () => {
  it('reads as Extra protection, because a file with no tier had no escrow', () => {
    // The compatibility claim this whole change rests on. Every envelope the
    // first build wrote looked exactly like this, and it must keep opening.
    const legacy = parseFile(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        alg: 'xchacha20poly1305',
        createdAt: '2026-09-01T00:00:00.000Z',
        sealed: 'v1:whatever',
      }),
    );
    expect(legacy.tier).toBeUndefined();
    expect(fileTier(legacy)).toBe(BackupTier.Extra);
  });

  it('is not made unreadable by the new field — the version did not move', () => {
    // Bumping the version would have changed `backupAad` and broken the AEAD on
    // every file already out there. The tier is an added optional field instead.
    expect(BACKUP_VERSION).toBe(1);
    expect(parseFile(JSON.stringify(buildFile('v1:x', '', BackupTier.Standard))).version).toBe(1);
  });

  it('falls back to Extra for a tier this build does not know', () => {
    // Safe in the right direction: it asks for a key that may not be needed
    // rather than promising a restore that cannot happen.
    const odd = parseFile(
      JSON.stringify({ ...buildFile('v1:x', '', BackupTier.Standard), tier: 'platinum' }),
    );
    expect(fileTier(odd)).toBe(BackupTier.Extra);
  });
});

describe('the escrow file', () => {
  it('is named beside the blob and scoped to the owner', () => {
    // Two Waves accounts can link one Google account, and one shared name would
    // hand the second of them the key to the first one's ledger.
    expect(escrowFileName(OWNER)).toContain(OWNER);
    expect(escrowFileName(OWNER)).not.toBe(escrowFileName('bbbbbbbb-2222-4222-8222-b'));
  });

  it('round-trips', () => {
    const file = buildEscrow(KEY_HEX, '2026-09-10T00:00:00.000Z');
    expect(file.format).toBe(ESCROW_FORMAT);
    expect(parseEscrow(JSON.stringify(file))).toEqual(file);
  });

  it('refuses anything that is not ours, or is newer than us', () => {
    expect(() => parseEscrow('not json')).toThrow(EscrowFormatError);
    expect(() => parseEscrow(JSON.stringify({ format: 'other', version: 1 }))).toThrow(
      EscrowFormatError,
    );
    expect(() => parseEscrow(JSON.stringify({ ...buildEscrow(KEY_HEX, ''), version: 99 }))).toThrow(
      EscrowFormatError,
    );
    expect(() => parseEscrow(JSON.stringify({ ...buildEscrow(KEY_HEX, ''), key: '' }))).toThrow(
      EscrowFormatError,
    );
  });
});

describe('where the key for the next backup comes from', () => {
  const at = (over: Partial<Parameters<typeof keyForBackup>[0]> = {}) =>
    keyForBackup({
      tier: BackupTier.Standard,
      hasDeviceKey: false,
      remoteTier: null,
      hasEscrow: false,
      ...over,
    });

  it('mints one on Standard when the folder is empty — no screen, no ceremony', () => {
    expect(at()).toBe(KeySource.Mint);
  });

  it('prefers the escrowed key over this phone’s, so a half-upgrade heals itself', () => {
    // The upgrade writes the new key to the keystore before it re-seals
    // anything. A phone that died in between holds a key that opens nothing
    // while Drive still holds the one that does; preferring the folder throws
    // the stale copy away and everything keeps working.
    expect(at({ hasDeviceKey: true, hasEscrow: true })).toBe(KeySource.Escrow);
  });

  it('mints on Standard when no escrow can be read, even if this phone has a key', () => {
    // A Standard backup sealed only under a device key is an Extra backup nobody
    // opted into. Missing/corrupt escrow must be repaired before upload.
    expect(at({ hasDeviceKey: true, hasEscrow: false })).toBe(KeySource.Mint);
  });

  it('uses this phone’s key on Extra, and asks the person when there is none', () => {
    expect(at({ tier: BackupTier.Extra, hasDeviceKey: true })).toBe(KeySource.Device);
    expect(at({ tier: BackupTier.Extra, hasDeviceKey: false })).toBe(KeySource.AskPerson);
  });

  it('never mints on Extra, however empty the folder is', () => {
    // Minting a second key there would seal the next backup away from the key
    // the person is holding — and overwrite the one it opens.
    expect(at({ tier: BackupTier.Extra, hasEscrow: true })).toBe(KeySource.AskPerson);
  });
});

describe('where the key for a backup we found comes from', () => {
  const at = (over: Partial<Parameters<typeof keyForRestore>[0]>) =>
    keyForRestore({
      tier: BackupTier.Standard,
      hasDeviceKey: false,
      remoteTier: BackupTier.Standard,
      hasEscrow: false,
      ...over,
    });

  it('reads the file’s tier, not the phone’s', () => {
    // A phone freshly signed in has whatever tier its defaults gave it. The
    // blob knows what sealed it, and the blob wins.
    expect(at({ tier: BackupTier.Standard, remoteTier: BackupTier.Extra, hasEscrow: true })).toBe(
      KeySource.AskPerson,
    );
  });

  it('restores a Standard backup from the escrowed key with nothing asked', () => {
    expect(at({ hasEscrow: true })).toBe(KeySource.Escrow);
  });

  it('tells "type your key" apart from "this can never be opened"', () => {
    // Two different pieces of news. An extra-protection blob is waiting for
    // something the person has; a standard blob whose key file is gone (Drive
    // offers "Delete hidden app data", and it deletes exactly this) is waiting
    // for nothing at all, and saying "enter your key" would be cruel.
    expect(at({ remoteTier: BackupTier.Extra })).toBe(KeySource.AskPerson);
    expect(at({ remoteTier: BackupTier.Standard })).toBe(KeySource.Lost);
  });
});

describe('turning Extra protection on', () => {
  const run = (outcomes: readonly ('ok' | 'failed')[]): UpgradeState =>
    outcomes.reduce(advanceUpgrade, UPGRADE_START);

  it('walks confirm, re-seal, escrow, done — in that order', () => {
    expect(run(['ok']).stage).toBe(UpgradeStage.Reseal);
    expect(run(['ok', 'ok']).stage).toBe(UpgradeStage.Escrow);
    expect(run(['ok', 'ok', 'ok']).stage).toBe(UpgradeStage.Done);
  });

  it('will not let the escrowed key be deleted before the re-seal has landed', () => {
    // The single rule the module exists to enforce. Deleting Google's copy of
    // the key while the blob it opens is still sitting beside it would be a lie
    // about the promise made one screen earlier.
    expect(mayClearEscrow(UPGRADE_START)).toBe(false);
    expect(mayClearEscrow(run(['ok']))).toBe(false);
    expect(mayClearEscrow(run(['ok', 'ok']))).toBe(true);
  });

  it('leaves everything alone when the re-seal fails', () => {
    const failed = run(['ok', 'failed']);
    expect(failed.failedAt).toBe(UpgradeStage.Reseal);
    expect(failed.resealed).toBe(false);
    expect(failed.escrowCleared).toBe(false);
    expect(failed.tier).toBe(BackupTier.Standard);
    expect(mayClearEscrow(failed)).toBe(false);
  });

  it('cannot be walked past a failure', () => {
    const failed = run(['ok', 'failed', 'ok', 'ok']);
    expect(failed.stage).toBe(UpgradeStage.Reseal);
    expect(failed.escrowCleared).toBe(false);
  });

  it('flips the tier at the re-seal, not at the delete', () => {
    // By then the blob is sealed under a key Drive does not have, which is the
    // promise. The file left behind opens nothing, and a screen that still said
    // "Standard" over it would be the same lie in the other direction.
    expect(run(['ok', 'ok']).tier).toBe(BackupTier.Extra);
    const leftover = run(['ok', 'ok', 'failed']);
    expect(leftover.tier).toBe(BackupTier.Extra);
    expect(leftover.escrowCleared).toBe(false);
  });
});

describe('what the sign-out guard will ask', () => {
  const standing = (over: Partial<Parameters<typeof backupStanding>[0]> = {}) =>
    backupStanding({
      tier: BackupTier.Standard,
      keySeen: false,
      connected: true,
      lastAt: 1_757_000_000_000,
      lastRecords: 12,
      recordCount: 12,
      newSince: 0,
      ...over,
    });

  it('says a restore needs no key on Standard, and does on Extra', () => {
    expect(standing().restoreNeedsKey).toBe(false);
    expect(standing({ tier: BackupTier.Extra }).restoreNeedsKey).toBe(true);
  });

  it('is up to date only when nothing has been added and nothing removed', () => {
    expect(standing().upToDate).toBe(true);
    expect(standing({ newSince: 3, recordCount: 15 }).upToDate).toBe(false);
    // A delete moves the count without moving anything into `newSince`.
    expect(standing({ recordCount: 11 }).upToDate).toBe(false);
  });

  it('is never up to date before the first backup', () => {
    const never = standing({ lastAt: null, lastRecords: 0, recordCount: 4, newSince: 4 });
    expect(never.everBackedUp).toBe(false);
    expect(never.upToDate).toBe(false);
    expect(never.newSince).toBe(4);
  });

  it('knows a backup cannot run with no account linked, or no key acknowledged', () => {
    expect(standing({ connected: false }).canBackUp).toBe(false);
    expect(standing({ tier: BackupTier.Extra, keySeen: false }).canBackUp).toBe(false);
    expect(standing({ tier: BackupTier.Extra, keySeen: true }).canBackUp).toBe(true);
  });
});
