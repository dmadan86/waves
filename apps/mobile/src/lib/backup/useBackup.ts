/**
 * The backup screen's whole state, in one hook.
 *
 * A React seam over three things that are not React — the settings on disk, the
 * OAuth tokens in the keystore, and the engine — plus the one thing that is: the
 * ledger itself, which only the mirror can produce. Kept out of the provider
 * tree on purpose. A backup is a settings screen and a once-a-day check, not
 * something every screen in the app needs a context for, and the app's provider
 * stack is already fifteen deep.
 *
 * A restore writes through the ordinary offline queue (`personal.upsert`), not
 * around it: the record ids in the backup are the same client-chosen ids that
 * are already the idempotency key, so restored rows converge with whatever the
 * server has exactly as a row typed on another phone would. That also means a
 * restore works with no connection at all — the rows land locally and leave when
 * the queue next drains, which is the ADR-005 promise applied to the one moment
 * people are least likely to have signal: setting up a new phone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { MutationKind, personalScope } from '@waves/core';

import { usePersonalRecordIds, usePersonalRecords } from '@/data/personal';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/sync';

import { providerFor } from '../cloud/providers';
import { loadTokens, saveTokens } from '../cloud/tokens';
import type { CloudTokens } from '../cloud/types';
import type { SyncNetworkPreference } from '../syncNetwork';
import {
  clearBackupState,
  PRIMARY_PROVIDER,
  runBackup,
  scanBackup,
  upgradeToExtra,
  type BackupPhase,
  type BackupRefusal,
  type RestoreScan,
} from './engine';
import {
  bytesToHex,
  loadRecoveryKey,
  mintRecoveryKey,
  parseRecoveryKey,
  saveRecoveryKey,
} from './recoveryKey';
import { BackupFrequency } from './schedule';
import {
  loadBackupSettings,
  markKeySeen,
  NO_BACKUP_SETTINGS,
  saveFrequency,
  saveLastBackup,
  saveNetwork,
  saveTier,
  type BackupSettings,
} from './settings';
import { backupStanding, BackupTier, resolveTier, type BackupStanding } from './tier';

/** What the screen says after a run: nothing yet, done, or a named refusal. */
export type BackupOutcome =
  | { readonly kind: 'ok'; readonly records: number }
  | { readonly kind: 'refused'; readonly refusal: BackupRefusal };

export interface BackupState {
  /**
   * True only while the three local reads are in flight. Deliberately not the
   * account-address lookup: nothing the screen decides may wait on a network
   * call that has no timeout.
   */
  readonly loading: boolean;
  readonly settings: BackupSettings;
  /** False when this build has no OAuth client id — everything else is inert. */
  readonly configured: boolean;
  /** True when a Drive account is linked. */
  readonly connected: boolean;
  /** The linked account's address, or null when Drive would not say. */
  readonly account: string | null;
  /** True when this device holds the recovery key. */
  readonly hasKey: boolean;
  /**
   * Which tier this account is on. Resolved once from what is stored and what
   * this phone holds, then written down — see `tier.ts` for the one-time
   * migration that carries pre-tier users onto Extra protection.
   */
  readonly tier: BackupTier;
  /** How many personal records a backup would carry right now. */
  readonly recordCount: number;
  /**
   * The three questions the sign-out guard and the sign-in restore prompt need
   * answering, in one value and with no knowledge of tiers or Drive: is there
   * anything not yet backed up, when did the last one land, and would a restore
   * on a new phone have to ask for a key.
   */
  readonly standing: BackupStanding;
  /** Non-null while a backup is running. */
  readonly phase: BackupPhase | null;
  /** The result of the last run this session. */
  readonly outcome: BackupOutcome | null;
}

export interface BackupActions {
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  backupNow: () => Promise<BackupOutcome>;
  setFrequency: (frequency: BackupFrequency) => Promise<void>;
  setNetwork: (network: SyncNetworkPreference) => Promise<void>;
  /** Mint a key for this device and hand back its hex, for showing once. */
  createKey: () => Promise<string>;
  /**
   * Mint the key that Extra protection will be turned on with, and hand back
   * its hex for showing. Stores nothing: until the person says they have kept
   * it, the account is still Standard and this key exists only on screen.
   */
  beginExtra: () => string;
  /**
   * Do the upgrade with the key `beginExtra` produced: re-seal the backup under
   * it, then take Drive's copy of the old key away. Never the other way round.
   */
  commitExtra: (keyHex: string) => Promise<BackupOutcome>;
  /** The key this device holds, as hex, or null. For "show it to me again". */
  revealKey: () => Promise<string | null>;
  /** Accept a key typed in from another device. False when it is not a key. */
  acceptKey: (input: string) => Promise<boolean>;
  /** Confirm the key has been written down. Backups refuse until this is set. */
  confirmKeySeen: () => Promise<void>;
  /** Read the Drive backup and say what restoring it would write. */
  scan: () => Promise<RestoreScan>;
  /** Queue the planned upserts. Returns how many were written. */
  applyRestore: (scan: Extract<RestoreScan, { ok: true }>) => Promise<number>;
}

export function useBackup(): BackupState & BackupActions {
  const { session } = useAuth();
  const { mutate, flush } = useSync();
  const ownerId = session?.user?.id ?? '';
  const records = usePersonalRecords();
  const localIds = usePersonalRecordIds();

  /**
   * Whose local reads have landed, rather than a boolean somebody has to
   * remember to raise again. `loading` is then derived, so switching accounts
   * re-arms it for free: the moment `ownerId` changes it stops matching, and
   * the screen goes back to "Checking…" instead of showing the previous
   * person's answers under the new person's name.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== ownerId;
  const [settings, setSettings] = useState<BackupSettings>(NO_BACKUP_SETTINGS);
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [phase, setPhase] = useState<BackupPhase | null>(null);
  const [outcome, setOutcome] = useState<BackupOutcome | null>(null);

  const provider = providerFor(PRIMARY_PROVIDER);
  const configured = provider.isConfigured();

  /**
   * The tier, resolved from the stored value and this phone's key.
   *
   * `settings.tier` is written the first time the effect below runs, so this
   * falls back to the inference only for the frame before that lands — and the
   * inference and the write agree, so the screen never flickers between tiers.
   */
  const tier = resolveTier(settings.tier, hasKey);

  /**
   * How many records were created after the last backup landed.
   *
   * Creation time is the only timestamp the mirror rows carry, so this counts
   * additions and nothing else — see `backupStanding` for what that does and
   * does not let the caller claim. Memoised because it walks the whole ledger
   * and the ledger changes far less often than this hook renders.
   */
  const newSince = useMemo(() => {
    const since = settings.last?.at ?? null;
    if (since === null) return records.length;
    return records.filter((row) => Date.parse(row.created_at) > since).length;
  }, [records, settings.last?.at]);

  const standing = backupStanding({
    tier,
    keySeen: settings.keySeen,
    connected,
    lastAt: settings.last?.at ?? null,
    lastRecords: settings.last?.records ?? 0,
    recordCount: records.length,
    newSince,
  });

  /**
   * Whether an account is linked, from the tokens on disk. A local read and
   * nothing else — no network — because this is the answer the screen decides
   * its whole layout with.
   */
  const refreshLink = useCallback(async (): Promise<CloudTokens | null> => {
    const tokens = ownerId ? await loadTokens(PRIMARY_PROVIDER, ownerId) : null;
    setConnected(tokens !== null);
    if (!tokens) setAccount(null);
    return tokens;
  }, [ownerId]);

  /**
   * Ask Drive whose account it is, and never wait for the answer.
   *
   * The address is a nicety — the screen falls back to the provider's own name
   * — so nothing may be blocked on it. It used to be awaited inside the first
   * load, which meant `loading` stayed true for the length of a Drive round
   * trip; `lib/cloud/http` puts no timeout on `fetch` and Android's OkHttp
   * defaults to none, so a socket that connects and never answers left the
   * screen saying "Checking…" with no controls, indefinitely. Fired and
   * forgotten, the worst it can now do is leave one line reading
   * "Google Drive" instead of an address.
   */
  const fillAddress = useCallback((tokens: CloudTokens | null): void => {
    if (!tokens) return;
    void providerFor(PRIMARY_PROVIDER)
      .account(tokens)
      .then(
        (address) => setAccount(address),
        () => setAccount(null),
      );
  }, []);

  // Everything below is keyed by the signed-in account, so a sign-out or a
  // switch has to re-read rather than keep showing what the previous person
  // had linked. `ownerId` in the dependency list is what makes that happen.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [stored, key, tokens] = await Promise.all([
        loadBackupSettings(ownerId),
        ownerId ? loadRecoveryKey(ownerId) : Promise.resolve(null),
        ownerId ? loadTokens(PRIMARY_PROVIDER, ownerId) : Promise.resolve(null),
      ]);
      if (!alive) return;
      // The one-time migration. A phone that set a backup up under the build
      // before tiers has a key and no stored tier, and that key *is* Extra
      // protection; a phone with neither is a fresh setup and gets the default.
      // The answer is written down as soon as it is worked out, so from here on
      // the tier is state and never an inference — including for the sign-out
      // guard, which reads the settings without a keystore of its own.
      const tier = resolveTier(stored.tier, key !== null);
      if (ownerId && stored.tier === null) {
        await saveTier(ownerId, tier).catch(() => undefined);
      }
      if (!alive) return;
      setSettings({ ...stored, tier });
      setHasKey(key !== null);
      setConnected(tokens !== null);
      if (!tokens) setAccount(null);
      // Three local reads, and the screen knows everything it decides with —
      // in the same batch as the values, so there is no frame where the screen
      // believes it has settled on somebody else's answers.
      setLoadedFor(ownerId);
      if (tokens) fillAddress(tokens);
    })();
    return () => {
      alive = false;
    };
  }, [ownerId, fillAddress]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!ownerId) return false;
    const tokens = await provider.connect();
    // Null is a cancel — the person closed the consent page. Not an error, and
    // the caller must not dress it as one.
    if (!tokens) return false;
    await saveTokens(PRIMARY_PROVIDER, ownerId, tokens);
    // The link is what the caller is waiting on; the address arrives when it
    // arrives, so a slow Drive cannot hold the connect button down.
    fillAddress(await refreshLink());
    return true;
  }, [ownerId, provider, refreshLink, fillAddress]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!ownerId) return;
    const tokens = await loadTokens(PRIMARY_PROVIDER, ownerId);
    // Hand the grant back to Google as well as forgetting it here, so "not
    // connected" is true in their account settings too. Best effort: a failed
    // revoke must not leave the app still claiming a link it has dropped.
    if (tokens) await provider.revoke?.(tokens).catch(() => undefined);
    // Tokens, key and preferences together — the same wipe sign-out runs. The
    // recovery key goes with the link: keeping it would leave a key on the
    // phone for a file the app can no longer reach, and the person still has
    // their written copy, which is the only one that was ever load-bearing.
    await clearBackupState(ownerId);
    setSettings(NO_BACKUP_SETTINGS);
    setHasKey(false);
    setOutcome(null);
    await refreshLink();
  }, [ownerId, provider, refreshLink]);

  const backupNow = useCallback(async (): Promise<BackupOutcome> => {
    setOutcome(null);
    try {
      // No key is loaded here any more. Where it comes from depends on the tier
      // and on what is in the Drive folder, and the engine is the only place
      // that can see both — on Standard it will mint and escrow one rather than
      // refuse, which is the whole of the default tier's setup.
      const result = await runBackup({
        ownerId,
        records,
        tier,
        network: settings.network,
        manual: true,
        onPhase: setPhase,
      });
      if (!result.ok) {
        const refused: BackupOutcome = { kind: 'refused', refusal: result.refusal };
        setOutcome(refused);
        // A dead grant clears the tokens inside the engine; reflect that here so
        // the screen swaps to "Connect" instead of offering a retry that cannot
        // work.
        if (result.refusal === 'auth') await refreshLink();
        return refused;
      }
      await saveLastBackup(ownerId, result.last);
      setSettings((current) => ({ ...current, last: result.last }));
      // A Standard run may have minted the key itself; the screen's "this phone
      // holds a key" is only true after that, and nothing else would say so.
      setHasKey(true);
      const done: BackupOutcome = { kind: 'ok', records: result.last.records };
      setOutcome(done);
      return done;
    } finally {
      setPhase(null);
    }
  }, [ownerId, records, tier, settings.network, refreshLink]);

  const setFrequencyAction = useCallback(
    async (frequency: BackupFrequency): Promise<void> => {
      setSettings((current) => ({ ...current, frequency }));
      await saveFrequency(ownerId, frequency);
    },
    [ownerId],
  );

  const setNetworkAction = useCallback(
    async (network: SyncNetworkPreference): Promise<void> => {
      setSettings((current) => ({ ...current, network }));
      await saveNetwork(ownerId, network);
    },
    [ownerId],
  );

  const createKey = useCallback(async (): Promise<string> => {
    const key = mintRecoveryKey();
    await saveRecoveryKey(ownerId, key);
    setHasKey(true);
    return bytesToHex(key);
  }, [ownerId]);

  const revealKey = useCallback(async (): Promise<string | null> => {
    const key = ownerId ? await loadRecoveryKey(ownerId) : null;
    return key ? bytesToHex(key) : null;
  }, [ownerId]);

  const acceptKey = useCallback(
    async (input: string): Promise<boolean> => {
      const key = parseRecoveryKey(input);
      if (!key) return false;
      await saveRecoveryKey(ownerId, key);
      setHasKey(true);
      // A key typed in from elsewhere has self-evidently been kept somewhere,
      // so there is nothing left to warn this person about.
      await markKeySeen(ownerId);
      // And it declares the tier. Somebody typing a key in is holding one, and
      // leaving them on Standard would have the next run write `tier: standard`
      // into the envelope with no key escrowed beside it — a file that says a
      // key is in the folder when it is in their notebook, which a later
      // restore would read as "the key is lost".
      await saveTier(ownerId, BackupTier.Extra);
      setSettings((current) => ({ ...current, keySeen: true, tier: BackupTier.Extra }));
      return true;
    },
    [ownerId],
  );

  const confirmKeySeen = useCallback(async (): Promise<void> => {
    setSettings((current) => ({ ...current, keySeen: true }));
    await markKeySeen(ownerId);
  }, [ownerId]);

  /**
   * Mint the key Extra protection would be turned on with, and hand it back to
   * be shown. Nothing is written anywhere: back out of the sheet and the
   * account is untouched, still Standard, still opening with the key Drive
   * holds. The upgrade only starts at `commitExtra`.
   */
  const beginExtra = useCallback((): string => bytesToHex(mintRecoveryKey()), []);

  const commitExtra = useCallback(
    async (keyHex: string): Promise<BackupOutcome> => {
      const key = parseRecoveryKey(keyHex);
      // Only reachable if the hex we minted came back mangled, which would mean
      // the screen handed us something other than what it was given.
      if (!key || !ownerId) return { kind: 'refused', refusal: 'no-key' };
      const result = await upgradeToExtra({ ownerId, records, key });
      if (!result.ok) {
        const refused: BackupOutcome = { kind: 'refused', refusal: result.refusal };
        setOutcome(refused);
        if (result.refusal === 'auth') await refreshLink();
        return refused;
      }
      // The engine has already written the key and the tier; this is the screen
      // catching up with what is now true on disk. `keySeen` rides along
      // because the person confirmed keeping the key before any of it ran.
      await markKeySeen(ownerId);
      await saveLastBackup(ownerId, result.last);
      setHasKey(true);
      setSettings((current) => ({
        ...current,
        tier: BackupTier.Extra,
        keySeen: true,
        last: result.last,
      }));
      const done: BackupOutcome = { kind: 'ok', records: result.last.records };
      setOutcome(done);
      return done;
    },
    [ownerId, records, refreshLink],
  );

  const scan = useCallback(async (): Promise<RestoreScan> => {
    // The key question belongs to the engine here too, and on Standard it has a
    // better answer than this hook could give: the key is in the folder next to
    // the backup, so a phone that has never held one can still open it.
    return scanBackup({ ownerId, localIds });
  }, [ownerId, localIds]);

  const applyRestore = useCallback(
    async (result: Extract<RestoreScan, { ok: true }>): Promise<number> => {
      if (!ownerId) return 0;
      const scope = personalScope(ownerId);
      for (const record of result.plan.restore) {
        await mutate(MutationKind.PersonalUpsert, scope, {
          recordId: record.id,
          recordKind: record.kind,
          data: record.data,
        });
      }
      // Durable on disk already; this only asks the queue to leave sooner.
      void flush([scope]);
      return result.plan.restore.length;
    },
    [ownerId, mutate, flush],
  );

  return {
    loading,
    settings,
    configured,
    connected,
    account,
    hasKey,
    tier,
    standing,
    recordCount: records.length,
    phase,
    outcome,
    connect,
    disconnect,
    backupNow,
    setFrequency: setFrequencyAction,
    setNetwork: setNetworkAction,
    createKey,
    beginExtra,
    commitExtra,
    revealKey,
    acceptKey,
    confirmKeySeen,
    scan,
    applyRestore,
  };
}
