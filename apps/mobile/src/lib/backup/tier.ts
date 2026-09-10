/**
 * Two tiers of backup, and the arithmetic that decides which one somebody is on.
 *
 * ## What was wrong
 *
 * `recoveryKey.ts` reasons its way to a 32-byte key shown once as 64 hex
 * characters, and calls that "WhatsApp's '64-digit encryption key' option,
 * minus the password option beside it". The reasoning is sound and the
 * conclusion was wrong, because in WhatsApp that option is *not the default*.
 * It is the opt-in end-to-end encrypted backup, four taps down in settings,
 * behind a screen whose whole job is to talk you out of it unless you mean it.
 * WhatsApp's default Drive backup asks for no key at all. We shipped the
 * advanced tier as the only tier, and the result was a Backup screen where
 * nothing worked until you copied 64 hex characters somewhere.
 *
 * ## The two tiers
 *
 * **Standard**, the default. The app mints the same 32-byte key and never shows
 * it to anybody. A copy goes into the *same hidden Drive appDataFolder as the
 * backup blob*, in a small file beside it. Signing in with the same Google
 * account on a new phone finds both and restores with no ceremony. Whoever
 * holds the Google account holds the ledger — that is the honest trade, and it
 * is exactly what WhatsApp's default tier trades.
 *
 * **Extra protection**, opt-in. What shipped before: the key is shown once,
 * lives only in this device's keystore, is never escrowed, and a restore on a
 * new phone means typing it back in. Waves and Google are both locked out, and
 * losing the key loses the backup for good.
 *
 * ## Why escrowing in `appDataFolder` costs nothing
 *
 * `nativeGoogle.ts` already asks for `drive.appdata` and nothing else, and the
 * blob already lives there. A second small file in the same folder needs no new
 * scope, no new consent screen, and no second provider. That is the whole
 * reason this design is cheap enough to be the default.
 *
 * ## The escrowed key is in the clear, and that is the point
 *
 * The escrow file holds the key as plain hex. Encrypting it under something
 * Drive also holds would be theatre — a lock whose key is taped to it — and
 * pretending otherwise on the screen would be worse than the plain statement
 * the Standard copy actually makes: the key is kept in your Google account, so
 * whoever reaches your Google account can read the backup. Say it, don't
 * obfuscate it.
 *
 * ## How a restore knows which tier it found
 *
 * The backup envelope carries an optional `tier`. **Absent means Extra**, which
 * is exactly right for every file the previous build ever wrote: those were
 * device-only keys, so a v1 file with no tier field *is* an extra-protection
 * backup. That is why nothing here bumps `BACKUP_VERSION`: the version is in
 * the AEAD's associated data, so bumping it would make every existing backup
 * fail to open — the one thing this change must not do. An added optional field
 * is invisible to `parseFile`'s older self and load-bearing to its newer one.
 *
 * The tier travels in the clear, next to the format name. That tells whoever
 * reads the folder whether a key sits beside the blob — which the presence of
 * the key file tells them anyway. It buys the restore the ability to say
 * *which* kind of "I cannot open this" it is looking at, which is the
 * difference between "type your key" and "this backup can never be opened".
 *
 * ## There is no downgrade, and that is a decision
 *
 * Extra protection → Standard would mean uploading to Google the key we told
 * the person, in the strongest words this app owns, that nobody but them would
 * ever hold — and re-sealing the ledger under a key Drive then keeps. The
 * screen says *lose it and the backup can never be opened*. A switch that
 * quietly makes that untrue does not just weaken one account's backup; it
 * teaches people that the warnings in this app are decoration.
 *
 * It is also the one direction where no ordering helps. The upgrade has a safe
 * sequence because each step leaves the data better protected than the step
 * before, so a failure anywhere is survivable. A downgrade is the opposite at
 * every stage, and there is no arrangement of it that fails safe.
 *
 * The way back exists and is deliberately not a switch: **unlink the Google
 * account and link it again.** Unlinking already clears the key, the tier and
 * the schedule together — the Drive file is left behind, unreadable, exactly as
 * it always was — and the next link starts a fresh setup on Standard. One
 * visible, deliberate route with its own confirmation, instead of a toggle that
 * reverses a promise. The unlink dialog says what it costs, in the tier's own
 * words.
 *
 * ## Everything here is pure
 *
 * The tier arithmetic, the escrow envelope, and the upgrade state machine have
 * no keystore, no network and no React in them, so the decisions that matter —
 * an existing device-only user staying readable, escrow being deleted only
 * after a successful re-seal — are testable in a suite with no renderer.
 */

/** Which promise this account's backup is making. */
export enum BackupTier {
  /** Key escrowed in Drive's appDataFolder. No ceremony, automatic restore. */
  Standard = 'standard',
  /** Key on this device only. Shown once, typed back on a new phone. */
  Extra = 'extra',
}

/** What a fresh account gets, and what the whole rework is for. */
export const DEFAULT_TIER = BackupTier.Standard;

/** A stored value that is not one of ours reads as "nothing stored". */
export function parseTier(raw: string | null): BackupTier | null {
  return raw === BackupTier.Standard || raw === BackupTier.Extra ? raw : null;
}

/**
 * Which tier this account is on, given what is stored and what this phone holds.
 *
 * The stored value wins whenever there is one — tier is explicit state, not an
 * inference, and certainly not "is there a file in the appDataFolder", which is
 * a network answer to a local question and would make the screen's own claims
 * wait on a Drive round trip.
 *
 * The inference exists for exactly one population and runs exactly once: people
 * who set a backup up under the previous build. They have a key in the keystore
 * and no stored tier, because the previous build had no tiers to store. In the
 * new vocabulary they are on Extra protection — that is precisely what their
 * key is — so they keep working with no prompt, their Drive file stays
 * readable, and nothing about their screen changes except its words. The caller
 * writes the answer down the first time it is asked, so the inference is a
 * migration and not a standing rule.
 *
 * A phone with no stored tier and no key is a fresh setup, and gets the default.
 */
export function resolveTier(stored: BackupTier | null, hasKey: boolean): BackupTier {
  if (stored !== null) return stored;
  return hasKey ? BackupTier.Extra : DEFAULT_TIER;
}

/**
 * Whether a backup may run without anybody being asked anything else.
 *
 * On Extra this is the `keySeen` gate the previous build enforced in its two
 * callers: nothing goes to Drive until the person has been shown the key and
 * said they kept it, because a backup nobody can open is worse than none. On
 * Standard there is nothing to have kept — the key is in the Google account the
 * backup is going to — so the gate would be a question with no answer.
 */
export function tierAllowsBackup(tier: BackupTier, keySeen: boolean): boolean {
  return tier === BackupTier.Standard || keySeen;
}

// ───────────────────────────────────────────────────── the escrow file ──

/** Marks the key file as ours before anything is read out of it. */
export const ESCROW_FORMAT = 'waves.personal.backup.key';

/**
 * The escrow envelope's own version, independent of the backup's.
 *
 * Versioned from the start because this is now a format with two tiers and
 * there will one day be a third — a password tier, a second provider, a key
 * wrapped under something the phone actually holds. A reader that refuses a
 * version it does not know is the only way a future tier can be added without
 * an old build quietly mis-reading it.
 */
export const ESCROW_VERSION = 1;

/** The file that sits beside the blob, holding the key that opens it. */
export interface EscrowFile {
  readonly format: typeof ESCROW_FORMAT;
  readonly version: number;
  /**
   * Which tier the key was escrowed for. Only ever `standard` — an escrowed
   * Extra key is a contradiction — but written down rather than assumed, so a
   * future tier that also escrows cannot be mistaken for this one.
   */
  readonly tier: BackupTier.Standard;
  /** When it was put there. For nothing but a diagnosis; the file is one line. */
  readonly createdAt: string;
  /** The 32-byte key, as 64 lowercase hex characters. See the header. */
  readonly key: string;
}

/** A key file that is not ours, or is from a version we must not guess at. */
export class EscrowFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EscrowFormatError';
  }
}

/**
 * The escrow file's name in the appDataFolder, beside the blob's.
 *
 * Owner-scoped for the same reason `backupFileName` is: two Waves accounts can
 * link one Google account, and one folder would otherwise hold one file that
 * both of them overwrite — here that would mean handing B the key to A's
 * ledger, which is worse than the lost-update the blob's own scoping prevents.
 */
export function escrowFileName(ownerId: string): string {
  const safe = ownerId.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `waves-personal-backup-key-${safe}.json`;
}

export function buildEscrow(keyHex: string, createdAt: string): EscrowFile {
  return {
    format: ESCROW_FORMAT,
    version: ESCROW_VERSION,
    tier: BackupTier.Standard,
    createdAt,
    key: keyHex,
  };
}

/**
 * Read a key file back, or say which way it is wrong.
 *
 * Deliberately does not parse the key into bytes: that is `parseRecoveryKey`'s
 * job and it already forgives spacing and case, and keeping the two apart means
 * this module never touches key material as anything but an opaque string.
 */
export function parseEscrow(text: string): EscrowFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EscrowFormatError('backup key file is not JSON');
  }
  const file = raw as Partial<EscrowFile>;
  if (file?.format !== ESCROW_FORMAT) throw new EscrowFormatError('not a Waves backup key');
  if (typeof file.version !== 'number' || file.version > ESCROW_VERSION) {
    throw new EscrowFormatError(
      `backup key version ${String(file.version)} is newer than this app`,
    );
  }
  if (file.tier !== BackupTier.Standard) {
    throw new EscrowFormatError(`unknown escrow tier ${String(file.tier)}`);
  }
  if (typeof file.key !== 'string' || file.key.length === 0) {
    throw new EscrowFormatError('backup key file holds no key');
  }
  return {
    format: ESCROW_FORMAT,
    version: file.version,
    tier: BackupTier.Standard,
    createdAt: typeof file.createdAt === 'string' ? file.createdAt : '',
    key: file.key,
  };
}

// ────────────────────────────────────────────── choosing a key to use ──

/** What the engine should do about a key before it can seal or open anything. */
export enum KeySource {
  /** The key already in this device's keystore. */
  Device = 'device',
  /** The escrowed copy in Drive — adopt it into the keystore on the way past. */
  Escrow = 'escrow',
  /** Nothing anywhere. Mint one, escrow it, and carry on. Standard only. */
  Mint = 'mint',
  /** An extra-protection backup and no key here. Only the person has it. */
  AskPerson = 'ask',
  /** A standard backup whose escrowed key is gone. Nothing opens it. */
  Lost = 'lost',
}

/**
 * What the phone in front of us has to work with, for one account.
 *
 * `remoteTier` is the tier of the backup *found on Drive*, or null when there
 * is no backup there at all — which is the ordinary state on a first run and
 * must not be confused with "found one and could not read it".
 */
export interface KeyLookup {
  readonly tier: BackupTier;
  readonly hasDeviceKey: boolean;
  readonly remoteTier: BackupTier | null;
  readonly hasEscrow: boolean;
}

/**
 * Where the key for the *next backup run* comes from.
 *
 * Under **Standard the escrow is authoritative**, ahead of the device's own
 * copy, and that ordering is doing real work. It makes a half-finished upgrade
 * safe: the upgrade writes a new key to the keystore before it re-seals
 * anything, so a phone that died in between holds a key that opens nothing
 * while Drive still holds the one that opens the blob. Preferring the escrow
 * discards the stale local copy and everything keeps working. It also makes a
 * second phone on the same Google account converge on one key instead of
 * quietly sealing every other backup under a different one.
 *
 * Under **Extra there is no escrow to consult**, by construction, so the
 * device's key is the only answer and its absence is the person's to fix.
 */
export function keyForBackup(lookup: KeyLookup): KeySource {
  if (lookup.tier === BackupTier.Extra) {
    return lookup.hasDeviceKey ? KeySource.Device : KeySource.AskPerson;
  }
  if (lookup.hasEscrow) return KeySource.Escrow;
  if (lookup.hasDeviceKey) return KeySource.Device;
  return KeySource.Mint;
}

/**
 * Where the key for *opening a backup that was found* comes from.
 *
 * The difference from `keyForBackup` is that this one is answering about a file
 * that already exists and already has a tier of its own, and the file's tier
 * beats the phone's. A phone freshly signed in has whatever local tier its
 * defaults gave it and knows nothing; the blob knows exactly what sealed it.
 *
 * The two failures are kept apart because they are not the same news. An extra-
 * protection blob with no key here is *waiting for something the person has* —
 * `AskPerson`, and the screen points at "I already have a key". A standard blob
 * whose escrowed key is no longer in the appDataFolder (Drive's storage settings
 * offer "Delete hidden app data", and it deletes exactly this) is `Lost`: there
 * is no key anywhere, nothing to type, and the only honest thing the screen can
 * do is say so rather than send somebody hunting for 64 characters that never
 * existed.
 */
export function keyForRestore(lookup: KeyLookup): KeySource {
  if (lookup.remoteTier === BackupTier.Extra) {
    return lookup.hasDeviceKey ? KeySource.Device : KeySource.AskPerson;
  }
  if (lookup.hasEscrow) return KeySource.Escrow;
  if (lookup.hasDeviceKey) return KeySource.Device;
  return KeySource.Lost;
}

// ──────────────────────────────────────────── Standard → Extra upgrade ──

/**
 * The stages of turning Extra protection on, in the order they must happen.
 *
 * The ordering is the whole safety argument, so it is written down as a machine
 * rather than left to the shape of an async function.
 *
 * 1. `Confirm` — the key is minted and shown, and nothing has changed yet. A
 *    person who backs out here has lost nothing and changed nothing.
 * 2. `Reseal` — the blob on Drive is re-sealed under the new key and rewritten
 *    with `tier: extra`. **This must succeed before the escrow is touched.**
 *    Deleting the escrowed key while a blob the old key still opens sits beside
 *    it would be a lie about the promise just made: the key Google held would be
 *    gone from the folder but not necessarily from Google, and the ciphertext it
 *    opens would still be there.
 * 3. `Escrow` — and only now, delete the escrowed key.
 * 4. `Done`.
 *
 * What happens when a stage fails, in each window:
 *
 * - **Re-seal fails.** Nothing on Drive changed. The escrow still holds the old
 *   key, the blob is still sealed under it, and the account is still Standard.
 *   The person is told, and can try again. This is the failure the ordering is
 *   designed to make cheap.
 * - **Re-seal succeeded, delete failed.** Drive holds a key that opens nothing:
 *   the blob beside it is already sealed under the new one and says `tier:
 *   extra`, and `keyForRestore` reads the *blob's* tier, so the stale file is
 *   inert rather than a way in. It is still untidy and still a file the person
 *   did not ask to keep, so every later run under Extra sweeps for it.
 * - **The process dies between minting and re-sealing.** The keystore holds a
 *   key that opens nothing. `keyForBackup` prefers the escrow under Standard
 *   precisely so this state resolves itself: the stale local key is overwritten
 *   from the escrow on the next run, and the account is exactly where it was.
 *
 * The one thing none of these can cost is data, because the backup is never the
 * only copy of the ledger at the moment of an upgrade — the records are on the
 * phone, and a lost remote copy is remade by the next run. That is what lets
 * this fail loudly instead of trying to be clever.
 */
export enum UpgradeStage {
  Confirm = 'confirm',
  Reseal = 'reseal',
  Escrow = 'escrow',
  Done = 'done',
}

export interface UpgradeState {
  readonly stage: UpgradeStage;
  /** The blob on Drive is sealed under the new key and marked extra. */
  readonly resealed: boolean;
  /** The escrowed copy of the old key is gone from the appDataFolder. */
  readonly escrowCleared: boolean;
  /** Which tier the account is on *right now*, mid-flight included. */
  readonly tier: BackupTier;
  /** Set when a stage refused; the caller shows it and stops. */
  readonly failedAt: UpgradeStage | null;
}

export const UPGRADE_START: UpgradeState = {
  stage: UpgradeStage.Confirm,
  resealed: false,
  escrowCleared: false,
  tier: BackupTier.Standard,
  failedAt: null,
};

/** What the caller reports back about the stage it just attempted. */
export type UpgradeOutcome = 'ok' | 'failed';

/**
 * Advance the upgrade by one stage.
 *
 * The tier flips to Extra the moment the re-seal lands, not when the escrow
 * delete does — the blob is at that point sealed under a key Drive does not
 * have, which is the promise; the leftover file opens nothing. Flipping it
 * later would leave the screen saying "Standard" over a backup only the person
 * can open, which is the same class of lie in the other direction.
 *
 * A failure freezes the state where it stands and records the stage, so the
 * caller can neither carry on to a later stage nor report success.
 */
export function advanceUpgrade(state: UpgradeState, outcome: UpgradeOutcome): UpgradeState {
  if (state.failedAt !== null || state.stage === UpgradeStage.Done) return state;
  if (outcome === 'failed') return { ...state, failedAt: state.stage };

  switch (state.stage) {
    case UpgradeStage.Confirm:
      return { ...state, stage: UpgradeStage.Reseal };
    case UpgradeStage.Reseal:
      return { ...state, stage: UpgradeStage.Escrow, resealed: true, tier: BackupTier.Extra };
    case UpgradeStage.Escrow:
      return { ...state, stage: UpgradeStage.Done, escrowCleared: true };
    default:
      return state;
  }
}

/**
 * Whether the escrowed key may be deleted yet. The single rule this whole
 * module exists to enforce, stated once so nothing has to re-derive it: not
 * until the blob is sealed under a key Drive no longer holds.
 */
export function mayClearEscrow(state: UpgradeState): boolean {
  return state.resealed && state.failedAt === null;
}

// ──────────────────────────────────── what the rest of the app can ask ──

/**
 * The account's backup standing, as one value — for the sign-out guard and the
 * sign-in restore prompt, which are a separate change and need to ask these
 * three questions without knowing anything about tiers, escrow or Drive.
 */
export interface BackupStanding {
  readonly tier: BackupTier;
  /** Epoch ms of the last successful backup, or null for never. */
  readonly lastAt: number | null;
  readonly everBackedUp: boolean;
  /** Records added since the last backup. Zero is not the same as up to date. */
  readonly newSince: number;
  /**
   * Nothing has been added or removed since the last backup landed.
   *
   * Honest about its limits: an edit in place changes no count and moves no
   * created-at, so this is a claim about the *shape* of the ledger, not its
   * contents. It is the right claim for a sign-out guard — "you have 4 records
   * that have never left this phone" is worth stopping somebody for; "you
   * changed the note on one" is not.
   */
  readonly upToDate: boolean;
  /** True when a backup would run right now if something asked it to. */
  readonly canBackUp: boolean;
  /**
   * Whether a restore on a *new* phone would have to ask for a key. False on
   * Standard, where signing into the same Google account is the whole of it.
   */
  readonly restoreNeedsKey: boolean;
}

export interface StandingInput {
  readonly tier: BackupTier;
  readonly keySeen: boolean;
  readonly connected: boolean;
  /** Epoch ms, or null. */
  readonly lastAt: number | null;
  /** How many records the last backup carried. */
  readonly lastRecords: number;
  /** How many the ledger holds now. */
  readonly recordCount: number;
  /** How many of those were created after `lastAt`. */
  readonly newSince: number;
}

export function backupStanding(input: StandingInput): BackupStanding {
  const everBackedUp = input.lastAt !== null;
  return {
    tier: input.tier,
    lastAt: input.lastAt,
    everBackedUp,
    newSince: input.newSince,
    upToDate: everBackedUp && input.newSince === 0 && input.recordCount === input.lastRecords,
    canBackUp: input.connected && tierAllowsBackup(input.tier, input.keySeen),
    restoreNeedsKey: input.tier === BackupTier.Extra,
  };
}
