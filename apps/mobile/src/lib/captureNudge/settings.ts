/**
 * What the phone remembers about its own reminder: whether it is allowed to
 * raise one, and when the last one it set was due to go off.
 *
 * ## Why this is not on the server
 *
 * Every other switch on the notifications screen lives in
 * `profiles.notification_prefs`, because every other switch governs something
 * the *server* decides to send — `waves_claim_push_notifications` reads those
 * keys, and a preference the database cannot see is a preference nobody has.
 *
 * This one is the opposite shape. Nothing is sent: the phone sets an alarm on
 * itself, from data it already holds, and the phone is therefore the only thing
 * that can obey the switch. Putting it on the server would mean a reminder that
 * silently stops working offline (the pass would have no preference to read),
 * and it would put "how often does this person leave receipts unfiled" on our
 * servers to govern something our servers never touch — the same argument that
 * keeps the backup schedule local.
 *
 * The honest reading of the switch is therefore "remind me **on this phone**",
 * and the settings screen says so in its own section rather than mixing it in
 * with the four that travel with the account.
 *
 * ## Owner-scoped, and wiped on the way out
 *
 * Every key carries the owner id, exactly as the backup settings do. A device
 * is not always one person's, and "you have four expenses you never filed" is
 * not something the next person to sign in on a shared phone should inherit.
 * `clearCaptureNudge` is called from sign-out alongside the cancel, so nothing
 * about the previous account survives it.
 *
 * ## The default is on
 *
 * Opt-out, matching every push switch in `DEFAULT_NOTIFICATION_PREFS` — all of
 * which start on, with the weekly email as the single deliberate exception. The
 * exception is instructive: the weekly email arrives whether or not there is
 * anything to say, so silence has to be the default. This one can only ever
 * speak about work the person themselves left unfinished, and only on a phone
 * where they have already granted notification permission through the soft ask.
 * A switch defaulted off would make it the one reminder in the app that exists
 * but never happens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** The switch. Absent means on — see the header. */
const ENABLED_KEY = 'waves.capture_nudge.enabled';
/**
 * The fire time of the reminder this phone most recently scheduled.
 *
 * One value doing two jobs, which is why it is worth naming carefully. While it
 * is in the future it is "what we asked for"; once it is in the past it is the
 * evidence that a reminder went off, which is the only thing the ceiling can be
 * measured from — nothing in `expo-notifications` reports a delivery, and a
 * fired notification simply vanishes from the scheduled list.
 */
const PLANNED_KEY = 'waves.capture_nudge.planned_at';

/** Every stored key, for the sign-out wipe. */
const ALL_KEYS = [ENABLED_KEY, PLANNED_KEY] as const;

const scoped = (base: string, ownerId: string): string => `${base}.${ownerId}`;

/** Whether this phone may remind this account about its waiting drafts. */
export async function loadCaptureNudgeEnabled(ownerId: string): Promise<boolean> {
  if (!ownerId) return false;
  // A read that fails must not read as "they turned it off" — an unavailable
  // store is not an answer, and the default is the honest fallback.
  const stored = await AsyncStorage.getItem(scoped(ENABLED_KEY, ownerId)).catch(() => null);
  return stored === null ? true : stored === 'yes';
}

export async function saveCaptureNudgeEnabled(ownerId: string, enabled: boolean): Promise<void> {
  if (!ownerId) return;
  await AsyncStorage.setItem(scoped(ENABLED_KEY, ownerId), enabled ? 'yes' : 'no');
}

/**
 * The fire time of the last reminder we set, or null if we have set none.
 *
 * Garbage — a key written by some future build, a half-written value — reads as
 * null, which costs at most one extra reminder rather than suppressing them
 * forever.
 */
export async function loadPlannedNudge(ownerId: string): Promise<number | null> {
  if (!ownerId) return null;
  const stored = await AsyncStorage.getItem(scoped(PLANNED_KEY, ownerId)).catch(() => null);
  if (stored === null) return null;
  const at = Number(stored);
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** Records what we just scheduled, or clears it when we cancel. */
export async function savePlannedNudge(ownerId: string, fireAt: number | null): Promise<void> {
  if (!ownerId) return;
  const key = scoped(PLANNED_KEY, ownerId);
  await (fireAt === null
    ? AsyncStorage.removeItem(key)
    : AsyncStorage.setItem(key, String(fireAt)));
}

/** On the way out. Best effort: signing out must succeed whether or not this does. */
export async function clearCaptureNudge(ownerId: string): Promise<void> {
  if (!ownerId) return;
  await Promise.all(
    ALL_KEYS.map((base) => AsyncStorage.removeItem(scoped(base, ownerId)).catch(() => {})),
  );
}
