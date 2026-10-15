/**
 * The last two steps: the import under way, and what it did.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Button, Callout, Card, iconSize, ProgressBar, Text, useTheme } from '@waves/ui';

import { Disc } from '@/components/import/ImportChrome';
import { fill, plural, useStrings } from '@/i18n';
import type { ImportOutcome, UndoState } from '@/lib/groupImport/machine';
import type { ImportProgressSnapshot } from '@/lib/importProgress';
import { useReducedMotion } from '@/lib/reducedMotion';

/** The import running, parked offline, or failed: the three things a small import can be doing. */
export function CommitPanel({
  imp,
  onCancel,
  onRetry,
}: {
  imp: ImportProgressSnapshot;
  /** Leave the wait or the failure and go back to the review. */
  onCancel: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const g = t.groupImport;
  const reduceMotion = useReducedMotion();
  const failed = imp.phase === 'error';
  const waiting = imp.phase === 'waiting';

  return (
    <Card style={{ gap: theme.spacing.lg, alignItems: 'center' }}>
      <Disc
        icon={
          failed
            ? 'alert-circle-outline'
            : waiting
              ? 'cloud-offline-outline'
              : 'cloud-upload-outline'
        }
        fill={
          failed
            ? theme.color.negativeSoft
            : waiting
              ? theme.color.warningSoft
              : theme.color.brandSoft
        }
        ink={failed ? theme.color.negative : waiting ? theme.color.warning : theme.color.brand}
        size={56}
      />
      <View
        accessibilityLiveRegion="polite"
        style={{ gap: theme.spacing.xs, alignSelf: 'stretch' }}
      >
        <Text variant="heading" align="center">
          {failed ? g.failedTitle : waiting ? g.waitingTitle : g.committing}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {failed
            ? `${imp.error ?? ''} ${g.partialNote}`.trim()
            : waiting
              ? g.waitingHint
              : imp.progress
                ? fill(g.rowsProgress, { done: imp.progress.done, total: imp.progress.total })
                : ''}
        </Text>
      </View>
      {imp.phase === 'running' ? (
        <View style={{ alignSelf: 'stretch' }}>
          <ProgressBar
            animated={!reduceMotion}
            height={6}
            progress={
              imp.progress ? imp.progress.done / Math.max(1, imp.progress.total) : undefined
            }
          />
        </View>
      ) : null}
      {failed ? <Button label={g.tryAgain} variant="brand" fullWidth onPress={onRetry} /> : null}
      {failed || waiting ? (
        <Button label={t.common.cancel} variant="ghost" fullWidth onPress={onCancel} />
      ) : null}
    </Card>
  );
}

export function ResultCard({
  outcome,
  groupName,
  left,
  undo,
  undoAvailable,
  onInvite,
  onUndo,
}: {
  outcome: ImportOutcome;
  groupName: string;
  /** Rows in the file that were not imported. */
  left: number;
  undo: UndoState;
  undoAvailable: boolean;
  onInvite: () => void;
  onUndo: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const g = t.groupImport;
  const undone = undo.phase === 'done';

  const line = (icon: keyof typeof Ionicons.glyphMap, text: string): React.JSX.Element => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      <Text variant="body" tone="muted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Card style={{ gap: theme.spacing.md }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <Disc
            icon={undone ? 'arrow-undo' : 'checkmark'}
            fill={undone ? theme.color.surfaceMuted : theme.color.positiveSoft}
            ink={undone ? theme.color.textMuted : theme.color.positive}
            size={56}
          />
          <Text variant="heading" align="center" accessibilityLiveRegion="polite">
            {undone
              ? plural(locale, undo.expenses, g.undoneTitle)
              : fill(plural(locale, outcome.expenses, g.resultImported), { group: groupName })}
          </Text>
        </View>
        {!undone ? (
          <View style={{ gap: theme.spacing.sm }}>
            {outcome.settlements > 0
              ? line(
                  'swap-horizontal-outline',
                  plural(locale, outcome.settlements, g.resultSettlements),
                )
              : null}
            {outcome.ghosts > 0
              ? line('person-add-outline', plural(locale, outcome.ghosts, g.resultPeople))
              : null}
            {left > 0 ? line('remove-circle-outline', plural(locale, left, g.resultLeftOut)) : null}
          </View>
        ) : null}
        {!undone && outcome.ghosts > 0 ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={g.resultInvite}
            onPress={onInvite}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="body" tone="brand" align="center" style={{ fontWeight: '600' }}>
              {g.resultInvite}
            </Text>
          </Pressable>
        ) : null}
      </Card>

      {undo.phase === 'failed' ? <Callout tone="negative">{undo.message}</Callout> : null}

      {!undone && undoAvailable ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Button
            label={undo.phase === 'working' ? g.undoing : g.undo}
            variant="secondary"
            fullWidth
            disabled={undo.phase === 'working'}
            onPress={onUndo}
          />
          <Text variant="micro" tone="muted" align="center">
            {g.undoHint}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
