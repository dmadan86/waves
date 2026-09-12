/**
 * Whether the dashboard should offer, once, to bring a backup back.
 *
 * ## The moment this exists for
 *
 * Signing in on a new phone — or after a reinstall, or after signing out and
 * back in — lands somebody on the dashboard with a Waves that knows nothing
 * about them. The shared ledger comes back from the server on its own, but the
 * private "Me" ledger's other copy is the person's own Drive backup, and until
 * now nothing on the way in ever mentioned it: the only route to the restore
 * was to already know it was there — ••• on Home, then Backup — and to go
 * looking before entering anything, which is the order nobody does things in.
 *
 * ## The failure mode this module is shaped around
 *
 * The dangerous version of this feature is not the one that fails to appear. It
 * is the one that appears for somebody whose phone already holds their ledger —
 * a returning user, opening Home on an ordinary Tuesday, asked whether they
 * would like their data back. That reads as "Waves has lost your records", and
 * it is why every condition below is a reason *not* to ask.
 *
 * So the offer stands on a conjunction of four claims, and the ones that can be
 * wrong-for-a-moment are excluded by `settled` rather than raced:
 *
 * 1. **This phone holds nothing.** `recordCount` is the same count the Backup
 *    screen's `restoreFirst` uses, from the same mirror. One record and the
 *    question is not ours to ask.
 * 2. **We have actually looked.** `settled` is "the mirror is off disk *and*
 *    this session's first sync has landed or given up". Without the second half
 *    the count is zero for every user for the length of a network round trip,
 *    which is exactly long enough to flash the offer at somebody with four
 *    hundred records. The personal ledger rides the ordinary sync pull (its own
 *    `:personal` scope, fetched on every sync), so a returning phone's records
 *    arrive with that first pull and close the gate by themselves.
 * 3. **This build can reach Drive at all.** With no OAuth client id every
 *    restore path in the app refuses with `not-configured`, so an offer here
 *    would be a button that cannot work — worse than silence, because it names
 *    a backup the person may then go hunting for.
 * 4. **Nobody has answered yet.** See below.
 *
 * Guests are left out on purpose. A guest's records live under an anonymous id
 * that has never had a Drive backup — there is by construction nothing to
 * bring back — and the guest already has a prompt of its own on that screen.
 *
 * ## Being unlinked is not a reason to stay quiet
 *
 * A phone with no Google account linked is the *most* likely one to want this:
 * it is what a new phone looks like. So the link is a step inside the answer,
 * not a condition on the question, and the only thing it changes is which
 * sentence the offer carries — `LinkFirst` says a Google consent sheet is
 * coming, because being handed one unannounced is how a restore turns into
 * "why is it asking for my Google account".
 *
 * ## What "dismissed" means, and for how long
 *
 * **Until the next sign-in on this device, for this account.** The flag is
 * written under the owner's id in the same AsyncStorage the rest of the backup
 * settings use, so it survives an app restart and a hundred dashboard renders,
 * and B signing in after A on a shared phone inherits nothing of A's. It also
 * rides `clearBackupSettings`, which sign-out wipes — so signing out and back
 * in asks once more.
 *
 * That is the honest boundary. A dismissal that lasted forever would be wrong
 * at the one moment this feature exists for: somebody who says "not now" on
 * their old phone, then sets a new one up months later, must be asked there.
 * One that came back daily would be the nag this module is written to avoid.
 * Signing in is the event that means "this device is starting fresh for me",
 * and it is the only event that re-arms the question.
 *
 * Taking the offer counts as answering it, not only declining. Somebody who
 * taps through has been asked, and the Backup screen is where every outcome of
 * that tap — found, nothing there, needs a key — is reported and retried.
 * Coming back to a second identical popup because the scan found nothing would
 * be the app asking the same question twice.
 *
 * ## Where restore stays reachable
 *
 * It is not hidden behind this prompt and never was: the dashboard's ••• menu
 * carries a Backup row, and on a phone holding nothing that screen leads with
 * "Restore my data" (`restoreFirst`). The dismissal copy names that route, so
 * "not now" is a postponement with an address rather than a door closing.
 *
 * Pure, and tested without a renderer, for the same reason `setup.ts` is: the
 * conditions above are the whole feature, and every one of them is a sentence
 * about somebody's data that must not be got wrong.
 */

/** What, if anything, the dashboard puts on screen. */
export enum RestoreOffer {
  /** Say nothing. The overwhelmingly common answer. */
  None = 'none',
  /** An account is linked: the tap goes straight to looking for a backup. */
  Restore = 'restore',
  /** Nothing linked: the same tap, with the consent sheet announced first. */
  LinkFirst = 'link-first',
}

/** What the dashboard knows that bears on whether to make the offer. */
export interface RestorePromptInput {
  readonly signedIn: boolean;
  /** Guests have no Drive backup to restore, by construction. */
  readonly isGuest: boolean;
  /** False when this build carries no OAuth client id for the provider. */
  readonly configured: boolean;
  /** Whether a Google account is linked. Chooses the copy, never the answer. */
  readonly connected: boolean;
  /** Personal records this phone holds right now. */
  readonly recordCount: number;
  /**
   * The mirror has been read off disk *and* this session's first sync has
   * settled (landed, or stopped for want of a network). Until then a zero count
   * means "we have not looked", not "there is nothing".
   */
  readonly settled: boolean;
  /** This account has already answered the offer on this device. */
  readonly dismissed: boolean;
}

export function restoreOffer(input: RestorePromptInput): RestoreOffer {
  if (!input.settled) return RestoreOffer.None;
  if (!input.signedIn || input.isGuest) return RestoreOffer.None;
  if (!input.configured) return RestoreOffer.None;
  if (input.dismissed) return RestoreOffer.None;
  if (input.recordCount > 0) return RestoreOffer.None;
  return input.connected ? RestoreOffer.Restore : RestoreOffer.LinkFirst;
}
