/**
 * Backing the private "Me" ledger up to the person's own Google Drive.
 *
 * TWO TIERS, AND WHICH ONE THIS SCREEN IS FOR. The first version of this screen
 * had one tier and it was the wrong one: a 64-character key, shown once, that
 * nothing worked without. That is WhatsApp's *advanced* option — its end-to-end
 * encrypted backup, four taps down in settings — shipped as though it were the
 * default. WhatsApp's actual default asks for no key at all, and so does ours
 * now. On **Standard** the app mints a key, keeps a copy in the same hidden
 * Drive folder as the backup, and never mentions it; linking the account is the
 * whole of the setup. On **Extra protection**, opt-in, the key is shown once and
 * lives only on this phone.
 *
 * We ship WhatsApp's advanced tier minus its password half. WhatsApp offers a
 * password first and demotes the 64-digit key to a text link beneath it; a
 * password is only safe behind a memory-hard KDF, which is a new crypto
 * dependency and a tuning decision this app has deliberately not taken (see
 * `recoveryKey.ts`). So our version of that screen has one primary button and
 * no fork.
 *
 * WHERE THE TIER IS SAID, and where it is not. Following WhatsApp's chat-backup
 * card, the tier is a padlocked line *inside the status card*, beside the date
 * and the size — not a badge and not a section heading. And "Extra protection"
 * is the last card on the screen, visually apart, reading Off or On with a
 * one-line footnote: it is an upgrade, not a step, and it must not compete with
 * "Back up now" for the attention of somebody whose backup is already working.
 *
 * THE SHAPE, AND WHY IT CHANGED. This was WhatsApp's chat-backup screen — six
 * peer sections: back up now, account, key, schedule, network, restore. That
 * shape assumes the feature already works. It does not until three separate
 * things are true (an account is linked, this device holds the key, and the
 * person has kept a copy of it), and until then four of the six sections were
 * inert: "Back up now" a grey slab with no reason attached, "Check for a
 * backup" the same, and the one control that unblocked either — "Create a key"
 * — a small chip two screens further down, under a heading that gave no hint it
 * gated everything above it. A setup flow wearing a settings screen's clothes
 * reads, correctly, as a screen that is broken.
 *
 * So the screen now has two modes and one anchor.
 *
 * The anchor is the card at the top. It always answers "is this protected",
 * in the same place, in one line: still reading / not yet / ready / backed up.
 * It is not updated optimistically: a run in progress replaces the *button*
 * with its own progress line and leaves the status card saying what was last
 * true, which is what WhatsApp does and what stops the screen claiming a backup
 * that has not landed.
 * The other two things WhatsApp's chat-backup card carries — when the last one
 * landed, and that the lock is a key only this person holds — appear once
 * there is a truthful answer to give, which is once the setup is done; a
 * "Locked with your key" line over a phone with no key would be the same lie
 * this redesign is here to remove. It is first because "am I safe" is the
 * question somebody opened this screen with.
 *
 * Below the fold of that card the screen forks. **Until a backup can run**, the
 * card continues into the checklist and the outstanding step — and only that
 * one — carries a button. On Standard there is exactly one step, so it is not
 * drawn as a checklist at all: no marks, no "1 of 1", just the button. A
 * progress counter over a single item is scaffolding measuring itself. Steps already taken collapse to a line with
 * "Done" beside them; steps further out are dimmed and silent. That is Uber
 * Eats' account checkup, where the item needing attention expands in place with
 * its own action and the satisfied ones shrink to checked rows. **Once it can
 * run**, the checklist disappears entirely and the card continues into "Back up
 * now" — an ordinary settings screen, with no scaffolding left to nag somebody
 * whose backups have been running for a year.
 *
 * THE ORDERING, in the order it is rendered:
 *
 * 1. Status + the one thing to do. Both answers within a thumb of the top.
 * 2. The promise ("nothing legible leaves the phone"), because *what to do*
 *    outranks *why* on a screen somebody came to with a problem.
 * 3. Account, and then the key — each rendered once the thing it manages
 *    exists (a link; a key on this phone) *and* the checklist is not itself
 *    asking for that same thing. So the two never offer the same tap. Note it
 *    is not gated on the setup being finished: `configured` is a runtime
 *    conjunction and can go false under a phone that already holds a key, and
 *    hiding "Show my key" there would strand the Drive file for good.
 * 4. The schedule, which now refuses to lie. "Daily" with no key backs nothing
 *    up, so when the steps are unfinished the schedule says so directly under
 *    the picker rather than sitting there looking live. Not in a build that
 *    cannot back up at all, where the card has already said why and "the steps
 *    above" would point at nothing.
 * 5. Which networks.
 * 6. Restore: it is the half people need once, at the worst moment, and
 *    burying it would be cruel — but putting it near "Back up now" invites the
 *    wrong tap. Its position is unchanged and deliberately so; what changed is
 *    that when it is blocked for want of a key it now says which key and
 *    carries the button that takes it. That is the one place the screen shows
 *    a tap the checklist also offers, and it is worth it: the alternative was
 *    a person on a new phone reading "Create your backup key first", doing it,
 *    and having the next run overwrite the backup they came to recover.
 * 7. Extra protection, last and set apart, exactly where WhatsApp puts its own
 *    end-to-end row. Below Restore rather than above it, because the reason
 *    Restore sits low — that it must not be next to "Back up now" — is
 *    unaffected by what comes after it, and an upgrade offered before the way
 *    back is offered would be the wrong order of business.
 *
 * THE RULE THE WHOLE FILE OBEYS, stated exactly. A control that *cannot* run
 * either carries its reason beside it or is not rendered at all, with the step
 * that unblocks it standing in its place. A control merely waiting on work
 * already in flight is a different thing and gets a different treatment: the
 * button that was pressed wears a spinner, and the rest go quiet for as long as
 * that takes. What is ruled out is the third case, which is what was here
 * before — a grey button, nothing running, and no reason anywhere on screen.
 *
 * THE PROMISE, WHICH IS NOW TWO PROMISES, AND NEITHER MAY BE OVERSTATED. What
 * goes to Drive is a sealed blob either way. On Extra protection the key that
 * opens it is shown to the person and sent nowhere, and the screen says so. On
 * Standard the key is in their Google account, which means whoever reaches that
 * account can read the ledger — so the Standard copy says *that*, and does not
 * borrow the sentence about Google not being able to read it. Getting this
 * wrong is worse than any other mistake available on this screen.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  ListRow,
  Popup,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { plural, useStrings } from '@/i18n';
import { formatBytes } from '@/lib/bytes';
import { useBackup, type BackupOutcome } from '@/lib/backup/useBackup';
import { BackupFrequency } from '@/lib/backup/schedule';
import { formatRecoveryKey } from '@/lib/backup/recoveryKey';
import { backupSetup, BackupStep } from '@/lib/backup/setup';
import { BackupTier } from '@/lib/backup/tier';
import type { RestoreScan } from '@/lib/backup/engine';
import { CloudAuthError } from '@/lib/cloud/oauth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { SyncNetworkPreference } from '@/lib/syncNetwork';

/** A found backup, held while the person decides whether to take it. */
type FoundBackup = Extract<RestoreScan, { ok: true }>;

/** A brand name, not copy — the same word in every locale, so not translated. */
const PROVIDER_LABEL = 'Google Drive';

/** The checklist mark's diameter, and so the indent its buttons hang under. */
const STEP_MARK = 26;

/**
 * How tall the key sheet's scroller may get, in points and not a percentage.
 *
 * A percentage height resolves against a parent that has none — the sheet sizes
 * itself to its content — so it collapses to nothing visible and quietly clips
 * whatever was at the bottom. Here that would be the consent toggle and the
 * button beside it, on the one sheet where the last control is the point.
 */
const KEY_SHEET_MAX_HEIGHT = 460;

/**
 * The `?restore=` nonces already acted on, at module scope so the set survives a
 * remount.
 *
 * The dashboard's restore prompt opens this screen with `?restore=<nonce>`
 * meaning "link if you must, then go and look". Linking hands control to
 * Google's consent activity, and Android recreates the JS activity on the way
 * back — remounting this screen with the same URL, nonce and all. A `useRef`
 * guard would reset there and start the whole thing again, in a loop. Recording
 * the nonce the first time it is seen makes it exactly once, while a genuinely
 * new tap carries a fresh one and still works. Lifted verbatim from
 * `capture.tsx`'s `consumedScans`, which was written for the same Android
 * behaviour.
 */
const consumedStarts = new Set<string>();

/**
 * Which action is in flight, rather than a bare `busy` flag.
 *
 * A screen-wide boolean greys every button at once and says nothing about any
 * of them, which is indistinguishable from the refusal this whole redesign
 * exists to remove — worst of all on "Link your Google Drive", which holds the
 * flag for the entire Google consent sheet plus a Drive round trip. Naming the
 * action lets the pressed button carry a spinner and read as *working*, while
 * the rest go quiet for a second or two beside something visibly running.
 */
type PendingAction = 'connect' | 'disconnect' | 'key' | 'backup' | 'scan' | 'restore' | 'extra';

/**
 * The disc at the head of a checklist row: a tick once the step is taken, its
 * number in the brand colour while it is the one being asked for, and a hollow
 * outline for the steps still ahead.
 *
 * Three states rather than two, because "done" and "not done" cannot express
 * the thing this screen exists to say — which of the not-done ones is *yours to
 * do right now*. Every checklist that works (Chime's "Finish setup", Plum's
 * "Get set up", Shopify's "Get ready to sell") draws that distinction.
 */
function StepMark({ number, done, active }: { number: number; done: boolean; active: boolean }) {
  const theme = useTheme();
  const fill = done ? theme.color.positive : active ? theme.color.brand : 'transparent';
  return (
    <View
      style={{
        width: STEP_MARK,
        height: STEP_MARK,
        borderRadius: STEP_MARK / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: fill,
        borderWidth: done || active ? 0 : 1,
        borderColor: theme.color.border,
      }}
    >
      {done ? (
        <Ionicons name="checkmark" size={iconSize.base} color={theme.color.onBrand} />
      ) : (
        <Text variant="micro" tone={active ? 'onBrand' : 'faint'}>
          {String(number)}
        </Text>
      )}
    </View>
  );
}

export default function BackupSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const backup = useBackup();
  /**
   * The dashboard's restore prompt sends its nonce here to mean "link if you
   * must, then look" — see `consumedStarts` and `onStartRestore`. Absent on
   * every ordinary visit, which is every visit that is not a fresh sign-in.
   */
  const { restore: restoreStart } = useLocalSearchParams<{ restore?: string }>();

  /**
   * Whether the stored state has been read yet.
   *
   * The hook's first pass reads three local stores — the settings, the key, the
   * tokens — so until it lands a fully configured phone would show "Not backing
   * up yet" and correct itself a second later, the one sentence on this screen
   * that must never be shown wrongly. It is declared this high because the
   * auto-start effect below cannot ask Google to link an account before it
   * knows whether one already is.
   */
  const settled = !backup.loading;

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entering, setEntering] = useState(false);
  const [typedKey, setTypedKey] = useState('');
  /** What went wrong with the key just typed — not a key, or the keystore. */
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  /** "What is a backup key?", opened from inside the entry sheet. */
  const [explaining, setExplaining] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [about, setAbout] = useState(false);
  const [found, setFound] = useState<FoundBackup | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  /** The Extra-protection pitch, before any key has been minted. */
  const [pitching, setPitching] = useState(false);
  /**
   * True while the key on screen is one that has not been committed to
   * anything. It is what makes the same sheet serve two jobs — "here is the key
   * you already have" and "here is the key that is about to replace Drive's
   * copy" — and the second one carries the consent gate and the button that
   * actually does the work.
   */
  const [upgrading, setUpgrading] = useState(false);
  /** Solflare's gate: the destructive button stays inert until this is on. */
  const [understood, setUnderstood] = useState(false);
  /**
   * Set when a scan finds a backup this phone cannot open. Until then the
   * restore card does not offer "I already have a key" on Standard, where
   * nobody is expected to have one; after it, that button is the only way out.
   */
  const [needsOldKey, setNeedsOldKey] = useState(false);
  /**
   * A backup that was found and cannot be opened from here, with what it says
   * about itself. Shown as a sheet of its own rather than as an error, because
   * a person who asked "is there a backup" got a yes — what changes is what
   * opening it takes, and that is a fork to offer, not a failure to report.
   */
  const [blocked, setBlocked] = useState<Extract<RestoreScan, { ok: false }> | null>(null);
  /**
   * Why the last scan came to nothing, said inside the restore card. The button
   * that produced it is directly above, so the retry is where the answer is —
   * "no backup found" is very often "not loaded yet", and a sentence stranded
   * in the callout at the top of the screen leaves the retry a scroll away.
   */
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  const dateTime = useCallback(
    (at: number): string =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(at),
      ),
    [locale],
  );

  /** The one sentence for a refusal — each has a different way out. */
  const refusalLine = (outcome: BackupOutcome): string => {
    if (outcome.kind === 'ok') return plural(locale, outcome.records, t.backup.backedUp);
    switch (outcome.refusal) {
      case 'not-configured':
        return t.backup.unavailable;
      case 'not-connected':
        return t.backup.refusedNotConnected;
      case 'no-key':
        return t.backup.refusedNoKey;
      case 'needs-key':
        return t.backup.refusedNeedsKey;
      case 'key-lost':
        return t.backup.refusedKeyLost;
      case 'offline':
        return t.backup.refusedOffline;
      case 'network-policy':
        return t.backup.refusedNetwork;
      case 'auth':
        return t.backup.refusedAuth;
      case 'no-backup':
        return t.backup.refusedNoBackup;
      default:
        return t.backup.refusedBusy;
    }
  };

  const phaseLine =
    backup.phase === 'collecting'
      ? t.backup.phaseCollecting
      : backup.phase === 'sealing'
        ? t.backup.phaseSealing
        : backup.phase === 'uploading'
          ? t.backup.phaseUploading
          : null;

  /**
   * Why linking failed, said in a way that points at whoever can fix it.
   *
   * "Try again" is honest advice for a dropped connection and a lie for a build
   * Google refuses to issue tokens to — no client registered for this package
   * name and signing certificate, or no client id in the bundle at all. Those
   * are settled before the app is installed and no tap changes them, so they
   * get the same sentence the screen already uses for a build that cannot do
   * this: "not available in this build".
   *
   * The status code is the whole diagnosis for whoever is building and noise
   * for everybody else, so it is appended in development only. It is already in
   * the crash report either way — `lib/cloud/nativeGoogle` files these on the
   * way out, which is also why this does not run a `CloudAuthError` back
   * through `friendlyError`: that would report the same failure twice.
   */
  const connectFailure = (caught: unknown): string => {
    if (!(caught instanceof CloudAuthError)) {
      return friendlyError(caught, t.backup.connectFailed, 'backup.connect');
    }
    // `play-services` deserves its own sentence — Google's services being
    // absent or stale is the one fault here the person can fix themselves — and
    // will get one as soon as `backup.connectNoPlayServices` exists in all four
    // locale tables. Until then it reads as an ordinary failure, which is at
    // least not wrong.
    const sentence = caught.fault === 'not-set-up' ? t.backup.unavailable : t.backup.connectFailed;
    // The code is shown in release builds too, and that is deliberate. Every
    // fault here is a *configuration* one only the operator can fix — a signing
    // certificate never registered against an Android OAuth client, a stale Play
    // services, the wrong Cloud project — and they all arrive as the same
    // sentence. On a release build with no Sentry DSN the person holding the
    // phone is the only channel the diagnosis has, and "it says 10" is the whole
    // difference between guessing and knowing. It is a short status code from
    // Play services, not an exception message, and it is bounded here so it
    // stays a reference rather than becoming developer English on a screen.
    return caught.status ? `${sentence} (${String(caught.status).slice(0, 24)})` : sentence;
  };

  const onConnect = async (): Promise<void> => {
    setPending('connect');
    setError(null);
    try {
      await backup.connect();
    } catch (caught) {
      setError(connectFailure(caught));
    } finally {
      setPending(null);
    }
  };

  const onBackUpNow = async (): Promise<void> => {
    setPending('backup');
    setError(null);
    try {
      await backup.backupNow();
    } catch (caught) {
      setError(friendlyError(caught, t.backup.backupFailed, 'backup.run'));
    } finally {
      setPending(null);
    }
  };

  const onCreateKey = async (): Promise<void> => {
    setPending('key');
    setError(null);
    try {
      setCopied(false);
      setUpgrading(false);
      setShownKey(await backup.createKey());
    } catch (caught) {
      setError(friendlyError(caught, t.backup.keySaveFailed, 'backup.createKey'));
    } finally {
      setPending(null);
    }
  };

  /**
   * Turn Extra protection on: mint the key, and show it.
   *
   * Nothing is committed here. The key exists on this screen and nowhere else
   * until the person works the consent gate below it, which is deliberate —
   * backing out of the sheet leaves the account exactly as it was, still
   * Standard, still opening with the key Drive holds.
   */
  const onOfferExtra = (): void => {
    setPitching(false);
    setError(null);
    setCopied(false);
    setUnderstood(false);
    setUpgrading(true);
    setShownKey(backup.beginExtra());
  };

  /**
   * Commit it: re-seal the backup under the new key, then take Drive's copy of
   * the old one away — in that order, and never the other.
   *
   * The sheet stays open for the length of it, with the button wearing the
   * spinner, because this is a Drive read and a Drive write and a Drive delete
   * and closing over it would leave somebody looking at a screen that had not
   * changed yet. It closes on success, and on failure it stays open carrying
   * the reason, with the key still on it — which is the whole point of failing
   * before the escrow is touched.
   */
  const onCommitExtra = async (): Promise<void> => {
    if (!shownKey) return;
    setPending('extra');
    setError(null);
    try {
      const outcome = await backup.commitExtra(shownKey);
      if (outcome.kind === 'refused') {
        setError(refusalLine(outcome));
        return;
      }
      setUpgrading(false);
      setShownKey(null);
    } catch (caught) {
      setError(friendlyError(caught, t.backup.extraFailed, 'backup.upgrade'));
    } finally {
      setPending(null);
    }
  };

  /**
   * Put the key sheet away, and forget everything that only made sense while it
   * was open. Refused outright mid-upgrade: the sheet is at that moment the
   * only place the new key exists, and losing it between the re-seal and the
   * escrow delete would leave the Drive file sealed under something nobody can
   * read back.
   */
  const closeKeySheet = (): void => {
    if (pending === 'extra') return;
    setShownKey(null);
    setUpgrading(false);
    setUnderstood(false);
  };

  /**
   * Show the key again — and say so when it cannot.
   *
   * `loadRecoveryKey` swallows a SecureStore failure to null, so this used to
   * be able to do nothing at all: no sheet, no sentence, and no way to finish
   * the step that "Show my key" is the only exit from. It was survivable while
   * this was a small chip beside other controls; it is not now that the
   * checklist hangs a step on it.
   */
  const onShowKey = async (): Promise<void> => {
    setPending('key');
    setError(null);
    try {
      setCopied(false);
      setUpgrading(false);
      const key = await backup.revealKey();
      if (!key) {
        setError(t.backup.keyUnreadable);
        return;
      }
      setShownKey(key);
    } catch (caught) {
      setError(friendlyError(caught, t.backup.keyUnreadable, 'backup.revealKey'));
    } finally {
      setPending(null);
    }
  };

  const onEnterKey = (): void => {
    setTypedKey('');
    setTypedProblem(null);
    setExplaining(false);
    setEntering(true);
  };

  /**
   * Take a key typed in from another phone. The keystore write can reject, and
   * an unhandled rejection would leave the sheet open saying nothing, so both
   * kinds of "no" get the same treatment: a sentence inside the sheet, where
   * the person still has what they typed.
   */
  const onAcceptKey = async (): Promise<void> => {
    setTypedProblem(null);
    try {
      if (!(await backup.acceptKey(typedKey))) {
        setTypedProblem(t.backup.keyEnterInvalid);
        return;
      }
      setEntering(false);
      setTypedKey('');
      setNeedsOldKey(false);
      setBlocked(null);
    } catch (caught) {
      setTypedProblem(friendlyError(caught, t.backup.keySaveFailed, 'backup.acceptKey'));
    }
  };

  const onCheckForBackup = async (): Promise<void> => {
    setPending('scan');
    setError(null);
    setRestoreNote(null);
    setRestored(null);
    try {
      const result = await backup.scan();
      if (result.ok) {
        setFound(result);
        return;
      }
      // A backup that exists and needs something gets its own surface, with the
      // date and the size it announced and the one button that would open it.
      // Everything else — nothing there, no link, no connection — is a line
      // under the button that would try again.
      if (result.found) {
        setBlocked(result);
        if (result.refusal === 'needs-key') setNeedsOldKey(true);
      } else {
        setRestoreNote(refusalLine({ kind: 'refused', refusal: result.refusal }));
      }
    } catch (caught) {
      // A key that does not open the file throws out of the AEAD. That is the
      // whole diagnosis and it is worth saying precisely; anything else is a
      // transport failure whose text must not reach the screen.
      const wrongKey =
        caught instanceof Error && /Poly1305|invalid tag|decrypt/i.test(caught.message);
      setError(
        wrongKey
          ? t.backup.restoreWrongKey
          : friendlyError(caught, t.backup.restoreFailed, 'backup.scan'),
      );
    } finally {
      setPending(null);
    }
  };

  const onRestore = async (): Promise<void> => {
    if (!found) return;
    setPending('restore');
    try {
      setRestored(await backup.applyRestore(found));
      setFound(null);
    } catch (caught) {
      setFound(null);
      setError(friendlyError(caught, t.backup.restoreFailed, 'backup.restore'));
    } finally {
      setPending(null);
    }
  };

  /**
   * The dashboard's offer, carried out: link the account if nothing is linked,
   * then look for a backup — one instruction, because that is what was promised
   * on the popup that sent us here.
   *
   * It is the two existing halves in order and not a third path: the link is
   * `backup.connect` with the same failure sentence `onConnect` uses, and the
   * look is `onCheckForBackup` untouched, so every outcome past "found it" —
   * nothing on Drive, a backup wanting a key, a dead grant — lands in the same
   * sheets and notes it always has, and the confirmation before anything is
   * written is the same one.
   *
   * A cancelled consent page stops here and says nothing. It is an answer, not
   * a failure, and the screen behind this is already the whole of the restore
   * offered by hand.
   */
  const onStartRestore = async (): Promise<void> => {
    if (!backup.connected) {
      setPending('connect');
      setError(null);
      try {
        if (!(await backup.connect())) return;
      } catch (caught) {
        setError(connectFailure(caught));
        return;
      } finally {
        setPending(null);
      }
    }
    await onCheckForBackup();
  };

  // Waits for `settled` because until the stored state is read this screen does
  // not know whether an account is linked, and would ask Google to link one that
  // already is. See `consumedStarts` for why the guard is a module-level set.
  useEffect(() => {
    if (!restoreStart || !settled || consumedStarts.has(restoreStart)) return;
    consumedStarts.add(restoreStart);
    // Deferred a microtask so the `setPending` the run opens with does not fire
    // synchronously inside the effect body — the same shape `capture.tsx` uses
    // for its one-shot. The link still starts effectively at once.
    void Promise.resolve().then(() => onStartRestore());
    // A one-shot on the nonce; the handlers are recreated every render and
    // listing them would re-run this on every keystroke elsewhere on the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreStart, settled]);

  const onUnlink = async (): Promise<void> => {
    setUnlinking(false);
    setPending('disconnect');
    try {
      await backup.disconnect();
    } catch (caught) {
      setError(friendlyError(caught, t.backup.connectFailed, 'backup.disconnect'));
    } finally {
      setPending(null);
    }
  };

  const frequencies: { value: BackupFrequency; label: string }[] = [
    { value: BackupFrequency.Off, label: t.backup.freqOff },
    { value: BackupFrequency.Daily, label: t.backup.freqDaily },
    { value: BackupFrequency.Weekly, label: t.backup.freqWeekly },
    { value: BackupFrequency.Monthly, label: t.backup.freqMonthly },
  ];

  const networks: { value: SyncNetworkPreference; label: string }[] = [
    { value: SyncNetworkPreference.Wifi, label: t.backup.networkWifi },
    { value: SyncNetworkPreference.Both, label: t.backup.networkAny },
  ];

  const running = backup.phase !== null;
  /** Something is in flight. Which one it is decides who gets the spinner. */
  const busy = pending !== null;
  /**
   * The mark a working button wears in place of its icon. Filled buttons put a
   * light label on the brand colour, so their spinner has to invert too.
   */
  const spinner = (onBrand: boolean): ReactNode => (
    <ActivityIndicator size="small" color={onBrand ? theme.color.onBrand : theme.color.text} />
  );

  const setup = backupSetup({
    configured: backup.configured,
    connected: backup.connected,
    hasKey: backup.hasKey,
    keySeen: backup.settings.keySeen,
    tier: backup.tier,
  });
  const extra = backup.tier === BackupTier.Extra;
  /**
   * One step is not a checklist. On Standard the card carries the Link button
   * on its own — no marks, no numbers, no "1 of 1" measuring itself.
   */
  const checklist = setup.total > 1;
  const last = backup.settings.last;

  /**
   * A linked phone with nothing on it is a new phone, and the one thing it
   * wants is its ledger back.
   *
   * So the card offers that instead of "Back up now" — which on an empty phone
   * is the one button that must not be pressed, because it would write nothing
   * over the copy the person came here for. Restore stops being a section
   * somebody has to find and understand, and becomes the only thing on offer at
   * the moment it is the only thing that makes sense. Once anything at all has
   * been entered the card goes back to backing up, and restore steps down to a
   * single row further down for the rare case of wanting it anyway.
   */
  const restoreFirst = settled && setup.complete && backup.recordCount === 0;

  const statusTone: 'warning' | 'brand' | 'positive' =
    !settled || (setup.complete && !last) ? 'brand' : setup.complete ? 'positive' : 'warning';
  const statusColor =
    statusTone === 'positive'
      ? { fg: theme.color.positive, bg: theme.color.positiveSoft }
      : statusTone === 'brand'
        ? { fg: theme.color.brand, bg: theme.color.brandSoft }
        : { fg: theme.color.warning, bg: theme.color.warningSoft };

  const statusTitle = !settled
    ? t.backup.statusChecking
    : setup.complete
      ? last
        ? t.backup.statusOn
        : restoreFirst
          ? t.backup.statusFresh
          : t.backup.statusReady
      : t.backup.statusOff;

  const statusDetail = !settled
    ? null
    : setup.unavailable
      ? t.backup.unavailable
      : setup.complete
        ? last
          ? t.backup.lastLine
              .replace('{date}', dateTime(last.at))
              .replace('{size}', formatBytes(last.size, locale))
          : t.backup.never
        : plural(locale, setup.total - setup.done, t.backup.stepsLeft);

  /** One title and one sentence per step; the sentence shows only on the active one. */
  const stepCopy: Record<BackupStep, { title: string; body: string }> = {
    [BackupStep.Account]: { title: t.backup.stepAccountTitle, body: t.backup.stepAccountBody },
    [BackupStep.Key]: { title: t.backup.stepKeyTitle, body: t.backup.stepKeyBody },
    [BackupStep.SaveKey]: { title: t.backup.stepSaveTitle, body: t.backup.stepSaveBody },
  };

  /**
   * The buttons the outstanding step carries.
   *
   * "I already have a key" rides along with both key steps, because somebody
   * restoring onto a new phone is *at* one of those two moments and typing
   * their old key is the whole answer — it satisfies the step and the one after
   * it in a single tap. At step 2 it is a `secondary`, not a ghost: the two are
   * genuinely equal choices, and drawing the wrong one louder is how somebody
   * with a backup to recover ends up minting a key that cannot open it.
   */
  const stepActions = (step: BackupStep): ReactNode => {
    if (step === BackupStep.Account) {
      return (
        <Button
          label={t.backup.connect}
          onPress={() => void onConnect()}
          disabled={busy}
          icon={pending === 'connect' ? spinner(true) : undefined}
          fullWidth
        />
      );
    }
    const primary =
      step === BackupStep.Key
        ? { label: t.backup.keyCreate, run: onCreateKey }
        : { label: t.backup.keyShow, run: onShowKey };
    return (
      <>
        <Button
          label={primary.label}
          onPress={() => void primary.run()}
          disabled={busy}
          icon={pending === 'key' ? spinner(true) : undefined}
          fullWidth
        />
        <Button
          label={t.backup.keyEnter}
          variant={step === BackupStep.Key ? 'secondary' : 'ghost'}
          size={step === BackupStep.Key ? 'md' : 'sm'}
          onPress={onEnterKey}
          disabled={busy}
          fullWidth
        />
      </>
    );
  };

  /**
   * Why "Check for a backup" cannot run, in the person's terms, beside the
   * button rather than instead of it — a restore has to stay findable even when
   * it is not yet possible, because the moment somebody needs it is the moment
   * they have nothing else.
   *
   * The no-key case gets its own sentence rather than borrowing the backup
   * button's "Create your backup key first." That advice is correct above and
   * catastrophic here: this is a new phone whose backup is sealed under the key
   * from the old one, and minting a fresh one does not open it — it makes
   * `setup.complete` true, which arms "Back up now" and any non-Off schedule,
   * and `runBackup` overwrites the Drive file in place. Following the wrong
   * sentence would destroy the only copy of the ledger the person came here
   * for. So the reason names the old key, and the button beside it is the one
   * that takes it.
   *
   * `settled` is consulted because these flags start false: without it the card
   * would say "Checking…" while this line flatly told a linked phone to link an
   * account.
   *
   * The no-key block now applies **only on Extra protection**. On Standard a
   * phone that has never held a key is the ordinary case — a new phone, signed
   * into the same Google account — and the key it needs is in the folder beside
   * the backup. Blocking there would be the same mistake in a new costume:
   * refusing the one action that was going to work.
   */
  const restoreReason = !settled
    ? t.backup.statusChecking
    : !backup.configured
      ? t.backup.unavailable
      : !backup.connected
        ? t.backup.refusedNotConnected
        : extra && !backup.hasKey
          ? t.backup.restoreNeedsKey
          : null;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.backup.title}</Text>
        </View>
        <IconButton label={t.backup.aboutLabel} onPress={() => setAbout(true)}>
          <Ionicons
            name="information-circle-outline"
            size={iconSize.lg}
            color={theme.color.textMuted}
          />
        </IconButton>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}

        {/* The anchor: where things stand, and — under the same rule — either
            the one step outstanding or the button that is now possible. */}
        <Card style={{ gap: theme.spacing.lg }}>
          <Row gap={theme.spacing.md} style={{ alignItems: 'flex-start' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: statusColor.bg,
              }}
            >
              {settled ? (
                <Ionicons
                  name={
                    setup.complete
                      ? last
                        ? 'cloud-done'
                        : 'cloud-upload-outline'
                      : 'cloud-offline-outline'
                  }
                  size={iconSize.xxl}
                  color={statusColor.fg}
                />
              ) : (
                <ActivityIndicator size="small" color={statusColor.fg} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{statusTitle}</Text>
              {statusDetail ? (
                <Text variant="caption" tone="muted">
                  {statusDetail}
                </Text>
              ) : null}
              {/* WhatsApp's "End-to-end encrypted" line: the reassurance belongs
                  where the good news is, not three sections further down. */}
              {settled && setup.complete ? (
                <Row gap={theme.spacing.xs} style={{ marginTop: 2 }}>
                  <Ionicons name="lock-closed" size={iconSize.xs} color={theme.color.textFaint} />
                  {/* Two padlocks, two different sentences. The Extra one is
                      WhatsApp's "End-to-end encrypted"; the Standard one names
                      where the key is kept, because a line that only said
                      "locked" would let somebody read the stronger promise into
                      it. */}
                  <Text variant="micro" tone="faint">
                    {extra ? t.backup.statusSealedExtra : t.backup.statusSealedStandard}
                  </Text>
                </Row>
              ) : null}
            </View>
          </Row>

          {settled && setup.complete ? (
            <>
              <Divider />
              <View style={{ gap: theme.spacing.md }}>
                {/* One button, and which of the two it is was not left to the
                    person to work out — see `restoreFirst`. */}
                <Button
                  label={restoreFirst ? t.backup.restoreNow : t.backup.backUpNow}
                  onPress={() => void (restoreFirst ? onCheckForBackup() : onBackUpNow())}
                  disabled={busy || running}
                  fullWidth
                  icon={
                    running || pending === 'backup' || pending === 'scan' ? (
                      <ActivityIndicator size="small" color={theme.color.onBrand} />
                    ) : (
                      <Ionicons
                        name={restoreFirst ? 'cloud-download-outline' : 'cloud-upload-outline'}
                        size={iconSize.md}
                        color={theme.color.onBrand}
                      />
                    )
                  }
                />
                {/* Where the look ended up, under the button that would look
                    again — "there is no backup on this Drive account yet" is
                    often a slow folder rather than an empty one. */}
                {restoreFirst && restoreNote ? (
                  <Text variant="micro" tone="muted" align="center">
                    {restoreNote}
                  </Text>
                ) : null}
                {/* A run in progress says which part it is on; the gap between
                    the tap and the first phase — network checks and a token
                    refresh — says something rather than nothing; and a finished
                    run says what it did. Scoped to this button's own action, so
                    pressing something else on the screen does not make this one
                    sprout a progress line. */}
                {phaseLine ? (
                  <Text variant="micro" tone="muted" align="center">
                    {phaseLine}
                  </Text>
                ) : pending === 'backup' ? (
                  <Text variant="micro" tone="muted" align="center">
                    {t.backup.busy}
                  </Text>
                ) : backup.outcome ? (
                  <Text
                    variant="micro"
                    tone={backup.outcome.kind === 'ok' ? 'muted' : 'faint'}
                    align="center"
                  >
                    {refusalLine(backup.outcome)}
                  </Text>
                ) : null}
              </View>
            </>
          ) : settled && !setup.unavailable ? (
            <>
              <Divider />
              <View style={{ gap: theme.spacing.lg }}>
                {/* A one-item list gets no heading and no counter: on Standard
                    the only thing outstanding is linking the account, and a
                    progress bar over it would be scaffolding measuring itself.
                    Its copy still comes from the step, so the single button
                    carries the same sentence it would have on a list. */}
                {checklist ? (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text variant="micro" tone="faint">
                      {t.backup.setupSection}
                    </Text>
                    <Text variant="micro" tone="faint">
                      {t.backup.setupProgress
                        .replace('{done}', String(setup.done))
                        .replace('{total}', String(setup.total))}
                    </Text>
                  </Row>
                ) : null}
                {!checklist && setup.outstanding ? (
                  <View style={{ gap: theme.spacing.md }}>
                    <View style={{ gap: 2 }}>
                      <Text variant="subheading">{stepCopy[setup.outstanding].title}</Text>
                      <Text variant="caption" tone="muted">
                        {stepCopy[setup.outstanding].body}
                      </Text>
                    </View>
                    {stepActions(setup.outstanding)}
                  </View>
                ) : null}
                {checklist &&
                  setup.steps.map(({ step, done }, index) => {
                    const active = setup.outstanding === step;
                    const copy = stepCopy[step];
                    return (
                      <View key={step} style={{ gap: theme.spacing.md }}>
                        <Row gap={theme.spacing.md} style={{ alignItems: 'flex-start' }}>
                          <StepMark number={index + 1} done={done} active={active} />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="subheading" tone={active ? 'default' : 'muted'}>
                              {copy.title}
                            </Text>
                            {active ? (
                              <Text variant="caption" tone="muted">
                                {copy.body}
                              </Text>
                            ) : null}
                          </View>
                          {done ? (
                            <Text variant="micro" tone="positive">
                              {t.backup.stepDone}
                            </Text>
                          ) : null}
                        </Row>
                        {active ? (
                          // Hung under the row's text rather than the mark, so the
                          // button reads as belonging to this step and not to the
                          // list. `paddingStart` so it hangs off the right edge in
                          // Arabic.
                          <View
                            style={{
                              paddingStart: STEP_MARK + theme.spacing.md,
                              gap: theme.spacing.sm,
                            }}
                          >
                            {stepActions(step)}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
              </View>
            </>
          ) : null}
        </Card>

        {/* Which Google account. Rendered whenever one is linked *and* the
            checklist is not itself asking for one — so the two never offer the
            same tap, and a build that has lost `configured` under a linked
            account can still unlink it. */}
        {backup.connected && setup.outstanding !== BackupStep.Account ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.backup.accountSection} />
            <Card>
              <Row gap={theme.spacing.md}>
                <Ionicons name="logo-google" size={iconSize.xl} color={theme.color.brand} />
                {/* The destination is the constant and the address is what
                    varies, so the destination is the line that is always there
                    and the address sits under it — never a guess, and never a
                    blank row that reads as "not connected". */}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="body">{PROVIDER_LABEL}</Text>
                  {backup.account ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {backup.account}
                    </Text>
                  ) : null}
                </View>
                {/* Trailing and small, which is where every app that manages a
                    linked account puts this — Canva, Uber Eats, Yubo all read
                    as one row. It was a full-width red block under the address,
                    which is the weight a settings screen gives deleting the
                    account, not unlinking a backup destination that can be
                    relinked in two taps. The confirmation it opens is unchanged
                    and still carries the cost in full. */}
                <Button
                  label={t.backup.disconnect}
                  variant="ghostDanger"
                  size="sm"
                  onPress={() => setUnlinking(true)}
                  disabled={busy}
                  icon={pending === 'disconnect' ? spinner(false) : undefined}
                />
              </Row>
            </Card>
          </View>
        ) : null}

        {/* The key. Extra protection only — on Standard this phone holds a key
            too, minted on the first run, but showing it would put back the
            ceremony the tier exists to remove and would invite somebody to
            treat a key Google also has as the thing keeping them safe.
            Otherwise unchanged: rendered whenever this phone holds one and the
            checklist is not itself asking to be shown it. Gating this on
            `setup.complete` was wrong — `configured` is a runtime conjunction
            (a client id *and* the native Google module), so a build that loses
            either would hide the only way to read back a key already on the
            device, and the Drive file it opens would then be unrecoverable. */}
        {extra && backup.hasKey && setup.outstanding !== BackupStep.SaveKey ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.backup.keySection} />
            <Card style={{ gap: theme.spacing.md }}>
              <Row style={{ gap: theme.spacing.sm }}>
                <Ionicons name="key" size={iconSize.md} color={theme.color.brand} />
                <Text variant="body">{t.backup.keyPresent}</Text>
              </Row>
              <Text variant="micro" tone="muted">
                {t.backup.keyIntro}
              </Text>
              <Row style={{ gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t.backup.keyShow}
                    variant="secondary"
                    size="sm"
                    onPress={() => void onShowKey()}
                    disabled={busy}
                    icon={pending === 'key' ? spinner(false) : undefined}
                    fullWidth
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t.backup.keyEnter}
                    variant="ghost"
                    size="sm"
                    onPress={onEnterKey}
                    disabled={busy}
                    fullWidth
                  />
                </View>
              </Row>
            </Card>
          </View>
        ) : null}

        {/* How often — and, when it cannot yet run, saying so rather than
            sitting there reading "Daily" over a key that does not exist. */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.backup.frequencySection} />
          <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
            {frequencies.map((option, index) => {
              const chosen = backup.settings.frequency === option.value;
              return (
                <View key={option.value}>
                  <ListRow
                    title={option.label}
                    onPress={() => void backup.setFrequency(option.value)}
                    // A picker row, not a door: every tap should land.
                    repeatable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`${option.label}${chosen ? `, ${t.backup.selected}` : ''}`}
                    trailing={
                      chosen ? (
                        <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                      ) : null
                    }
                  />
                  {index < frequencies.length - 1 ? (
                    <View style={{ height: 1, backgroundColor: theme.color.border }} />
                  ) : null}
                </View>
              );
            })}
          </Card>
          {/* Not in a build that cannot back up at all: the card at the top
              already says why, and "the steps above" would point at nothing. */}
          {settled &&
          !setup.complete &&
          !setup.unavailable &&
          backup.settings.frequency !== BackupFrequency.Off ? (
            <Callout tone="warning">{t.backup.frequencyBlocked}</Callout>
          ) : null}
          <Text variant="micro" tone="faint">
            {t.backup.frequencyNote}
          </Text>
        </View>

        {/* Over which networks. The same vocabulary the sync setting uses. */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.backup.networkSection} />
          <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
            {networks.map((option, index) => {
              const chosen = backup.settings.network === option.value;
              return (
                <View key={option.value}>
                  <ListRow
                    title={option.label}
                    onPress={() => void backup.setNetwork(option.value)}
                    // A picker row, not a door: every tap should land.
                    repeatable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`${option.label}${chosen ? `, ${t.backup.selected}` : ''}`}
                    leading={
                      <Ionicons
                        name={
                          option.value === SyncNetworkPreference.Wifi
                            ? 'wifi-outline'
                            : 'globe-outline'
                        }
                        size={iconSize.xl}
                        color={theme.color.text}
                      />
                    }
                    trailing={
                      chosen ? (
                        <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                      ) : null
                    }
                  />
                  {index < networks.length - 1 ? (
                    <View style={{ height: 1, backgroundColor: theme.color.border }} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>

        {/* Getting it back, for the phone that is not obviously asking for it.
            A phone with nothing on it has already been offered this as the
            card's own button, so here it would be the same tap twice.
            Otherwise it is one row and no paragraph: somebody who wants it
            knows what the word means, and somebody who does not should not have
            to read three lines to find out it is not for them. */}
        {!restoreFirst ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
              <ListRow
                title={t.backup.restoreSection}
                // A row with no `onPress` is drawn but not pressable, which is
                // what a blocked restore wants: the reason sits under it and
                // the way back stays visible even while it cannot be taken.
                onPress={restoreReason !== null || busy ? undefined : () => void onCheckForBackup()}
                leading={
                  <Ionicons
                    name="cloud-download-outline"
                    size={iconSize.xl}
                    color={theme.color.text}
                  />
                }
                trailing={
                  pending === 'scan' ? (
                    <ActivityIndicator size="small" color={theme.color.textFaint} />
                  ) : (
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  )
                }
              />
            </Card>
            {restoreReason ? (
              <Text variant="micro" tone="faint">
                {restoreReason}
              </Text>
            ) : restoreNote ? (
              <Text variant="micro" tone="muted">
                {restoreNote}
              </Text>
            ) : restored !== null ? (
              <Text variant="micro" tone="muted">
                {plural(locale, restored, t.backup.restoreDone)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* The way out of the one blocked state that has one. On Standard it
            appears only once a scan has actually found a backup this phone
            cannot open: offering "I already have a key" to somebody who was
            never given one is a question with no answer, and it would quietly
            undercut the tier's promise that nothing has to be kept. */}
        {settled &&
        backup.configured &&
        backup.connected &&
        !backup.hasKey &&
        (extra || needsOldKey) ? (
          <Button
            label={t.backup.keyEnter}
            variant="secondary"
            onPress={onEnterKey}
            disabled={busy}
            fullWidth
          />
        ) : null}

        {/* Extra protection: no longer offered, and deliberately not removed.
            It is the tier whose key lives only on this phone, and it asks
            somebody to keep 64 characters safe for ever — a fair trade for a
            person who wants it, and a trap for everybody who does not read the
            sheet, which on a screen meant to be obvious is most people. So the
            door is gone for anybody not already through it.

            It is still drawn for anybody who *is*, and that is not politeness:
            their backup is sealed under a key this screen is the only way back
            to, so hiding the row would strand the Drive file for good. */}
        {settled && !setup.unavailable && extra ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.backup.extraSection} />
            <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
              <ListRow
                title={t.backup.extraSection}
                // Both states open something. "On" opens the sheet that says
                // what it means and why there is no switch back; a row that
                // read "On" and did nothing would be the disabled-and-silent
                // control this screen was rebuilt to get rid of.
                onPress={() => setPitching(true)}
                accessibilityLabel={`${t.backup.extraSection}, ${
                  extra ? t.backup.extraOn : t.backup.extraOff
                }`}
                leading={
                  <Ionicons
                    name={extra ? 'shield-checkmark' : 'shield-outline'}
                    size={iconSize.xl}
                    color={extra ? theme.color.positive : theme.color.text}
                  />
                }
                trailing={
                  <Row gap={theme.spacing.xs}>
                    <Text variant="body" tone="muted">
                      {extra ? t.backup.extraOn : t.backup.extraOff}
                    </Text>
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  </Row>
                }
              />
            </Card>
            <Text variant="micro" tone="faint">
              {extra ? t.backup.extraFootnoteOn : t.backup.extraFootnoteOff}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* The key: shown once on the way into Extra protection, or again later
          on request. One sheet, two jobs — and the upgrade job is the one that
          carries the consent gate, because the tap after it deletes Drive's
          copy of the old key. */}
      <Sheet visible={shownKey !== null} onClose={closeKeySheet} closeLabel={t.common.close}>
        {/* A definite `maxHeight` in points and `flexGrow: 0`, per the Sheet's
            own contract: a percentage against a parent that has no height of
            its own silently clips the last control off the bottom, which here
            would be the button that finishes the upgrade. */}
        <ScrollView
          style={{ flexGrow: 0, maxHeight: KEY_SHEET_MAX_HEIGHT }}
          contentContainerStyle={{ gap: theme.spacing.md }}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="heading">{upgrading ? t.backup.extraKeyTitle : t.backup.keyTitle}</Text>
          {upgrading ? (
            <Text variant="body" tone="muted">
              {t.backup.extraKeyBody}
            </Text>
          ) : null}
          <Card flat style={{ backgroundColor: theme.color.surfaceMuted }}>
            <Text
              variant="body"
              // Monospace so the groups line up and a mistyped character is
              // visible; selectable so it can be dragged out as well as copied.
              selectable
              style={{ fontFamily: 'monospace', letterSpacing: 1, lineHeight: 24 }}
            >
              {shownKey ? formatRecoveryKey(shownKey) : ''}
            </Text>
          </Card>
          {/* WhatsApp's warning card, and deliberately not a red one: black on
              the ordinary surface, bordered, with a triangle as the only alarm
              signal. Red is reserved on this screen for something that has
              already gone wrong — using it here would spend the same colour on
              a consequence that has not happened and may never. */}
          <Card
            flat
            style={{
              borderWidth: 1,
              borderColor: theme.color.border,
              gap: theme.spacing.sm,
              alignItems: 'center',
            }}
          >
            <Ionicons name="warning-outline" size={iconSize.xxl} color={theme.color.text} />
            <Text variant="caption" align="center">
              {t.backup.keyWarning}
            </Text>
          </Card>
          {/* Uniswap names the account it is about to strand and shows its
              balance. The equivalent here is how much ledger is going behind
              this key — an abstraction ("your backup") is easy to shrug at, a
              number is not. */}
          {upgrading ? (
            <Text variant="micro" tone="muted" align="center">
              {plural(
                locale,
                backup.settings.last?.records ?? backup.recordCount,
                t.backup.extraCovers,
              )}
            </Text>
          ) : null}

          {upgrading ? (
            <>
              <Button
                label={copied ? t.backup.keyCopied : t.backup.keyCopy}
                variant="secondary"
                onPress={() => {
                  if (!shownKey) return;
                  void Clipboard.setStringAsync(formatRecoveryKey(shownKey));
                  setCopied(true);
                }}
                disabled={pending === 'extra'}
                fullWidth
              />
              {/* Solflare's gate. A confirm button on its own is answered
                  reflexively, and what follows this one cannot be undone: the
                  escrowed key leaves Drive and the old backup is re-locked.
                  The sentence is Uniswap's shape — an assertion in the past
                  tense, and a consequence that names who cannot help. */}
              <Row gap={theme.spacing.md} style={{ alignItems: 'flex-start' }}>
                <Text variant="caption" style={{ flex: 1 }}>
                  {t.backup.extraConsent}
                </Text>
                <Toggle
                  value={understood}
                  onValueChange={setUnderstood}
                  disabled={pending === 'extra'}
                  accessibilityLabel={t.backup.extraConsent}
                />
              </Row>
              <Button
                label={t.backup.extraTurnOn}
                onPress={() => void onCommitExtra()}
                // The reason it will not press is the row directly above it,
                // which is the whole of Solflare's answer to "no control is
                // disabled and silent": the gate is the explanation.
                disabled={!understood || pending === 'extra'}
                icon={pending === 'extra' ? spinner(true) : undefined}
                fullWidth
              />
              {pending === 'extra' ? (
                <Text variant="micro" tone="muted" align="center">
                  {t.backup.extraTurningOn}
                </Text>
              ) : null}
            </>
          ) : (
            <Row style={{ gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={copied ? t.backup.keyCopied : t.backup.keyCopy}
                  variant="secondary"
                  onPress={() => {
                    if (!shownKey) return;
                    void Clipboard.setStringAsync(formatRecoveryKey(shownKey));
                    setCopied(true);
                  }}
                  fullWidth
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t.backup.keyConfirm}
                  onPress={() => {
                    void backup.confirmKeySeen();
                    setShownKey(null);
                  }}
                  fullWidth
                />
              </View>
            </Row>
          )}
        </ScrollView>
      </Sheet>

      {/* Extra protection, explained — the pitch when it is off, and what it
          means when it is on. WhatsApp's equivalent screen carries no warning
          at all: benefit, then mechanism, then who is locked out, then one
          button. The warning belongs on the *next* screen, next to the key,
          which is where ours is. */}
      <Sheet visible={pitching} onClose={() => setPitching(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{extra ? t.backup.extraOnTitle : t.backup.extraPitchTitle}</Text>
          {extra ? (
            <>
              <Text variant="body" tone="muted">
                {t.backup.extraOnBody}
              </Text>
              {/* Said here rather than left to be discovered: there is no
                  switch back, and the route that does exist is a different
                  control on this screen. See the file header on why. */}
              <Text variant="body" tone="muted">
                {t.backup.extraNoWayBack}
              </Text>
            </>
          ) : (
            <>
              <Text variant="body" tone="muted">
                {t.backup.extraPitchBenefit}
              </Text>
              <Text variant="body" tone="muted">
                {t.backup.extraPitchMechanism}
              </Text>
              <Text variant="body" tone="muted">
                {t.backup.extraPitchAdversary}
              </Text>
              <Button label={t.backup.extraTurnOn} onPress={onOfferExtra} fullWidth />
            </>
          )}
        </View>
      </Sheet>

      {/* A key brought over from the phone that made the backup. */}
      <Sheet visible={entering} onClose={() => setEntering(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.keyEnterTitle}</Text>
          <Text variant="micro" tone="muted">
            {t.backup.keyEnterBody}
          </Text>
          <Card flat style={{ backgroundColor: theme.color.surfaceMuted, gap: theme.spacing.sm }}>
            <TextInput
              value={typedKey}
              onChangeText={(value) => {
                setTypedKey(value);
                setTypedProblem(null);
              }}
              placeholder={t.backup.keyEnterPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.backup.keyEnterTitle}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={{
                minHeight: 72,
                fontSize: 16,
                fontFamily: 'monospace',
                color: theme.color.text,
                textAlignVertical: 'top',
                // A key is hexadecimal in either direction; forcing LTR keeps it
                // readable, and typed correctly, in an Arabic layout.
                writingDirection: 'ltr',
              }}
            />
            {/* The three things a long-string field owes the person typing into
                it: somewhere to paste from, what the right answer looks like,
                and a way to ask what is even being asked for. A 64-character
                key is not typed by hand if there is any alternative. */}
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button
                label={t.backup.keyEnterPaste}
                variant="ghost"
                size="sm"
                onPress={() => {
                  void (async () => {
                    const clip = await Clipboard.getStringAsync().catch(() => '');
                    if (!clip) return;
                    setTypedKey(clip);
                    setTypedProblem(null);
                  })();
                }}
              />
            </Row>
          </Card>
          <Text variant="micro" tone="faint">
            {t.backup.keyEnterHint}
          </Text>
          {typedProblem ? <Callout tone="negative">{typedProblem}</Callout> : null}
          <Button label={t.backup.keyEnterSave} onPress={() => void onAcceptKey()} fullWidth />
          {/* The escape hatch for somebody who does not recognise the question.
              A door rather than a paragraph: most people typing here know
              exactly what they are holding. */}
          <Button
            label={explaining ? t.common.close : t.backup.keyEnterWhat}
            variant="ghost"
            size="sm"
            onPress={() => setExplaining((open) => !open)}
            fullWidth
          />
          {explaining ? (
            <Text variant="micro" tone="muted">
              {t.backup.keyEnterWhatBody}
            </Text>
          ) : null}
        </View>
      </Sheet>

      {/* What a restore would bring back, before it brings anything back. */}
      <Sheet visible={found !== null} onClose={() => setFound(null)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.restoreSection}</Text>
          {found ? (
            <>
              {/* Date and size, the two things WhatsApp's restore card shows,
                  plus the one nobody in the field shows and a ledger badly
                  needs: how much of it is actually coming back. */}
              <Text variant="micro" tone="muted">
                {t.backup.restoreFrom.replace(
                  '{date}',
                  found.body.createdAt ? dateTime(Date.parse(found.body.createdAt)) : '—',
                )}
                {found.size > 0 ? ` · ${formatBytes(found.size, locale)}` : ''}
              </Text>
              <Text variant="body">
                {found.plan.restore.length === 0
                  ? t.backup.restoreNothingNew
                  : plural(locale, found.plan.restore.length, t.backup.restoreFound)}
              </Text>
              {found.plan.restore.length > 0 ? (
                <Button
                  label={t.backup.restoreConfirm}
                  onPress={() => void onRestore()}
                  disabled={busy}
                  icon={pending === 'restore' ? spinner(true) : undefined}
                  fullWidth
                />
              ) : null}
            </>
          ) : null}
        </View>
      </Sheet>

      {/* A backup that is there and will not open from this phone.
          Deliberately not an error: the question asked was "is there a backup",
          and the answer is yes. What the sheet adds is which kind it is and
          what opening it takes — the fork before the attempt, which is how
          every restore flow worth copying does it, rather than a wall somebody
          walks into halfway through. */}
      <Sheet
        visible={blocked !== null}
        onClose={() => setBlocked(null)}
        closeLabel={t.common.close}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.restoreFoundTitle}</Text>
          {blocked?.found ? (
            <Text variant="micro" tone="muted">
              {t.backup.restoreFrom.replace(
                '{date}',
                blocked.found.createdAt ? dateTime(Date.parse(blocked.found.createdAt)) : '—',
              )}
              {blocked.found.size > 0 ? ` · ${formatBytes(blocked.found.size, locale)}` : ''}
            </Text>
          ) : null}
          <Text variant="body">
            {blocked?.refusal === 'needs-key' ? t.backup.restoreIsExtra : t.backup.refusedKeyLost}
          </Text>
          {blocked?.refusal === 'needs-key' ? (
            // The key path *is* the primary here, because on this file it is
            // the only path. The one button this sheet must never carry is
            // "create a key": a new one does not open this backup, and making
            // one arms a run that would overwrite it.
            <Button
              label={t.backup.keyEnter}
              onPress={() => {
                setBlocked(null);
                onEnterKey();
              }}
              fullWidth
            />
          ) : null}
        </View>
      </Sheet>

      {/* What the screen used to say in a paragraph under the status card.
          It is the promise, so it may not be dropped — but it answers "how does
          this work", which is a question asked once, and it was sitting between
          the button somebody came for and the account they came to check. The
          status card already carries the half that has to be read every time:
          which key locks this, and therefore who can open it. */}
      <Popup visible={about} onClose={() => setAbout(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.aboutTitle}</Text>
          <Text variant="body" tone="muted">
            {extra ? t.backup.introExtra : t.backup.introStandard}
          </Text>
        </View>
      </Popup>

      <Popup visible={unlinking} onClose={() => setUnlinking(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.disconnectTitle}</Text>
          {/* What unlinking costs is different in each tier, and neither
              sentence would be true of the other. On Standard the key goes with
              the account, which is also why relinking is the honest way back to
              Standard from Extra — see the file header. */}
          <Text variant="body" tone="muted">
            {extra ? t.backup.disconnectBodyExtra : t.backup.disconnectBodyStandard}
          </Text>
          <Row style={{ gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t.common.cancel}
                variant="ghost"
                onPress={() => setUnlinking(false)}
                fullWidth
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t.backup.disconnect}
                variant="danger"
                onPress={() => void onUnlink()}
                fullWidth
              />
            </View>
          </Row>
        </View>
      </Popup>
    </Screen>
  );
}
