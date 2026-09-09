/**
 * Who has already met the intro cards, and who has already had the coach-marks.
 *
 * Both flags used to be a single device-wide key. Whoever first finished — or
 * skipped — the tour on a handset answered on behalf of every account that
 * would ever sign in there afterwards, and nothing cleared it, not signing out
 * and not signing in as somebody else. That is why the intro stopped appearing
 * after login: the screen never went anywhere and the gate never changed, the
 * phone had simply already said "seen" for everybody.
 *
 * A tour is shown to a person meeting the app, not to a handset, so each flag is
 * filed per account id — the same shape the backup recovery key and the cloud
 * tokens already use.
 *
 * The old device-wide values are not migrated, not claimed and not consulted.
 * They are swept away by `legacyKeys` (see its `RETIRED` list) and every account
 * is asked once for itself. That is deliberate, and it is the point of the
 * change rather than a cost of it: on any handset that ran the app before the
 * intro moved behind sign-in, the device key says "yes" because somebody swiped
 * past the cards on the *login screen*, before there was an account to attribute
 * it to. Honouring that would have handed the first account to sign in the very
 * answer this module exists to stop trusting — the people most likely to be
 * missing their onboarding would have carried on missing it. So existing
 * accounts see the intro once more after this ships. It is three cards.
 *
 * The coach-marks are re-armed by the same sweep, and that is intended too,
 * though almost nobody will meet them: the intro's `onDone` marks them seen, so
 * a returning account gets the three cards and then Home as usual. Only somebody
 * who reaches Home without passing through the intro — dismissing it is passing
 * through it — sees the coach-marks again, and one more pass over the balance
 * deck is not worth a mechanism to prevent.
 *
 * Deliberately no `await legacyKeysMigrated` here, unlike every other reader of
 * a renamed key. A per-account slot never existed before the rename, so no
 * migration can touch one, and awaiting would hold the gate's spinner behind a
 * dozen storage reads to answer a question that does not depend on them. The
 * sweep still runs at boot — half a dozen modules the root layout mounts import
 * `legacyKeys` and start it — it simply is not on this path.
 *
 * Nothing in here rejects. Storage refusing to answer must not decide anything
 * dramatic, so each reader states its own safe direction below.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * One slot per account, per flag. The suffix is the account id; the stems are
 * the old device-wide key names, which are retired and can never collide with
 * a suffixed one.
 */
const introSlot = (ownerId: string): string => `waves.onboarding_seen.${ownerId}`;
/** Bumping the `v1` re-shows the coach-marks to everyone after they change shape. */
const tourSlot = (ownerId: string): string => `waves.tour_seen_v1.${ownerId}`;

async function readFlag(key: string, whenUnreadable: boolean): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === 'yes';
  } catch {
    return whenUnreadable;
  }
}

async function writeFlag(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, 'yes');
  } catch {
    // A write that fails costs one repeat of a tour, not a stuck screen.
  }
}

/**
 * Has this account already been shown the three intro cards? Never rejects.
 *
 * Unreadable storage reports "seen": the intro is a full-screen gate in front
 * of the app, and a phone that cannot answer must not trap somebody behind it.
 */
export const onboardingSeen = (ownerId: string): Promise<boolean> =>
  readFlag(introSlot(ownerId), true);

/** Remember that this account is done with the intro. Never rejects. */
export const rememberOnboardingSeen = (ownerId: string): Promise<void> =>
  writeFlag(introSlot(ownerId));

/**
 * Has this account already had the Home coach-marks? Never rejects.
 *
 * Unreadable storage reports "not seen", the opposite of the intro and for the
 * same reason: the coach-marks are a dismissable overlay on a screen that works
 * without them, so the cost of a spurious one is a tap on the X.
 */
export const tourSeen = (ownerId: string): Promise<boolean> => readFlag(tourSlot(ownerId), false);

/** Remember that this account is done with the coach-marks. Never rejects. */
export const rememberTourSeen = (ownerId: string): Promise<void> => writeFlag(tourSlot(ownerId));

/**
 * Drop both answers for an account that no longer exists. Never rejects.
 *
 * Only for erasure, and deliberately not for signing out: an account that signs
 * out has still seen the tour, and would be entitled to be annoyed at meeting it
 * again on the way back in. A deleted account has not — there is no it. Left
 * alone the two slots are about sixty bytes of a phone that will never read them
 * again, since every read is keyed by the live session's id; sweeping them is
 * hygiene rather than a fix.
 */
export async function forgetTours(ownerId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(introSlot(ownerId));
    await AsyncStorage.removeItem(tourSlot(ownerId));
  } catch {
    // Sixty bytes that outlive the account they describe. Not worth a word to
    // the person who is in the middle of deleting everything they own.
  }
}
