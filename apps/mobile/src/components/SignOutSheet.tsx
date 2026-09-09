/**
 * The sheet that stands between somebody and signing out.
 *
 * Signing out is not a neutral act on this app: the `SyncProvider` wipes the
 * mirror, the queue, the drafts, the receipt bytes and this account's backup
 * credentials the moment the session goes, because the next person to hold this
 * phone must not find the last account's ledger on it. Everything the server
 * already has comes back on the next sign-in — but a mutation still in the
 * queue has reached nobody, a refusal is being kept *only* here, an expense
 * somebody was still typing was never submitted at all, and the backup recovery
 * key exists in one keystore in the world. A plain "Sign out?" alert over that
 * is a trapdoor.
 *
 * So this says what is about to go, and offers the two ways to keep it, and
 * then gets out of the way. Nothing here blocks the sign-out: a person handing
 * back a borrowed phone must be able to leave right now, and a dialog that
 * holds somebody's account open until an upload succeeds is a worse failure
 * than a lost draft. The warning is honest and the door stays unlocked.
 *
 * Three shape rules, each of them the fix for a way the first version misled:
 *
 * 1. **The alarm is proportional.** With nothing queued, signing out costs
 *    nothing that does not come back, so the sheet says exactly that in one
 *    line and shows two buttons. The warning language, the list and the two
 *    precautions appear only when there is something on this phone the account
 *    has never seen. A sheet that shouts at everybody teaches people to tap
 *    through the shout.
 * 2. **The list is never promised without being shown.** The lead line points
 *    at the rows below it, so the rows have to be laid out where they can be
 *    seen. They used to sit in a `ScrollView` nested one `View` deep, which
 *    measured short and clipped: the warning said "listed below" over an empty
 *    white gap. The scroll region is now a direct child of the sheet with a
 *    definite `maxHeight` in points — the shape that hugs its content instead
 *    of guessing at it — and its indicator is on, so a list that really is too
 *    long to fit says so.
 * 3. **Weight follows consequence.** Signing out is the destructive thing being
 *    confirmed, so it is the filled red button; staying is the soft one right
 *    under it, full width and impossible to miss; and the two ways to keep the
 *    data are small and sit with the list they protect, because a precaution
 *    drawn at full width above the decision reads as the recommended path.
 *
 * The copy button writes a plain JSON snapshot of everything on the device
 * (`saveDeviceCopy`) — the unsent queue and the drafts included — and hands it
 * to the share sheet. It never touches the network, because the case it exists
 * for is a device holding changes that could not be sent. It holds no receipt
 * photographs, which is why the sheet says so out loud rather than letting the
 * file quietly not contain them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import {
  materialiseArchivedGroups,
  materialiseGroups,
  unsentWork,
  type DeviceDraft,
} from '@waves/core';
import { Button, Callout, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { plural, useStrings } from '@/i18n';
import { loadRecoveryKey } from '@/lib/backup/recoveryKey';
import { loadBackupSettings } from '@/lib/backup/settings';
import { useAuth } from '@/lib/auth';
import { saveDeviceCopy } from '@/lib/deviceCopy';
import { friendlyError } from '@/lib/errors';
import { reportHandled } from '@/lib/observability';
import {
  flushReceiptQueue,
  getPendingReceiptsSnapshot,
  usePendingReceipts,
} from '@/lib/receiptQueue';
import { syncEngine, SyncStatus, useSync } from '@/sync';

/** What the two work buttons are doing, so neither can be pressed twice. */
type Busy = 'none' | 'sync' | 'copy';

/** How many group names the "changes to your groups" row will name before it
 *  stops. Three is a line; a device holding work in eight groups wants a count,
 *  not a paragraph, and the count is already the line above it. */
const NAMED_GROUPS = 3;

/** The round tinted mark this app puts at the head of a settings row, reused
 *  here so the sheet is built out of the same parts as the screen behind it. */
function Chip({
  icon,
  bg,
  ink,
  size,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  bg: string;
  ink: string;
  size: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={ink} />
    </View>
  );
}

/**
 * One "this is still only here" line.
 *
 * Read as a single item by a screen reader — the count and the detail under it
 * are one fact, and hearing them as two lines loses which belongs to which when
 * there are four of them.
 */
function RiskRow({
  icon,
  label,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
}) {
  const theme = useTheme();
  return (
    <Row
      accessible
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={{ gap: theme.spacing.md, alignItems: 'center' }}
    >
      <Chip icon={icon} bg={theme.color.warningSoft} ink={theme.color.warning} size={36} />
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

/**
 * The autosaved forms this device is holding, re-read each time the sheet opens.
 *
 * Nothing else in the app wants the whole list — a form reads back its own
 * draft by key and that is that — so there is no context to take this from, and
 * the store is the only source. Gated on `visible` because this sheet lives
 * mounted and closed on the Profile tab: an ungated read would touch the disk
 * for a sheet nobody has opened, every time somebody looks at their profile.
 */
function useDeviceDrafts(visible: boolean): readonly DeviceDraft[] {
  const [drafts, setDrafts] = useState<readonly DeviceDraft[]>([]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void syncEngine
      .listDrafts()
      .then((rows) => {
        if (alive) setDrafts(rows);
      })
      .catch((error: unknown) => reportHandled(error, 'signOut.listDrafts'));
    return () => {
      alive = false;
    };
  }, [visible]);
  return drafts;
}

/**
 * Whether this device holds a backup recovery key nobody has confirmed writing
 * down — the one loss that happens even when every last change has synced.
 *
 * The two leaf readers rather than `useBackup`: that hook mounts the personal
 * ledger and asks Google over the network for the linked address, which is a
 * great deal of machinery to run on the Profile tab for one boolean. `keySeen`
 * narrows it to the case that is actually a loss: a key that exists only in
 * this keystore, which sign-out clears (`clearBackupState`). Once somebody has
 * written it down there is nothing here to warn about — the file on Drive
 * outlives the app either way.
 */
function useUnconfirmedBackupKey(visible: boolean, ownerId: string): boolean {
  const [atRisk, setAtRisk] = useState(false);
  useEffect(() => {
    if (!visible || !ownerId) return;
    let alive = true;
    void (async () => {
      const [key, settings] = await Promise.all([
        loadRecoveryKey(ownerId),
        loadBackupSettings(ownerId),
      ]);
      if (alive) setAtRisk(key !== null && !settings.keySeen);
    })().catch((error: unknown) => reportHandled(error, 'signOut.backupKey'));
    return () => {
      alive = false;
    };
  }, [visible, ownerId]);
  return atRisk;
}

export function SignOutSheet({
  visible,
  onClose,
  onSignOut,
}: {
  visible: boolean;
  onClose: () => void;
  /** Runs the actual sign-out. This sheet never decides *whether* — only informs. */
  onSignOut: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { session, isGuest } = useAuth();
  const { mirror, queue, status, flush } = useSync();
  const receipts = usePendingReceipts();
  const { height: screenHeight } = useWindowDimensions();

  const ownerId = session?.user?.id ?? '';
  const drafts = useDeviceDrafts(visible);
  const backupKeyAtRisk = useUnconfirmedBackupKey(visible, ownerId);
  const work = useMemo(() => unsentWork(queue, ownerId), [queue, ownerId]);
  // A receipt that has been sent stays in the queue a while so its tile keeps
  // its place; only the ones still owed are at risk.
  const unsentReceipts = receipts.filter((item) => item.status !== 'sent').length;
  const atRisk = work.total + unsentReceipts + drafts.length;
  // What "Sync now" could actually move. Receipts count: they go out through
  // their own queue, and leaving them out of this gated the button away from a
  // device whose only unsent thing was a photograph it could have sent.
  const sendable = work.personal + work.other + unsentReceipts > 0;

  /**
   * The names of the groups the unsent changes belong to.
   *
   * "3 changes to your groups" is a number somebody has to take on trust; "3
   * changes to your groups / Goa trip · Flatmates" is one they can check
   * against what they remember doing. The ids come off the queue and the names
   * off the mirror, archived groups included, so an unsent change to a trip
   * that has since been put away is still named rather than silently dropped.
   * Ids with no group behind them — the personal scope, the capture inbox — do
   * not resolve and fall out here, which is right: they have their own rows.
   */
  const groupNames = useMemo(() => {
    if (work.other + work.refused === 0) return undefined;
    const named = new Map<string, string>();
    for (const group of [
      ...materialiseGroups(mirror, queue),
      ...materialiseArchivedGroups(mirror, queue),
    ]) {
      if (group.name) named.set(group.id, group.name);
    }
    const seen: string[] = [];
    for (const item of queue) {
      const name = named.get(item.groupId);
      if (name !== undefined && !seen.includes(name)) seen.push(name);
    }
    if (seen.length === 0) return undefined;
    return seen.length > NAMED_GROUPS
      ? `${seen.slice(0, NAMED_GROUPS).join(' · ')} …`
      : seen.join(' · ');
  }, [mirror, queue, work.other, work.refused]);

  const [busy, setBusy] = useState<Busy>('none');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const offline = status === SyncStatus.Offline || status === SyncStatus.Metered;

  const syncNow = useCallback(async (): Promise<void> => {
    setBusy('sync');
    setError(null);
    try {
      // The photographs go out through their own queue, and they go first —
      // the same order `resumeReceiptUploads` uses, and for its reason: each
      // upload records an attachment row server-side, and the flush below is
      // what pulls those rows back down. Sending the bytes without that pull
      // would leave the gallery drawing optimistic tiles for receipts that had
      // already landed.
      if (unsentReceipts > 0) await flushReceiptQueue();
      await flush();
      // `flush` records a failed round trip on the engine instead of throwing
      // it, so the catch below never fires for the case this button exists
      // for — a dead network, a timeout, a server having a bad minute. Asked
      // nothing afterwards, a sync that sent nothing looked exactly like one
      // that sent everything, on the one screen where that difference is the
      // whole point.
      const after = syncEngine.getState();
      if (after.status === SyncStatus.Error) {
        setError(friendlyError(after.lastError, t.signOutSheet.syncFailed, 'signOut.flush'));
      } else if (getPendingReceiptsSnapshot().some((item) => item.status !== 'sent')) {
        // A receipt flush is best-effort and never throws: a capture the server
        // refused, or one whose bytes would not go, simply stays in the queue.
        // The row above it already says so, but leaving the press itself silent
        // would read as "sent" — the one thing this sheet must not imply.
        setError(t.signOutSheet.syncFailed);
      }
    } catch (caught) {
      setError(friendlyError(caught, t.signOutSheet.syncFailed, 'signOut.flush'));
    } finally {
      setBusy('none');
    }
  }, [flush, unsentReceipts, t]);

  const download = useCallback(async (): Promise<void> => {
    setBusy('copy');
    setError(null);
    setSaved(null);
    try {
      const result = await saveDeviceCopy({
        mirror,
        queue,
        drafts,
        ownerId,
        dialogTitle: t.signOutSheet.copyShareTitle,
      });
      // The temporary is deleted as soon as the share sheet closes, so a
      // platform with no share sheet ends the run holding nothing — and
      // "Saved …" over that would be the exact lie this sheet exists to avoid.
      if (result.shared) {
        setSaved(`${result.filename} · ${Math.ceil(result.sizeBytes / 1024)} KB`);
      } else {
        setError(t.signOutSheet.copyFailed);
      }
    } catch (caught) {
      setError(friendlyError(caught, t.signOutSheet.copyFailed, 'signOut.copy'));
    } finally {
      setBusy('none');
    }
  }, [mirror, queue, drafts, ownerId, t]);

  // Nothing queued and no key to lose is the ordinary case, and it is not a
  // dangerous one — the head mark then says "safe", not "look out".
  const alarmed = atRisk > 0 || backupKeyAtRisk;
  const headTone = isGuest
    ? { bg: theme.color.negativeSoft, ink: theme.color.negative }
    : alarmed
      ? { bg: theme.color.warningSoft, ink: theme.color.warning }
      : { bg: theme.color.positiveSoft, ink: theme.color.positive };
  const email = session?.user?.email ?? '';

  // Points, not a percentage: a percentage max-height resolves against a parent
  // with no height of its own here, and a scroll view with no real bound is the
  // thing that clipped the list. Two fifths of the window leaves the title and
  // both doors on screen on the shortest phone we support.
  const bodyMax = Math.round(screenHeight * 0.42);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      style={{ maxHeight: Math.round(screenHeight * 0.88) }}
    >
      <Row style={{ gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
        <Chip
          icon={alarmed || isGuest ? 'alert-circle' : 'shield-checkmark'}
          bg={headTone.bg}
          ink={headTone.ink}
          size={44}
        />
        <View style={{ flex: 1 }}>
          <Text variant="title">{t.lock.signOutQuestion}</Text>
          {email ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t.signOutSheet.signedInAs.replace('{email}', email)}
            </Text>
          ) : null}
        </View>
      </Row>

      <ScrollView
        // `flexGrow: 0` with a definite `maxHeight` is the shape that sizes
        // itself to its content and stops there. Left to grow it measures short
        // inside a sheet that has no height of its own, which is how the list
        // the copy above points at came to be drawn off the bottom of it.
        style={{ flexGrow: 0, flexShrink: 1, maxHeight: bodyMax }}
        contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xs }}
      >
        {/* A guest has no way back into the account at all, which outranks
            everything else on this sheet — so it is said first, and loudest.
            It keeps the panel the rest of the sheet no longer needs: this is
            the one case where the whole account ends, not a copy of it. */}
        {isGuest ? (
          <Callout tone="negative" title={t.signOutSheet.guestTitle}>
            {t.lock.signOutGuestWarning}
          </Callout>
        ) : null}

        <Text variant="body" tone="muted">
          {atRisk === 0 ? t.signOutSheet.allSafeBody : t.signOutSheet.atRiskBody}
        </Text>

        {alarmed ? (
          <View style={{ gap: theme.spacing.sm }}>
            {work.other > 0 ? (
              <RiskRow
                icon="people-outline"
                label={plural(locale, work.other, t.signOutSheet.otherUnsent)}
                hint={groupNames}
              />
            ) : null}
            {/* The private ledger gets its own line rather than being folded
                into the count above: it lives on the Me tab, it is the one
                part of the app nobody else holds a copy of, and somebody who
                keeps their money there deserves to be told by name. */}
            {work.personal > 0 ? (
              <RiskRow
                icon="wallet-outline"
                label={plural(locale, work.personal, t.signOutSheet.personalUnsent)}
              />
            ) : null}
            {work.refused > 0 ? (
              <RiskRow
                icon="alert-circle-outline"
                label={plural(locale, work.refused, t.signOutSheet.refused)}
                hint={t.signOutSheet.refusedHint}
              />
            ) : null}
            {unsentReceipts > 0 ? (
              <RiskRow
                icon="receipt-outline"
                label={plural(locale, unsentReceipts, t.signOutSheet.receiptsUnsent)}
                // The snapshot is JSON: the records go in, the image bytes do
                // not. Said on this row rather than beside the copy button,
                // because it is a fact about the photographs and this is where
                // somebody is already counting them.
                hint={t.signOutSheet.copyExcludesPhotos}
              />
            ) : null}
            {/* A draft was never submitted, so unlike everything above it there
                is no server copy waiting and no queue entry to send — only the
                file can keep it. */}
            {drafts.length > 0 ? (
              <RiskRow
                icon="document-text-outline"
                label={plural(locale, drafts.length, t.signOutSheet.draftsUnsent)}
              />
            ) : null}
            {/* Not unsent work: the recovery key is lost on sign-out whether or
                not anything is queued, which is why it is the one row that can
                appear under an otherwise clear list. */}
            {backupKeyAtRisk ? (
              <RiskRow
                icon="key-outline"
                label={t.signOutSheet.backupKeyTitle}
                hint={t.signOutSheet.backupKeyWarning}
              />
            ) : null}
          </View>
        ) : null}

        {/* Offline is why the copy button is not an afterthought: sending is not
            on the table, so "sync first" would be advice nobody in that moment
            can take. */}
        {atRisk > 0 && offline ? (
          <Text variant="caption" tone="muted">
            {t.signOutSheet.offlineHint}
          </Text>
        ) : null}

        {/* The two ways to keep it, kept small and kept here — beside the list
            they protect rather than above the decision, which is where a
            precaution drawn at full width starts reading as the thing to do. */}
        <Row style={{ gap: theme.spacing.sm }}>
          {sendable && !offline ? (
            <Button
              label={busy === 'sync' ? t.signOutSheet.syncing : t.signOutSheet.syncNow}
              variant="secondary"
              size="sm"
              disabled={busy !== 'none'}
              onPress={() => void syncNow()}
            />
          ) : null}
          <Button
            label={busy === 'copy' ? t.signOutSheet.copying : t.signOutSheet.copyNow}
            variant="ghost"
            size="sm"
            disabled={busy !== 'none'}
            onPress={() => void download()}
          />
        </Row>

        {error ? (
          <Text variant="caption" style={{ color: theme.color.negative }}>
            {error}
          </Text>
        ) : null}
        {saved ? (
          <Text variant="caption" tone="muted">
            {t.signOutSheet.copySaved.replace('{file}', saved)}
          </Text>
        ) : null}
      </ScrollView>

      {/* The doors, in the order the consequence puts them: the destructive one
          wears the destructive colour, and the way out of it is the wide soft
          button directly under the thumb. Neither is gated on anything above —
          this sheet warns, it does not hold anybody hostage. */}
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
        <Button
          label={t.lock.signOut}
          variant="danger"
          fullWidth
          disabled={busy !== 'none'}
          onPress={onSignOut}
        />
        <Button label={t.lock.staySignedIn} variant="secondary" fullWidth onPress={onClose} />
      </View>
    </Sheet>
  );
}
