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
 * The copy button writes a plain JSON snapshot of everything on the device
 * (`saveDeviceCopy`) — the unsent queue and the drafts included — and hands it
 * to the share sheet. It never touches the network, because the case it exists
 * for is a device holding changes that could not be sent. It holds no receipt
 * photographs, which is why the sheet says so out loud rather than letting the
 * file quietly not contain them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { unsentWork, type DeviceDraft } from '@waves/core';
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

/** One "this is still only here" line: a warning glyph and the count in words. */
function RiskRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
      <Ionicons name={icon} size={iconSize.md} color={theme.color.warning} />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
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

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      style={{ maxHeight: '88%' }}
    >
      <View style={{ gap: theme.spacing.lg, flexShrink: 1 }}>
        <Text variant="heading">{t.lock.signOutQuestion}</Text>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: theme.spacing.md }}
        >
          {/* A guest has no way back into the account at all, which outranks
              everything else on this sheet — so it is said first, and loudest. */}
          {isGuest ? (
            <Callout tone="negative" title={t.signOutSheet.guestTitle}>
              {t.lock.signOutGuestWarning}
            </Callout>
          ) : null}

          {/* Deliberately outside the two branches below. The recovery key is
              not unsent work — it is lost on sign-out whether or not anything
              is still queued — so it has to be sayable beside the green
              callout as well as the warning one. That is also why `allSafeBody`
              is scoped to the ledger: "everything comes back" with this
              underneath it would be a contradiction on the same screen. */}
          {backupKeyAtRisk ? (
            <Callout tone="warning" title={t.signOutSheet.backupKeyTitle}>
              {t.signOutSheet.backupKeyWarning}
            </Callout>
          ) : null}

          {atRisk === 0 ? (
            <Callout tone="positive" title={t.signOutSheet.allSafeTitle}>
              {t.signOutSheet.allSafeBody}
            </Callout>
          ) : (
            <>
              <Callout tone="warning" title={t.signOutSheet.atRiskTitle}>
                {t.signOutSheet.atRiskBody}
              </Callout>

              <View style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.xs }}>
                {work.other > 0 ? (
                  <RiskRow
                    icon="people-outline"
                    label={plural(locale, work.other, t.signOutSheet.otherUnsent)}
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
                  />
                ) : null}
                {unsentReceipts > 0 ? (
                  <RiskRow
                    icon="receipt-outline"
                    label={plural(locale, unsentReceipts, t.signOutSheet.receiptsUnsent)}
                  />
                ) : null}
                {/* A draft was never submitted, so unlike everything above it
                    there is no server copy waiting and no queue entry to send —
                    only the file below can keep it. */}
                {drafts.length > 0 ? (
                  <RiskRow
                    icon="document-text-outline"
                    label={plural(locale, drafts.length, t.signOutSheet.draftsUnsent)}
                  />
                ) : null}
              </View>

              {/* Offline is why the copy button is not an afterthought: sending
                  is not on the table, so "sync first" would be advice nobody in
                  that moment can take. */}
              {offline ? (
                <Text variant="caption" tone="muted">
                  {t.signOutSheet.offlineHint}
                </Text>
              ) : null}

              {/* The snapshot is JSON: the records go in, the image bytes do
                  not. Said here, next to the count of photos still on the
                  phone, because "download a copy" one line above it otherwise
                  reads as an offer to keep them. */}
              {unsentReceipts > 0 ? (
                <Text variant="caption" tone="muted">
                  {t.signOutSheet.copyExcludesPhotos}
                </Text>
              ) : null}
            </>
          )}

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

        {/* The two ways to keep the data, then the two doors. The order is
            deliberate — safe first, destructive last — but nothing here is
            gated on anything else: this sheet warns, it does not hold anybody
            hostage. */}
        <View style={{ gap: theme.spacing.sm }}>
          {sendable && !offline ? (
            <Button
              label={busy === 'sync' ? t.signOutSheet.syncing : t.signOutSheet.syncNow}
              variant="primary"
              fullWidth
              disabled={busy !== 'none'}
              onPress={() => void syncNow()}
            />
          ) : null}
          <Button
            label={busy === 'copy' ? t.signOutSheet.copying : t.signOutSheet.copyNow}
            variant="secondary"
            fullWidth
            disabled={busy !== 'none'}
            onPress={() => void download()}
          />
          <Button
            label={t.lock.signOut}
            variant="ghostDanger"
            fullWidth
            disabled={busy !== 'none'}
            onPress={onSignOut}
          />
          <Button label={t.lock.staySignedIn} variant="ghost" fullWidth onPress={onClose} />
        </View>
      </View>
    </Sheet>
  );
}
