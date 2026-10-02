/**
 * The daily reminder on Home to back the personal ledger up to Drive.
 *
 * `lib/backup/reminder` decides whether it applies; this is the surface. Like
 * `RestorePrompt` it never mounts `useBackup` — that reads the ledger and asks
 * Google for the linked address over the network, and the dashboard must not
 * pay a Drive round trip to decide whether to draw a card. Two leaf reads (the
 * stored settings and the day it was last answered) and the record count the
 * sync context already holds are the whole cost.
 *
 * "Back up now" goes to the Backup screen, which owns linking, the recovery key
 * and the run itself; the popup asks the question and that screen answers it.
 * Either button answers today's question.
 */

import { useCallback, useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppState, View } from 'react-native';

import { Button, Popup, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { PRIMARY_PROVIDER } from '@/lib/backup/engine';
import { wantsBackupReminder } from '@/lib/backup/reminder';
import {
  loadBackupReminderDay,
  loadBackupSettings,
  saveBackupReminderDay,
} from '@/lib/backup/settings';
import { providerFor } from '@/lib/cloud/providers';
import { router } from '@/lib/navigation';
import { localDay } from '@/lib/phonePrompt';
import { usePromptSlot } from '@/lib/promptQueue';
import { usePersonalRecords } from '@/data/personal';
import { useSync } from '@/sync';

/**
 * Under the restore offer (90), the phone-number ask (85) and the push soft-ask
 * (80); over the campaign (60), the guest card (40) and the daily tip (10).
 */
const PROMPT_PRIORITY = 70;

/** A beat after the dashboard has settled, so the card arrives rather than flashes. */
const PROMPT_DELAY_MS = 600;

/** The two local reads, stamped with whose they are so an account switch re-arms them. */
interface Reads {
  readonly owner: string;
  readonly lastBackupAt: number | null;
  readonly answeredOn: string | null;
  /** When the reads landed — the "now" and "today" the decision is made at. */
  readonly checkedAt: number;
  readonly today: string;
}

export function BackupReminder(): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const { session, isGuest } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const records = usePersonalRecords();
  const { hydrated, status, hasSynced } = useSync();
  const [reads, setReads] = useState<Reads | null>(null);

  // Read on mount and again every time the app comes back to the foreground,
  // so a phone left open overnight is asked the next day, and a backup made on
  // the Backup screen is seen when Home is back.
  useEffect(() => {
    let alive = true;
    const read = (): void => {
      void Promise.all([
        loadBackupSettings(ownerId).catch(() => null),
        loadBackupReminderDay(ownerId).catch(() => null),
      ]).then(([settings, answeredOn]) => {
        if (alive) {
          setReads({
            owner: ownerId,
            lastBackupAt: settings?.last?.at ?? null,
            answeredOn,
            checkedAt: Date.now(),
            today: localDay(),
          });
        }
      });
    };
    read();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      alive = false;
      app.remove();
    };
  }, [ownerId]);

  // The same "we have actually looked" rule as the restore offer: before the
  // first sync every phone holds zero records, which would hide the reminder
  // for a reason that is not true.
  const firstSyncPending = hydrated && !hasSynced && (status === 'idle' || status === 'syncing');
  const settled = reads?.owner === ownerId && hydrated && !firstSyncPending;
  const today = reads?.today ?? '';

  const wants = wantsBackupReminder({
    signedIn: Boolean(session),
    isGuest,
    configured: providerFor(PRIMARY_PROVIDER).isConfigured(),
    recordCount: records.length,
    lastBackupAt: reads?.lastBackupAt ?? null,
    answeredOn: reads?.answeredOn ?? null,
    today,
    now: reads?.checkedAt ?? 0,
    settled,
  });

  const granted = usePromptSlot({
    id: 'backupReminder',
    priority: PROMPT_PRIORITY,
    active: wants,
    delayMs: PROMPT_DELAY_MS,
  });

  // State first, disk after: the popup goes on the tap, and a failed write costs
  // one repeat tomorrow-or-sooner rather than a stuck card.
  const answer = useCallback(() => {
    setReads((current) => (current ? { ...current, answeredOn: today } : current));
    void saveBackupReminderDay(ownerId, today).catch(() => {});
  }, [ownerId, today]);

  const onBackUp = (): void => {
    answer();
    router.push('/settings/backup');
  };

  if (!wants || !granted) return null;

  return (
    <Popup
      visible
      onClose={answer}
      closeLabel={t.backup.reminderLater}
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
        <Ionicons name="cloud-upload-outline" size={38} color={theme.color.brand} />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading" align="center">
          {t.backup.reminderTitle}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {reads?.lastBackupAt == null ? t.backup.reminderBodyNever : t.backup.reminderBodyStale}
        </Text>
      </View>

      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
        <Button label={t.backup.reminderAction} size="lg" fullWidth onPress={onBackUp} />
        <Button
          label={t.backup.reminderLater}
          variant="ghost"
          size="lg"
          fullWidth
          onPress={answer}
        />
      </View>
    </Popup>
  );
}
