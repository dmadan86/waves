/**
 * The pump: take the personal ledger, seal it, put it in the user's Drive — and
 * on the way back, fetch it, open it, and say what a restore would write.
 *
 * No React and no hooks, so the whole flow can be reasoned about (and most of
 * it tested) without a renderer. What it does not own is *what* to back up: the
 * records come in from the caller, because the only honest source for them is
 * the mirror with the offline queue replayed on top, and that is a hook.
 *
 * Two kinds of "did not happen" are kept apart on purpose. A **refusal** is a
 * state the person can act on — no Drive connected, no key, holding for Wi‑Fi —
 * and is returned as a value so the screen can say which one in their own
 * words. A **failure** is a thrown error carrying a provider message that must
 * never reach a screen; it goes through `friendlyError` at the call site, which
 * reports the original and returns a sentence.
 *
 * WHERE THE KEY COMES FROM is now the engine's problem rather than the
 * caller's, because the answer depends on things only the engine can see. On
 * **Extra protection** it is the device's key or nothing. On **Standard** it is
 * the escrowed copy in the appDataFolder, adopted onto this device on the way
 * past — and minted and put there if the folder is empty. That is what makes
 * the default tier ceremony-free: a new phone that signs into the same Google
 * account finds the key sitting beside the blob and opens it with no screen in
 * between. `tier.ts` holds the decision table and the reasoning; this file does
 * the I/O the table asks for.
 *
 * Under Standard the escrow costs one extra `find` per run, alongside the one
 * for the blob and issued at the same time. That is one small list request on a
 * path that runs at most daily, in exchange for two phones on one Google
 * account never sealing their backups under different keys.
 */

import * as Network from 'expo-network';

import { networkAllows, type SyncNetworkPreference } from '../syncNetwork';
import { reportHandled } from '../observability';
import { isAuthFailure } from '../cloud/http';
import { providerFor } from '../cloud/providers';
import { clearTokens, loadTokens, saveTokens } from '../cloud/tokens';
import type { CloudFile, CloudProvider, CloudProviderId, CloudTokens } from '../cloud/types';
import {
  backupAad,
  buildBody,
  buildFile,
  fileTier,
  parseBody,
  parseFile,
  planRestore,
  type BackupBody,
  type BackupFile,
  type RestorePlan,
  type SourceRecord,
} from './payload';
import {
  backupNonce,
  bytesToHex,
  clearRecoveryKey,
  loadRecoveryKey,
  mintRecoveryKey,
  openBackup,
  parseRecoveryKey,
  saveRecoveryKey,
  sealBackup,
} from './recoveryKey';
import { clearBackupSettings, saveTier, type LastBackup } from './settings';
import {
  advanceUpgrade,
  BackupTier,
  buildEscrow,
  escrowFileName,
  EscrowFormatError,
  keyForBackup,
  keyForRestore,
  KeySource,
  mayClearEscrow,
  parseEscrow,
  UPGRADE_START,
  type UpgradeState,
} from './tier';

/**
 * The one file in the provider's app-private storage, per account. Overwritten
 * in place, so the appDataFolder never accumulates.
 *
 * The owner id is in the name because scoping the *local* keys is not enough:
 * two different Waves accounts that link the same Google account share one
 * appDataFolder, and a fixed filename would have the second silently overwrite
 * the first's backup — sealed under a key whose AAD no longer matches, so the
 * first person could never open what was left of theirs. Nothing has ever run
 * against Google (this build has no OAuth client ids), so there is no old
 * fixed-name file anywhere to migrate; a shipped build would have needed one.
 */
export function backupFileName(ownerId: string): string {
  // The id is a UUID from Supabase, but the name goes into a Drive query, so it
  // is narrowed here rather than trusted to stay one.
  const safe = ownerId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `waves-personal-backup-${safe}.json`;
}

/** Only Drive today; named so the rest of the module never hardcodes it. */
export const PRIMARY_PROVIDER: CloudProviderId = 'gdrive';

/** Where a run has got to, for the progress line under "Back up now". */
export type BackupPhase = 'collecting' | 'sealing' | 'uploading';

/** A run that did not happen, and why — each one has a different way out. */
export type BackupRefusal =
  /** Another run is already going. */
  | 'busy'
  /** This build has no OAuth client id for the provider. */
  | 'not-configured'
  /** No Drive account linked. */
  | 'not-connected'
  /** No recovery key on this device — nothing to seal (or open) with. */
  | 'no-key'
  /** The backup on Drive is under extra protection and only the person has its key. */
  | 'needs-key'
  /** A standard backup whose escrowed key is no longer in the Drive folder. */
  | 'key-lost'
  /** No usable connection at all. */
  | 'offline'
  /** Connected, but not over a network the person allows backups on. */
  | 'network-policy'
  /** The stored tokens were rejected; the link has to be made again. */
  | 'auth'
  /** Nothing on Drive to restore from. */
  | 'no-backup';

export type BackupResult =
  | { readonly ok: true; readonly last: LastBackup }
  | { readonly ok: false; readonly refusal: BackupRefusal };

export interface BackupRunInput {
  readonly ownerId: string;
  readonly records: readonly SourceRecord[];
  /**
   * Which promise this account's backup makes. Decides where the key comes
   * from, what goes in the envelope, and whether a copy of the key is left in
   * the Drive folder — see `tier.ts`.
   */
  readonly tier: BackupTier;
  readonly network: SyncNetworkPreference;
  /**
   * True for "Back up now". A person tapping the button has made the data-plan
   * decision themselves, so the Wi‑Fi gate is not applied to them — it exists to
   * stop the *automatic* schedule spending mobile data unasked. Being offline
   * still stops both: there is nowhere for the bytes to go.
   */
  readonly manual: boolean;
  readonly onPhase?: (phase: BackupPhase) => void;
}

// One run at a time, process-wide. The automatic check and a button press can
// land together (the app foregrounds, the person taps immediately), and two
// concurrent writes to one Drive file is a lost update at best.
let running = false;

/** Whether a run is in flight — the screen disables the button on it. */
export function isRunning(): boolean {
  return running;
}

async function connection(): Promise<{ online: boolean; type: Network.NetworkStateType | null }> {
  try {
    const state = await Network.getNetworkStateAsync();
    return {
      // `isInternetReachable` is undefined on some platforms; a connected
      // interface is the best signal there, and a dead request fails anyway.
      online: state.isInternetReachable ?? state.isConnected ?? true,
      type: state.type ?? null,
    };
  } catch {
    // Fail open, like the sync engine: better an attempt that fails than a
    // backup silently never running because the network module would not say.
    return { online: true, type: null };
  }
}

/**
 * The three answers to "can we talk to the provider right now", kept apart.
 *
 * `none` and `auth` used to be the same answer, because the refresh was wrapped
 * in a `.catch(() => null)`: a refresh token the user had revoked came back as
 * "nothing is linked", the dead tokens stayed on disk, and the screen offered
 * connect-from-scratch as the remedy for a link that needed re-authorising.
 * Two different states with two different ways out, so: two values.
 */
type TokenLookup =
  | { readonly kind: 'ok'; readonly tokens: CloudTokens }
  | { readonly kind: 'none' }
  | { readonly kind: 'auth' };

/**
 * Tokens good to use now, refreshed if stale and written back so the next run
 * starts from the fresh pair.
 *
 * Throws for a transport failure — a token endpoint that timed out is not a
 * dead link, and the caller launders the message before anybody sees it.
 */
async function freshTokens(id: CloudProviderId, ownerId: string): Promise<TokenLookup> {
  const stored = await loadTokens(id, ownerId);
  if (!stored) return { kind: 'none' };
  try {
    const tokens = await providerFor(id).ensureValid(stored);
    if (tokens !== stored) await saveTokens(id, ownerId, tokens);
    return { kind: 'ok', tokens };
  } catch (error) {
    if (!isAuthFailure(error)) throw error;
    // The grant is gone for good. Drop the tokens so the screen stops offering
    // a retry that cannot work, and say which of the two states this is.
    await clearTokens(id, ownerId).catch(() => undefined);
    return { kind: 'auth' };
  }
}

/**
 * Everything this device remembers about one account's backups: the provider
 * tokens, the recovery key, and the schedule / last-backup / key-seen
 * preferences.
 *
 * Called on unlink and — the case that matters — from the sign-out wipe in
 * `sync/provider.tsx`. Until this existed, B signing in after A on a shared
 * phone found A's Google account linked, held A's recovery key, and inherited
 * A's schedule; worse, B's first backup would have found A's file and
 * overwritten it. Every piece is attempted even after one fails and the first
 * failure is rethrown, matching `clearLocalPrivateData`: a credential left
 * behind by a half-finished wipe is a privacy problem, not a cosmetic one.
 *
 * The file on Drive is deliberately untouched. It is the user's, it is
 * unreadable without the key they wrote down, and the point of it is to outlive
 * this app's state.
 */
export async function clearBackupState(ownerId: string): Promise<void> {
  if (!ownerId) return;
  const failures: unknown[] = [];
  await clearTokens(PRIMARY_PROVIDER, ownerId).catch((error: unknown) => failures.push(error));
  await clearRecoveryKey(ownerId).catch((error: unknown) => failures.push(error));
  await clearBackupSettings(ownerId).catch((error: unknown) => failures.push(error));
  if (failures.length > 0) throw failures[0];
}

// ────────────────────────────────────────────────── the escrowed key ──

/**
 * What the appDataFolder holds for one account: the sealed ledger, and — on
 * Standard — the key that opens it.
 *
 * Both looked up in one pass and issued together, because the interesting
 * questions are about the pair. "Is there a backup, and is its key beside it"
 * is one state, and asking for the halves in sequence would double the latency
 * of the check every restore begins with.
 */
interface FolderState {
  readonly blob: CloudFile | null;
  readonly escrow: CloudFile | null;
}

async function readFolder(
  provider: CloudProvider,
  tokens: CloudTokens,
  ownerId: string,
): Promise<FolderState> {
  const [blob, escrow] = await Promise.all([
    provider.find(tokens, backupFileName(ownerId)),
    provider.find(tokens, escrowFileName(ownerId)),
  ]);
  return { blob, escrow };
}

/**
 * The escrowed key as bytes, or null when the file is there but *unusable*.
 *
 * The distinction this makes is the whole safety of the Standard tier, and it
 * used to be missing. "The file did not parse" and "the request to read it
 * failed" arrive at the same `catch`, and they mean opposite things:
 *
 *   * A file that does not parse can only have come from a future version of
 *     this app, or from something else writing into the folder. It will never
 *     parse, no retry helps, and the useful next move is the one taken for an
 *     empty folder — mint a key and escrow it. Returning null says that.
 *   * A read that *failed* — a 500, a timeout, a truncated body — says nothing
 *     at all about what is in the folder. Answering null there tells the caller
 *     "there is no key", and the caller mints a new one, writes it over the file
 *     it could not read, and re-seals the backup under it. One unlucky HTTP
 *     request and the only copy of somebody's ledger is unopenable, with a
 *     cheerful "N records backed up" on screen. So it throws, and the run
 *     refuses instead of guessing.
 */
async function openEscrow(
  provider: CloudProvider,
  tokens: CloudTokens,
  file: CloudFile,
): Promise<Uint8Array | null> {
  // Outside the try on purpose: a failed read must leave through here, not be
  // mistaken below for a file that does not parse.
  const raw = await provider.read(tokens, file.remoteId);
  try {
    // `parseRecoveryKey` answers null for a well-formed file holding something
    // that is not a key, which is the same "will never work" as a bad envelope.
    return parseRecoveryKey(parseEscrow(raw).key);
  } catch (error) {
    if (error instanceof EscrowFormatError) return null;
    throw error;
  }
}

/** Put a key in the folder beside the blob, creating or overwriting the file. */
async function writeEscrow(
  provider: CloudProvider,
  tokens: CloudTokens,
  ownerId: string,
  key: Uint8Array,
  existing: CloudFile | null,
): Promise<void> {
  const content = JSON.stringify(buildEscrow(bytesToHex(key), new Date().toISOString()));
  await provider.put(tokens, escrowFileName(ownerId), content, existing?.remoteId ?? null);
}

/**
 * The key to seal the next backup with, doing whatever the tier says that takes.
 *
 * The decision itself is `keyForBackup`; everything here is the I/O it asks
 * for. Two of the answers have a side effect, and both are deliberate: adopting
 * the escrowed key writes it into this device's keystore, so the next run needs
 * no round trip and a later upgrade has something to hand over; and minting
 * writes the new key to *both* places, because a Standard key that exists only
 * on the phone is an Extra key nobody was warned about.
 */
async function keyForRun(
  provider: CloudProvider,
  tokens: CloudTokens,
  input: BackupRunInput,
  folder: FolderState,
): Promise<Uint8Array | 'needs-key' | null> {
  // A Standard phone that finds a blob and *no* escrow beside it is looking at
  // one of two things, and they need opposite answers. Either the folder lost
  // its key file (Drive offers "Delete hidden app data", and it deletes exactly
  // this), in which case minting a fresh key and re-escrowing is the repair —
  // or another phone on this account upgraded to Extra protection, which is
  // precisely what deletes the escrow, and the blob is now sealed under a key
  // that lives only on that phone.
  //
  // Minting in the second case overwrites somebody else's Extra backup with a
  // Standard one sealed under a key they do not have, and leaves no escrow for
  // any third device either: the backup becomes unopenable by everyone. The
  // blob's own tier is the only thing that tells the two apart, so it is worth
  // the one read — which happens only in this narrow case, never on an ordinary
  // run where the escrow is sitting right there.
  if (input.tier === BackupTier.Standard && folder.blob && !folder.escrow) {
    const remoteTier = parseFile(await provider.read(tokens, folder.blob.remoteId)).tier;
    // The file's tier beats the phone's — the phone may simply not have heard
    // yet. Answering `needs-key` sends the screen to "I already have a key",
    // which is exactly what this phone needs from its owner.
    if (remoteTier === BackupTier.Extra) return 'needs-key';
  }

  const deviceKey = await loadRecoveryKey(input.ownerId);
  const escrowKey =
    input.tier === BackupTier.Standard && folder.escrow
      ? await openEscrow(provider, tokens, folder.escrow)
      : null;

  switch (
    keyForBackup({
      tier: input.tier,
      hasDeviceKey: deviceKey !== null,
      remoteTier: null,
      hasEscrow: escrowKey !== null,
    })
  ) {
    case KeySource.Device:
      return deviceKey;
    case KeySource.Escrow: {
      // Not null: `hasEscrow` was true only because this one opened.
      const key = escrowKey as Uint8Array;
      // Written back only when it differs, so an ordinary run does not touch
      // the keystore on every pass. A differing local key here is a stale one —
      // a half-finished upgrade, or a second phone that minted before it looked.
      if (!deviceKey || bytesToHex(deviceKey) !== bytesToHex(key)) {
        await saveRecoveryKey(input.ownerId, key);
      }
      return key;
    }
    case KeySource.Mint: {
      const key = mintRecoveryKey();
      // Escrow first. A key on the phone with no copy in the folder is the one
      // state Standard must never be in, because the screen is at that moment
      // telling the person a new phone will find it.
      await writeEscrow(provider, tokens, input.ownerId, key, folder.escrow);
      await saveRecoveryKey(input.ownerId, key);
      return key;
    }
    default:
      return null;
  }
}

/**
 * Back the personal ledger up. Resolves with a refusal rather than throwing for
 * anything the person can fix; throws for a genuine transport or provider
 * failure, whose message the caller must launder before showing it.
 */
export async function runBackup(input: BackupRunInput): Promise<BackupResult> {
  if (running) return { ok: false, refusal: 'busy' };
  // Claimed before the first await, so two triggers cannot both pass the check.
  running = true;
  try {
    const provider = providerFor(PRIMARY_PROVIDER);
    if (!provider.isConfigured()) return { ok: false, refusal: 'not-configured' };

    const net = await connection();
    if (!net.online) return { ok: false, refusal: 'offline' };
    if (!input.manual && !networkAllows(input.network, net.type)) {
      return { ok: false, refusal: 'network-policy' };
    }

    const lookup = await freshTokens(PRIMARY_PROVIDER, input.ownerId);
    if (lookup.kind !== 'ok') {
      return { ok: false, refusal: lookup.kind === 'auth' ? 'auth' : 'not-connected' };
    }
    const tokens = lookup.tokens;

    try {
      const folder = await readFolder(provider, tokens, input.ownerId);
      const key = await keyForRun(provider, tokens, input, folder);
      // Somebody else's Extra blob. Refusing leaves it exactly as it is.
      if (key === 'needs-key') return { ok: false, refusal: 'needs-key' };
      // Extra protection with nothing in the keystore. The person holds the
      // only copy, and the screen's job is to ask for it rather than mint a
      // second one that would seal the next backup away from the first.
      if (!key) return { ok: false, refusal: 'no-key' };

      input.onPhase?.('collecting');
      const body = buildBody(input.ownerId, input.records, new Date());

      input.onPhase?.('sealing');
      const sealed = sealBackup(key, backupNonce(), JSON.stringify(body), backupAad(input.ownerId));
      const content = JSON.stringify(buildFile(sealed, body.createdAt, input.tier));

      input.onPhase?.('uploading');
      const stored = await provider.put(
        tokens,
        backupFileName(input.ownerId),
        content,
        folder.blob?.remoteId ?? null,
      );

      // The sweep. An upgrade whose escrow delete failed leaves behind a key
      // file that opens nothing — `keyForRestore` reads the blob's tier, not
      // the file's presence — but it is still a copy of a key in a folder the
      // person was told held none, so every later Extra run tries again.
      if (input.tier === BackupTier.Extra && folder.escrow) {
        await provider.remove(tokens, folder.escrow.remoteId).catch(() => undefined);
      }

      return {
        ok: true,
        last: {
          at: Date.now(),
          // Drive echoes the stored size; fall back to what we sent, which is
          // the same number in bytes for an ASCII-only sealed envelope.
          size: stored.size > 0 ? stored.size : content.length,
          records: body.records.length,
        },
      };
    } catch (error) {
      // A grant that has been revoked from the Google account side comes back
      // as a 401/403 forever. Drop the dead tokens so the screen offers
      // "Connect" rather than retrying a link that no longer exists.
      if (isAuthFailure(error)) {
        await clearTokens(PRIMARY_PROVIDER, input.ownerId).catch(() => undefined);
        return { ok: false, refusal: 'auth' };
      }
      throw error;
    }
  } finally {
    running = false;
  }
}

/**
 * What a found backup says about itself before anybody tries to open it.
 *
 * The date, the size and the tier are all outside the AEAD, so they can be read
 * without a key — which is exactly what makes it possible to tell somebody
 * *what opening this will take* instead of letting them find out by failing.
 * Every restore flow worth copying (Coinbase Wallet's import fork, LINE's
 * "restore or enter it yourself", WhatsApp's date-and-size card) puts that
 * choice before the attempt, not after it.
 */
export interface FoundBackupMeta {
  /** ISO, from the envelope. Empty when an older file did not record one. */
  readonly createdAt: string;
  /** Bytes as Drive stores it, or 0 when Drive would not say. */
  readonly size: number;
  readonly tier: BackupTier;
}

export type RestoreScan =
  | {
      readonly ok: true;
      readonly body: BackupBody;
      readonly plan: RestorePlan;
      /** Bytes of the file as stored, for the confirmation line. */
      readonly size: number;
      /** Which tier sealed the *found file*, whatever this phone believes. */
      readonly tier: BackupTier;
    }
  | {
      readonly ok: false;
      readonly refusal: BackupRefusal;
      /**
       * Set when the refusal is about a backup we *found* and could not open —
       * `needs-key` and `key-lost`. It is what lets the screen present the
       * fork rather than an error: here is your backup, here is what it takes.
       */
      readonly found?: FoundBackupMeta;
    };

export interface RestoreScanInput {
  readonly ownerId: string;
  /** Every personal record id this device knows, tombstones included. */
  readonly localIds: ReadonlySet<string>;
}

/**
 * Fetch and open the backup, and work out what restoring it would write —
 * without writing anything. The screen shows the person that number and the
 * date before they commit, because "restore" is the word people are most afraid
 * of pressing.
 *
 * THE FILE'S TIER BEATS THE PHONE'S, and this is the moment it matters most. A
 * phone freshly signed in has whatever tier its defaults gave it and knows
 * nothing about what made the blob; the envelope knows exactly. So the tier is
 * read out of the file, and `keyForRestore` decides from that:
 *
 * - **Standard** — the key is in the folder. Read it, adopt it, open the file.
 *   Nobody is asked anything, which is the entire point of the default tier.
 * - **Extra, and this phone holds the key** — open it.
 * - **Extra, and it does not** — `needs-key`. The screen points at "I already
 *   have a key" and must not, ever, point at "create one": a new key does not
 *   open this file, and making one arms a backup run that would overwrite it.
 * - **Standard, and the key file is gone** — `key-lost`. Somebody used Drive's
 *   "Delete hidden app data", or a failure left the folder half-empty. There is
 *   nothing to type and nothing to recover, and saying so is the only honest
 *   move left.
 *
 * The network policy is deliberately not applied: a restore is always somebody
 * standing there having asked for it, usually on a phone that has just been set
 * up and may well not be on Wi‑Fi yet.
 */
export async function scanBackup(input: RestoreScanInput): Promise<RestoreScan> {
  const provider = providerFor(PRIMARY_PROVIDER);
  if (!provider.isConfigured()) return { ok: false, refusal: 'not-configured' };

  const net = await connection();
  if (!net.online) return { ok: false, refusal: 'offline' };

  const lookup = await freshTokens(PRIMARY_PROVIDER, input.ownerId);
  if (lookup.kind !== 'ok') {
    return { ok: false, refusal: lookup.kind === 'auth' ? 'auth' : 'not-connected' };
  }
  const tokens = lookup.tokens;

  try {
    const folder = await readFolder(provider, tokens, input.ownerId);
    if (!folder.blob) return { ok: false, refusal: 'no-backup' };

    const envelope = parseFile(await provider.read(tokens, folder.blob.remoteId));
    const remoteTier = fileTier(envelope);
    const deviceKey = await loadRecoveryKey(input.ownerId);
    const escrowKey =
      remoteTier === BackupTier.Standard && folder.escrow
        ? await openEscrow(provider, tokens, folder.escrow)
        : null;

    const source = keyForRestore({
      tier: remoteTier,
      hasDeviceKey: deviceKey !== null,
      remoteTier,
      hasEscrow: escrowKey !== null,
    });
    const meta: FoundBackupMeta = {
      createdAt: envelope.createdAt,
      size: folder.blob.size > 0 ? folder.blob.size : 0,
      tier: remoteTier,
    };
    if (source === KeySource.AskPerson) return { ok: false, refusal: 'needs-key', found: meta };
    if (source === KeySource.Lost) return { ok: false, refusal: 'key-lost', found: meta };

    const key = source === KeySource.Escrow ? (escrowKey as Uint8Array) : (deviceKey as Uint8Array);
    // Adopt the escrowed key, so this phone can back up from here on without
    // fetching it again — and so the tier the person is told they are on is one
    // this device can actually honour.
    if (source === KeySource.Escrow) await saveRecoveryKey(input.ownerId, key);

    // Throws on the wrong key (the AEAD tag fails) — the screen turns that into
    // "that key does not open this backup", which is the whole diagnosis.
    const plain = openBackup(key, envelope.sealed, backupAad(input.ownerId));
    const body = parseBody(plain, input.ownerId);
    return {
      ok: true,
      body,
      plan: planRestore(input.localIds, body),
      size: folder.blob.size > 0 ? folder.blob.size : 0,
      tier: remoteTier,
    };
  } catch (error) {
    if (isAuthFailure(error)) {
      await clearTokens(PRIMARY_PROVIDER, input.ownerId).catch(() => undefined);
      return { ok: false, refusal: 'auth' };
    }
    throw error;
  }
}

// ──────────────────────────────────────── turning Extra protection on ──

export interface UpgradeInput {
  readonly ownerId: string;
  /** The ledger as it stands, for the case where there is nothing to re-seal. */
  readonly records: readonly SourceRecord[];
  /** The key just minted and shown to the person. Not yet stored anywhere. */
  readonly key: Uint8Array;
}

export type UpgradeResult =
  | { readonly ok: true; readonly state: UpgradeState; readonly last: LastBackup }
  | { readonly ok: false; readonly refusal: BackupRefusal; readonly state: UpgradeState };

/**
 * Standard → Extra protection: re-lock the backup under a key Drive does not
 * have, and only then take Drive's copy away.
 *
 * The order *is* the promise. `tier.ts` sets out the state machine and every
 * window in it; what this function adds is the I/O the machine asks for, and
 * one decision it cannot make for itself — **what to re-seal**.
 *
 * It re-seals the *body already on Drive* whenever it can read one: that file
 * is what the person is being handed a key for, and a fresh capture of the live
 * ledger, however nearly identical, is a different thing from the backup they
 * have. When there is no file, or its body cannot be opened with any key we
 * hold, it falls back to sealing the ledger as it stands — the same bytes an
 * ordinary run would send. Either way exactly one blob leaves, under the new
 * key, marked `extra`.
 *
 * The new key goes into the keystore *before* the upload, and that is not an
 * oversight. Until the escrow file is deleted Drive still holds the old key,
 * and `keyForBackup` prefers it under Standard — so a phone that dies in this
 * window comes back holding a stale local key that the next run quietly
 * replaces from the folder. Writing the key after the upload would instead
 * leave a blob nothing on earth could open.
 */
export async function upgradeToExtra(input: UpgradeInput): Promise<UpgradeResult> {
  // Past `Confirm` already: the caller only gets here once the key has been
  // shown and the person has said they kept it.
  let state = advanceUpgrade(UPGRADE_START, 'ok');
  const stop = (refusal: BackupRefusal): UpgradeResult => ({
    ok: false,
    refusal,
    state: advanceUpgrade(state, 'failed'),
  });
  if (running) return stop('busy');
  // Claimed before the first await, so AutoBackup cannot race a Standard write
  // over the Extra blob while this upgrade is still resealing it.
  running = true;
  const provider = providerFor(PRIMARY_PROVIDER);

  try {
    if (!provider.isConfigured()) return stop('not-configured');

    const net = await connection();
    if (!net.online) return stop('offline');

    const lookup = await freshTokens(PRIMARY_PROVIDER, input.ownerId);
    if (lookup.kind !== 'ok') return stop(lookup.kind === 'auth' ? 'auth' : 'not-connected');
    const tokens = lookup.tokens;

    const folder = await readFolder(provider, tokens, input.ownerId);

    // What is going back up: the body already there, or the ledger in hand.
    let body: BackupBody | null = null;
    if (folder.blob) {
      const envelope: BackupFile = parseFile(await provider.read(tokens, folder.blob.remoteId));
      const oldKey =
        (folder.escrow ? await openEscrow(provider, tokens, folder.escrow) : null) ??
        (await loadRecoveryKey(input.ownerId));
      if (oldKey) {
        try {
          body = parseBody(
            openBackup(oldKey, envelope.sealed, backupAad(input.ownerId)),
            input.ownerId,
          );
        } catch {
          // Unreadable with every key we have. Nothing is lost by sending the
          // live ledger instead — it is where those records came from — and
          // refusing here would strand somebody on Standard over a file that
          // was already beyond saving.
          body = null;
        }
      }
    }
    const outgoing = body ?? buildBody(input.ownerId, input.records, new Date());

    // The keystore, before the network. See the note in the doc comment.
    await saveRecoveryKey(input.ownerId, input.key);

    const sealed = sealBackup(
      input.key,
      backupNonce(),
      JSON.stringify(outgoing),
      backupAad(input.ownerId),
    );
    const content = JSON.stringify(buildFile(sealed, outgoing.createdAt, BackupTier.Extra));
    const stored = await provider.put(
      tokens,
      backupFileName(input.ownerId),
      content,
      folder.blob?.remoteId ?? null,
    );
    state = advanceUpgrade(state, 'ok');

    // The tier is now true of the file, so it is written down before the escrow
    // delete rather than after: somebody who closes the app here is on Extra,
    // and the file left in the folder opens nothing.
    //
    // Its failure must not travel. This is AsyncStorage, it can throw, and
    // everything above it has already happened — the blob is re-sealed under the
    // new key and the keystore holds that key. Letting it out of here would put
    // the screen's "could not be turned on, your backup is unchanged" in front
    // of somebody whose backup very much did change, and anyone who believed
    // that sentence and discarded the key would have lost it. The local tier
    // being briefly wrong is survivable — `keyForRun` now reads the blob's own
    // tier when the escrow is gone, which is exactly this state — and the next
    // read of the settings writes it again.
    await saveTier(input.ownerId, BackupTier.Extra).catch((error: unknown) =>
      reportHandled(error, 'backup.upgrade.saveTier'),
    );

    if (folder.escrow && mayClearEscrow(state)) {
      try {
        await provider.remove(tokens, folder.escrow.remoteId);
        state = advanceUpgrade(state, 'ok');
      } catch (error) {
        if (isAuthFailure(error)) throw error;
        // Recorded as a stage failure, not as a failed upgrade: the blob is
        // already sealed under a key Google does not hold, which is the whole
        // promise. Every later Extra run sweeps for the file again.
        state = advanceUpgrade(state, 'failed');
      }
    } else {
      state = advanceUpgrade(state, 'ok');
    }

    return {
      ok: true,
      state,
      last: {
        at: Date.now(),
        size: stored.size > 0 ? stored.size : content.length,
        records: outgoing.records.length,
      },
    };
  } catch (error) {
    if (isAuthFailure(error)) {
      await clearTokens(PRIMARY_PROVIDER, input.ownerId).catch(() => undefined);
      return stop('auth');
    }
    // Anything else is a transport failure. Nothing on Drive changed — the
    // escrowed key is still there, the blob is still the one it opens, and the
    // account is still Standard — so it goes up to the caller to be laundered
    // into a sentence and offered another go.
    throw error;
  } finally {
    running = false;
  }
}
