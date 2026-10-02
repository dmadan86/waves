/**
 * Scanning the inbox from Bank messages, in as few steps as it can be.
 *
 * It used to be a sheet with a choice in it (how far back), a switch, a
 * progress view and a result view, and a scan on a phone that had never
 * granted the permission went through all of it to say so and then sent the
 * person to the disclosure screen. Four states for one button. Now:
 *
 *   - **Scan** scans the last month at once, on the screen, with a slim
 *     progress card at the top of the list, and says what it found in a toast.
 *   - **No permission yet** goes straight to the disclosure screen, whose
 *     Continue grants it and comes back here to scan (`requestScanOnReturn`).
 *   - **Everything on this phone** and **the hourly check** are the two
 *     choices most people never touch, so they live behind the options glyph
 *     in {@link SmsScanOptionsSheet}, not in the way of the button.
 *
 * Progress is still told in three honest stages: reading has no progress to
 * report, so its bar slides; sorting counts real messages; saving is the tail.
 */

import { useCallback, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  Button,
  Popup,
  ProgressBar,
  Row,
  Sheet,
  Text,
  Toggle,
  iconSize,
  useTheme,
} from '@waves/ui';

import { plural, useStrings, type UiStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { batteryLimitsLikely, deviceMaker, openAppSettings } from '@/lib/smsBattery';
import { readFailureMessage } from '@/lib/smsFailureMessage';
import { SmsReadFailure } from '@/lib/smsReader';
import {
  deviceGateReason,
  ScanScope,
  scanFor,
  type ScanProgress,
  type ScanResult,
} from '@/lib/smsScan';
import { useToast } from '@/lib/toast';
import { useBackgroundCheck } from '@/lib/useBackgroundCheck';

/**
 * How far a bar should be filled for a stage.
 *
 * Null while reading — the native call is one round trip with nothing to report,
 * so the bar slides rather than pretending to advance. Sorting is the real
 * fraction. Saving is the last stretch, and is mapped into the top tenth of the
 * track rather than restarting from zero: a bar that goes back to the start
 * looks like the work did.
 */
function fractionOf(progress: ScanProgress): number | null {
  if (progress.stage === 'reading') return null;
  if (progress.total === 0) return progress.stage === 'saving' ? 1 : 0.9;
  const done = progress.done / progress.total;
  return progress.stage === 'sorting' ? done * 0.9 : 0.9 + done * 0.1;
}

function stageWords(progress: ScanProgress, t: UiStrings): string {
  if (progress.stage === 'reading') return t.smsInbox.scanReading;
  if (progress.stage === 'saving') return t.smsInbox.scanSaving;
  return t.smsInbox.scanSorting
    .replace('{done}', String(progress.done))
    .replace('{total}', String(progress.total));
}

/** What a finished scan says, in one toast. */
function resultWords(result: ScanResult, t: UiStrings, locale: string): string {
  if (!result.ok) {
    return result.failure ? readFailureMessage(result.failure, t) : t.smsImport.readFailed;
  }
  if (result.added === 0) return t.smsInbox.scanNothingNew;
  const found = plural(locale, result.added, t.smsInbox.scanFound);
  return result.drafted > 0
    ? `${found}. ${plural(locale, result.drafted, t.smsInbox.scanDrafted)}`
    : found;
}

export interface SmsScan {
  /** Non-null while a scan runs: what to draw in the progress card. */
  readonly progress: ScanProgress | null;
  /** Start a scan, or go and get the permission first. Never rejects. */
  readonly start: (scope: ScanScope) => Promise<void>;
}

/**
 * The scan as a hook: one call does the whole event, and the screen draws
 * `progress` while it runs.
 */
export function useSmsScan(ownerId: string, onFinished: () => void): SmsScan {
  const { t, locale } = useStrings();
  const toast = useToast();
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const running = useRef(false);

  const start = useCallback(
    async (scope: ScanScope): Promise<void> => {
      if (running.current) return;
      running.current = true;
      try {
        const gate = await deviceGateReason();
        if (gate === SmsReadFailure.Denied) {
          // Never granted (or taken back): the disclosure screen asks, and
          // comes back here to scan. The only place allowed to raise the dialog.
          router.push({ pathname: '/captures/messages', params: { then: 'scan' } });
          return;
        }
        if (gate) {
          toast.show(readFailureMessage(gate, t), 'negative');
          return;
        }
        setProgress({ stage: 'reading' });
        const result = await scanFor(ownerId, scope, setProgress);
        onFinished();
        toast.show(resultWords(result, t, locale), result.ok ? undefined : 'negative');
      } finally {
        setProgress(null);
        running.current = false;
      }
    },
    [locale, onFinished, ownerId, t, toast],
  );

  return { progress, start };
}

/** The slim card at the top of the list while a scan runs. */
export function SmsScanProgress({ progress }: { progress: ScanProgress }): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const reduceMotion = useReducedMotion();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
        <Text variant="body" style={{ flexShrink: 1 }}>
          {stageWords(progress, t)}
        </Text>
        <Row style={{ gap: 4, alignItems: 'center' }}>
          <Ionicons name="phone-portrait-outline" size={iconSize.sm} color={theme.color.brand} />
          <Text variant="micro" tone="muted">
            {t.smsInbox.onDevice}
          </Text>
        </Row>
      </Row>
      <ProgressBar progress={fractionOf(progress)} animated={!reduceMotion} />
    </View>
  );
}

/**
 * The two choices most people never need: read everything on the phone, and
 * whether Waves checks on its own every hour.
 */
export function SmsScanOptionsSheet({
  visible,
  onClose,
  onScanEverything,
}: {
  visible: boolean;
  onClose: () => void;
  onScanEverything: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [helpOpen, setHelpOpen] = useState(false);
  const background = useBackgroundCheck();
  const warnBattery = batteryLimitsLikely();
  const maker = deviceMaker();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.lg }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.smsInbox.scanEverything}. ${t.smsInbox.scanEverythingNote}`}
        onPress={() => {
          onClose();
          onScanEverything();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="albums-outline" size={iconSize.md} color={theme.color.brand} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body">{t.smsInbox.scanEverything}</Text>
          <Text variant="micro" tone="muted">
            {t.smsInbox.scanEverythingNote}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textMuted} />
      </Pressable>

      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <Ionicons name="time-outline" size={iconSize.md} color={theme.color.brand} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="body">{t.smsInbox.backgroundTitle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.smsInbox.backgroundHelp}
              hitSlop={10}
              onPress={() => setHelpOpen(true)}
            >
              <Ionicons name="help-circle-outline" size={iconSize.sm} color={theme.color.brand} />
            </Pressable>
          </Row>
          <Text variant="micro" tone="muted">
            {t.smsInbox.backgroundNote}
          </Text>
        </View>
        <Toggle
          value={background.wanted}
          onValueChange={background.setWanted}
          accessibilityLabel={t.smsInbox.backgroundTitle}
        />
      </Row>

      <Popup visible={helpOpen} onClose={() => setHelpOpen(false)} closeLabel={t.common.close}>
        <Text variant="heading">{t.smsInbox.backgroundHelpTitle}</Text>
        <Text variant="caption" tone="muted">
          {t.smsInbox.backgroundHelpBody}
        </Text>
        {warnBattery && maker ? (
          <Text variant="caption" tone="muted">
            {t.smsInbox.backgroundHelpMaker.replace('{maker}', maker)}
          </Text>
        ) : null}
        <Button
          label={t.smsInbox.batteryOpenSettings}
          variant="secondary"
          fullWidth
          onPress={() => void openAppSettings()}
        />
        <Button label={t.common.done} fullWidth onPress={() => setHelpOpen(false)} />
      </Popup>
    </Sheet>
  );
}
