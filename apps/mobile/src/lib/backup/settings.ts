/**
 * What the phone remembers about backing up: how often, over which networks,
 * and when the last one landed.
 *
 * Device-local, in AsyncStorage, like theme and motion and the sync-network
 * choice — not on the server. ADR-005 keeps this kind of preference on the
 * phone, and there is a sharper reason here: the whole point of the feature is
 * that the backup is between the person and their own Drive. Recording on
 * Waves' servers how often they back up, and when they last did, would put a
 * shadow of the thing on the server anyway.
 *
 * Every key carries the owner id. These are device-wide preferences on a device
 * that is not always one person's, and "when did you last back up, and how
 * often do you" is a shape of somebody's life that the next person to sign in
 * on the same phone has no business inheriting.
 *
 * The network choice reuses `SyncNetworkPreference` rather than inventing a
 * second vocabulary for the same idea — same enum, same `networkAllows`
 * predicate, so the two can never disagree about what "Wi‑Fi only" means. It is
 * stored separately because it is a genuinely different decision: syncing a
 * shared ledger is a few hundred bytes on a change somebody is waiting to see,
 * and a backup is the whole ledger on a timer nobody is watching. Sync defaults
 * to any connection; backup defaults to Wi‑Fi.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { SyncNetworkPreference } from '../syncNetwork';
import { BackupFrequency, DEFAULT_FREQUENCY, parseFrequency } from './schedule';
import { BackupTier, parseTier } from './tier';

const FREQUENCY_KEY = 'waves.backup.frequency';
const NETWORK_KEY = 'waves.backup.network';
const LAST_KEY = 'waves.backup.last';
/** Set once the person has been shown their recovery key and confirmed it. */
const KEY_SEEN_KEY = 'waves.backup.key_seen';
/**
 * Which tier the account is on. Absent on a phone that set its backup up before
 * tiers existed, and on one that has never set anything up — two states that
 * are not the same, which is why `resolveTier` needs the key flag to tell them
 * apart, and why the caller writes the answer down the first time it asks.
 */
const TIER_KEY = 'waves.backup.tier';
/**
 * Set once this account has answered the dashboard's offer to restore — by
 * taking it or by declining it, which are the same answer to "shall I ask?".
 * It lives here rather than beside the prompt so it joins `ALL_KEYS` below and
 * is therefore wiped by sign-out, which is what bounds the dismissal to this
 * sign-in. See `restorePrompt.ts` for why that is the right boundary.
 */
const RESTORE_PROMPT_KEY = 'waves.backup.restore_prompt';

/** Every stored key, for the sign-out wipe. */
const ALL_KEYS = [
  FREQUENCY_KEY,
  NETWORK_KEY,
  LAST_KEY,
  KEY_SEEN_KEY,
  TIER_KEY,
  RESTORE_PROMPT_KEY,
] as const;

const scoped = (base: string, ownerId: string): string => `${base}.${ownerId}`;

/**
 * A backup is bigger and less urgent than a sync flush, so it holds for Wi‑Fi
 * unless somebody says otherwise. Only Wi‑Fi and Both are offered on the screen
 * — "mobile data only" is a coherent sync choice and an incoherent backup one.
 */
export const DEFAULT_BACKUP_NETWORK = SyncNetworkPreference.Wifi;

/** What the last successful backup was, for the "Last backup" line. */
export interface LastBackup {
  /** Epoch ms. */
  readonly at: number;
  /** Bytes actually uploaded — the sealed file, not the ledger in memory. */
  readonly size: number;
  /** How many records it held. */
  readonly records: number;
}

export interface BackupSettings {
  readonly frequency: BackupFrequency;
  readonly network: SyncNetworkPreference;
  readonly last: LastBackup | null;
  /** False until the recovery key has been shown and acknowledged. */
  readonly keySeen: boolean;
  /**
   * The tier as stored, or null when nothing has been stored yet. Deliberately
   * not resolved here: turning null into a tier needs to know whether this
   * phone holds a key, which is a keystore read this module does not do.
   */
  readonly tier: BackupTier | null;
}

function parseNetwork(raw: string | null): SyncNetworkPreference {
  return raw === SyncNetworkPreference.Wifi || raw === SyncNetworkPreference.Both
    ? raw
    : DEFAULT_BACKUP_NETWORK;
}

function parseLast(raw: string | null): LastBackup | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastBackup>;
    if (typeof parsed?.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    return {
      at: parsed.at,
      size: typeof parsed.size === 'number' && parsed.size >= 0 ? parsed.size : 0,
      records: typeof parsed.records === 'number' && parsed.records >= 0 ? parsed.records : 0,
    };
  } catch {
    return null;
  }
}

/** The defaults, for a signed-out caller or an account that has set nothing. */
export const NO_BACKUP_SETTINGS: BackupSettings = {
  frequency: DEFAULT_FREQUENCY,
  network: DEFAULT_BACKUP_NETWORK,
  last: null,
  keySeen: false,
  tier: null,
};

export async function loadBackupSettings(ownerId: string): Promise<BackupSettings> {
  if (!ownerId) return NO_BACKUP_SETTINGS;
  const [frequency, network, last, keySeen, tier] = await Promise.all([
    AsyncStorage.getItem(scoped(FREQUENCY_KEY, ownerId)).catch(() => null),
    AsyncStorage.getItem(scoped(NETWORK_KEY, ownerId)).catch(() => null),
    AsyncStorage.getItem(scoped(LAST_KEY, ownerId)).catch(() => null),
    AsyncStorage.getItem(scoped(KEY_SEEN_KEY, ownerId)).catch(() => null),
    AsyncStorage.getItem(scoped(TIER_KEY, ownerId)).catch(() => null),
  ]);
  return {
    frequency: parseFrequency(frequency),
    network: parseNetwork(network),
    last: parseLast(last),
    keySeen: keySeen === '1',
    tier: parseTier(tier),
  };
}

/**
 * Write the tier down.
 *
 * Unlike the frequency and the network, the default is stored rather than
 * elided. "Standard" and "nothing here yet" have to stay distinguishable: the
 * second one is what an account carried over from the pre-tier build looks
 * like, and collapsing them would put every one of those people on Standard —
 * silently downgrading a key they were told nobody else would ever hold.
 */
export async function saveTier(ownerId: string, tier: BackupTier): Promise<void> {
  if (!ownerId) return;
  await AsyncStorage.setItem(scoped(TIER_KEY, ownerId), tier);
}

export async function saveFrequency(ownerId: string, frequency: BackupFrequency): Promise<void> {
  if (!ownerId) return;
  const key = scoped(FREQUENCY_KEY, ownerId);
  // Storing the default is the same as storing nothing, so a reset-to-default
  // and a fresh install look identical — the same rule `syncNetwork` follows.
  if (frequency === DEFAULT_FREQUENCY) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, frequency);
}

export async function saveNetwork(ownerId: string, network: SyncNetworkPreference): Promise<void> {
  if (!ownerId) return;
  const key = scoped(NETWORK_KEY, ownerId);
  if (network === DEFAULT_BACKUP_NETWORK) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, network);
}

export async function saveLastBackup(ownerId: string, last: LastBackup): Promise<void> {
  if (!ownerId) return;
  await AsyncStorage.setItem(scoped(LAST_KEY, ownerId), JSON.stringify(last));
}

export async function markKeySeen(ownerId: string): Promise<void> {
  if (!ownerId) return;
  await AsyncStorage.setItem(scoped(KEY_SEEN_KEY, ownerId), '1');
}

/**
 * Whether the restore offer has been answered for this account on this device.
 *
 * Deliberately not folded into `BackupSettings`: that object is read by the
 * Backup screen and the sign-out guard on every open, and neither of them has
 * any business knowing what the dashboard has already asked. A one-key read is
 * also all the dashboard wants, and it wants it before it paints.
 */
export async function loadRestorePromptDismissed(ownerId: string): Promise<boolean> {
  if (!ownerId) return false;
  const raw = await AsyncStorage.getItem(scoped(RESTORE_PROMPT_KEY, ownerId)).catch(() => null);
  return raw === '1';
}

export async function markRestorePromptDismissed(ownerId: string): Promise<void> {
  if (!ownerId) return;
  await AsyncStorage.setItem(scoped(RESTORE_PROMPT_KEY, ownerId), '1');
}

/**
 * Forget everything this device remembered about `ownerId` backing up. Called
 * on unlink and on sign-out, alongside the token and key wipes — the Drive file
 * is untouched, since it is the user's and the point of it is to outlive the
 * app's state.
 *
 * Every key is attempted even after one fails, and the first failure is then
 * rethrown: a wipe that stopped halfway is worse than one that reports.
 */
export async function clearBackupSettings(ownerId: string): Promise<void> {
  if (!ownerId) return;
  const failures = await Promise.all(
    ALL_KEYS.map((base) =>
      AsyncStorage.removeItem(scoped(base, ownerId)).then(
        () => null,
        (error: unknown) => error,
      ),
    ),
  );
  const first = failures.find((error) => error !== null);
  if (first !== undefined) throw first;
}
