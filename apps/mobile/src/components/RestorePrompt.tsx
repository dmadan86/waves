/**
 * The offer, made once on the dashboard, to bring a Drive backup back.
 *
 * ## Why it is on Home and not in settings
 *
 * A backup that nobody is told about at the moment they need it is a backup
 * that does not exist. The moment is the first dashboard after a sign-in on a
 * phone that holds nothing: a new handset, a reinstall, a sign-out and back in.
 * Until now the only route to a restore was knowing it was there — ••• on Home,
 * then Backup — and going looking before typing anything in, which is precisely
 * the order nobody does things in. So the app asks, once, in the one second
 * where the answer is obvious.
 *
 * ## The one thing it must never do
 *
 * Appear for somebody who already has their data. `lib/backup/restorePrompt`
 * holds that decision and the reasoning behind every condition; this file is
 * the surface, and it takes care to feed that function only settled answers —
 * `settled` below is why an empty mirror mid-first-sync is not mistaken for an
 * empty ledger.
 *
 * ## Why the tap leaves this screen
 *
 * It goes to the Backup screen with `?restore=<nonce>`, which links Drive if it
 * is not linked and then runs the same scan the "Restore my data" button there
 * has always run. One tap from here; the person never sees the join.
 *
 * Rebuilding the scan in this popup was the alternative and it was the wrong
 * one. A restore has four outcomes past "found it" — nothing on Drive, a backup
 * under extra protection that wants a key, a standard backup whose escrowed key
 * is gone, a dead grant — and each has a fork the Backup screen already draws.
 * A second copy of that would be a second thing to keep true about somebody's
 * ledger. The popup asks the question; the screen that owns restoring answers
 * it.
 *
 * That also keeps this component cheap. It never mounts `useBackup` — which
 * reads the personal ledger and asks Google for the linked address over the
 * network — for the same reason the sign-out guard does not: this runs on the
 * dashboard, and the dashboard must not pay a Drive round trip to decide
 * whether to draw a card. Two leaf reads (the tokens on disk, the dismissal
 * flag) and a count the sync context already holds are the whole cost, and the
 * token read only decides one sentence of copy.
 *
 * ## Dismissal
 *
 * Sticky until the next sign-in on this device, for this account. See
 * `restorePrompt.ts`; the flag is written by `markRestorePromptDismissed`,
 * which is owner-scoped and rides the sign-out wipe. Taking the offer marks it
 * too — the question has been asked and answered either way, and a second
 * identical popup because the scan found nothing would be the app asking twice.
 */

import { useCallback, useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Button, Popup, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { loadRestorePromptDismissed, markRestorePromptDismissed } from '@/lib/backup/settings';
import { restoreOffer, RestoreOffer } from '@/lib/backup/restorePrompt';
import { PRIMARY_PROVIDER } from '@/lib/backup/engine';
import { providerFor } from '@/lib/cloud/providers';
import { loadTokens } from '@/lib/cloud/tokens';
import { router } from '@/lib/navigation';
import { usePromptSlot } from '@/lib/promptQueue';
import { usePersonalRecords } from '@/data/personal';
import { useSync } from '@/sync';

/**
 * Where this sits among the things that want the first screen: under the tour
 * (interrupting a coach-mark halfway is worse than waiting a beat) and over the
 * push soft-ask, the campaign and the guest card. Getting a ledger back outranks
 * all three, and none of them is lost by waiting — each holds its claim and is
 * granted the moment this one releases.
 */
const PROMPT_PRIORITY = 90;

/** A beat after the dashboard has settled, so the card arrives rather than flashes. */
const PROMPT_DELAY_MS = 400;

/** What the two local reads say about one account. */
interface AccountReads {
  /** Whose answers these are — see `useAccountReads` for why it is carried. */
  readonly owner: string;
  /** This account has already answered the offer on this device. */
  readonly dismissed: boolean;
  /** A Drive account is linked. Chooses the copy, never the answer. */
  readonly linked: boolean;
}

/**
 * The dismissal flag and the Drive tokens, read together and stamped with whose
 * they are.
 *
 * Both defaults are the dangerous ones — "not dismissed" would show the popup
 * to somebody who closed it, "not linked" would promise a linked phone a Google
 * consent sheet it is not about to see — so nothing may be decided until both
 * have landed. That is what the stamp is for: readiness is `owner === ownerId`
 * rather than a flag somebody has to remember to lower, so switching accounts
 * re-arms it for free instead of showing B the answers A gave. The same shape
 * `useBackup` uses for its own first read, and for the same reason.
 *
 * Read together because they are two disk reads on the same event with nothing
 * to say to each other, and because a half-read state has no meaning here.
 * Neither can throw into the screen: a failure reads as "not answered", which
 * costs one repeat rather than silently burying the feature.
 */
function useAccountReads(ownerId: string): {
  reads: AccountReads | null;
  dismiss: () => void;
} {
  const [reads, setReads] = useState<AccountReads | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [dismissed, tokens] = await Promise.all([
        loadRestorePromptDismissed(ownerId).catch(() => false),
        loadTokens(PRIMARY_PROVIDER, ownerId).catch(() => null),
      ]);
      if (alive) setReads({ owner: ownerId, dismissed, linked: tokens !== null });
    })();
    return () => {
      alive = false;
    };
  }, [ownerId]);

  // State first, disk after: the popup goes away on the tap rather than a round
  // trip later, and a write that fails costs one repeat, not a stuck card.
  const dismiss = useCallback(() => {
    setReads((current) => (current ? { ...current, dismissed: true } : current));
    void markRestorePromptDismissed(ownerId).catch(() => {});
  }, [ownerId]);

  return { reads, dismiss };
}

export function RestorePrompt(): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const { session, isGuest } = useAuth();
  const ownerId = session?.user?.id ?? '';

  const records = usePersonalRecords();
  const { hydrated, status, lastSyncedAt } = useSync();
  const { reads, dismiss } = useAccountReads(ownerId);

  // A build with no OAuth client id can neither back up nor restore, so there is
  // nothing here to offer. Synchronous — it is a compiled-in constant plus a
  // native-module check, not a lookup.
  const configured = providerFor(PRIMARY_PROVIDER).isConfigured();

  /**
   * "We have actually looked." The mirror off disk is not enough on its own: the
   * personal ledger arrives with the ordinary sync pull, so between hydration
   * and the session's first successful sync every phone in the world holds zero
   * records. That window is exactly where a returning user would be asked
   * whether they had lost their data.
   *
   * Bounded the same way the dashboard's own `pendingFirstSync` is (see
   * `data/hooks`): the first flush resolves either to `lastSyncedAt` being set
   * or to a status that says the network cannot answer, and in the second case
   * the local snapshot is the best there is and the question becomes fair again.
   */
  const firstSyncPending =
    hydrated && lastSyncedAt === null && (status === 'idle' || status === 'syncing');
  const settled = reads?.owner === ownerId && hydrated && !firstSyncPending;

  const offer = restoreOffer({
    signedIn: Boolean(session),
    isGuest,
    configured,
    connected: reads?.linked ?? false,
    recordCount: records.length,
    settled,
    dismissed: reads?.dismissed ?? false,
  });
  const wants = offer !== RestoreOffer.None;

  // Take a turn in the shared prompt queue rather than firing on its own, and
  // claim only while the offer genuinely stands — so a phone with data never
  // holds the slot the guest card and the daily tip are queued behind.
  const granted = usePromptSlot({
    id: 'restorePrompt',
    priority: PROMPT_PRIORITY,
    active: wants,
    delayMs: PROMPT_DELAY_MS,
  });

  /**
   * Hand the whole job to the Backup screen, which links first when it has to.
   * The nonce is what tells that screen this is a fresh instruction rather than
   * an Android activity recreation replaying the same URL — see `consumedStarts`
   * there.
   */
  const onRestore = (): void => {
    dismiss();
    router.push({ pathname: '/settings/backup', params: { restore: String(Date.now()) } });
  };

  if (!wants || !granted) return null;

  return (
    <Popup
      visible
      onClose={dismiss}
      closeLabel={t.backup.restorePromptLaterLabel}
      style={{ maxWidth: 360, alignItems: 'center', gap: theme.spacing.lg }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme.color.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="cloud-download-outline" size={38} color={theme.color.brand} />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading" align="center">
          {t.backup.restorePromptTitle}
        </Text>
        {/* Two bodies, one tap. An unlinked phone is about to be handed Google's
            consent sheet, and being handed one unannounced is how a restore
            turns into "why is it asking for my Google account". */}
        <Text variant="body" tone="muted" align="center">
          {offer === RestoreOffer.LinkFirst
            ? t.backup.restorePromptBodyLink
            : t.backup.restorePromptBody}
        </Text>
      </View>

      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
        <Button
          label={t.backup.restoreNow}
          accessibilityLabel={t.backup.restorePromptRestoreLabel}
          size="lg"
          fullWidth
          onPress={onRestore}
        />
        <Button
          label={t.backup.restorePromptLater}
          accessibilityLabel={t.backup.restorePromptLaterLabel}
          variant="ghost"
          size="lg"
          fullWidth
          onPress={dismiss}
        />
        {/* Declining has to cost nothing, and saying so is the difference
            between a postponement and a door closing. */}
        <Text variant="micro" tone="muted" align="center">
          {t.backup.restorePromptWhere}
        </Text>
      </View>
    </Popup>
  );
}
