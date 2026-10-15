/**
 * The import banner that sits above the group list on Home.
 *
 * It is the visible half of {@link ../lib/importProgress}: while a ledger is
 * being brought in it names the group and shows a slim indeterminate bar; parked
 * offline it says it is waiting for a connection; on success it flips to a check
 * and the count it added, then clears itself; on failure it holds the
 * people-facing reason with a way to dismiss. Idle, it renders nothing.
 *
 * No ticking percentage. A new-group import is one atomic write with no honest
 * fraction to show, and a ticking number meant re-rendering the dashboard many
 * times a second — so the running state is an indeterminate bar that slides on
 * the *native* driver: it costs the JS thread nothing, so a slow or stalled
 * import never makes the app feel slow. An import into a group is written in
 * chunks and does know how far it got, so that one fills a real bar, a few times
 * in all. The whole card eases in once as the person lands on Home.
 *
 * With a `groupId` it is the group screen's banner: it shows only an import
 * going into that group, and does not offer to open the group it is already on.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Animated, Pressable, View } from 'react-native';

import { directionalIcon, iconSize, ProgressBar, Row, Text, useTheme } from '@waves/ui';

import { undoImport } from '@/data/api';
import { undoErrorText } from '@/lib/groupImport/undoText';
import { dismissImport, useImportProgress } from '@/lib/importProgress';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';

export function ImportProgressBanner({
  groupId,
}: {
  /** Show only an import into this group (the group screen); omit for any (Home). */
  groupId?: string;
}): React.JSX.Element | null {
  const imp = useImportProgress();
  const theme = useTheme();
  const { t, locale } = useStrings();
  const reduceMotion = useReducedMotion();
  // 'idle', 'working', 'done', or the sentence for a refused undo.
  const [undo, setUndo] = useState<string>('idle');

  // Stable Animated values via useState (not useRef) so reading them in render
  // is not a ref access — the pattern the rest of the app's animations use.
  const opacity = useState(() => new Animated.Value(0))[0];
  const translateY = useState(() => new Animated.Value(-8))[0];

  const visible = imp.phase !== 'idle' && (!groupId || imp.targetGroupId === groupId);
  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, [visible, reduceMotion, opacity, translateY]);

  if (!visible) return null;

  const running = imp.phase === 'running';
  const waiting = imp.phase === 'waiting';
  const success = imp.phase === 'success';
  const error = imp.phase === 'error';

  // The title and its sub line, per phase. Running: just the group name (the bar
  // below carries "in progress"). Waiting: parked offline, with the reassurance
  // it will land. Success: "added" and the count. Error: the failure and reason.
  const title = running
    ? t.importLedger.importingNamed.replace('{name}', imp.groupName)
    : waiting
      ? t.importLedger.waitingNamed.replace('{name}', imp.groupName)
      : success
        ? t.importLedger.addedNamed.replace('{name}', imp.groupName)
        : t.importLedger.importFailed;
  // Only the person who ran it sees this banner (it lives in memory) and it clears
  // itself long before the 24 hours an import can be undone for.
  const batchId = success && groupId ? imp.summary?.batchId : undefined;
  const undoable = Boolean(batchId) && undo !== 'done';
  const refused = undo !== 'idle' && undo !== 'working' && undo !== 'done' ? undo : null;
  const runUndo = (): void => {
    if (!batchId) return;
    setUndo('working');
    undoImport(batchId).then(
      () => setUndo('done'),
      (caught: unknown) => setUndo(undoErrorText(caught, t.groupImport)),
    );
  };

  const sub = running
    ? imp.progress
      ? fill(t.groupImport.rowsProgress, { done: imp.progress.done, total: imp.progress.total })
      : null
    : waiting
      ? t.importLedger.waitingHint
      : success && imp.summary
        ? (refused ??
          (undo === 'done'
            ? plural(locale, imp.summary.expenses, t.groupImport.undoneTitle)
            : plural(locale, imp.summary.expenses, t.importLedger.expenseCount)))
        : imp.error;

  const icon: keyof typeof Ionicons.glyphMap = running
    ? 'cloud-upload-outline'
    : waiting
      ? 'cloud-offline-outline'
      : success
        ? 'checkmark-circle'
        : 'alert-circle';
  const accent = success
    ? theme.color.positive
    : error
      ? theme.color.negative
      : waiting
        ? theme.color.warning
        : theme.color.brand;

  // Success opens the group on tap; the rest of the time the card is inert.
  const onPress =
    success && imp.groupId && imp.groupId !== groupId
      ? () => router.replace(`/group/${imp.groupId}`)
      : undefined;

  return (
    <Animated.View
      // Home stacks its body `sm` apart (a heading and its card); this is a
      // section of its own, so it tops that up to a full `xl` below it.
      style={{ opacity, transform: [{ translateY }], marginBottom: theme.spacing.md }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`${title}${sub ? `. ${sub}` : ''}`}
        style={({ pressed }) => ({
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          opacity: pressed && onPress ? 0.7 : 1,
        })}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surfaceMuted,
            }}
          >
            <Ionicons name={icon} size={iconSize.lg} color={accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheading" numberOfLines={1}>
              {title}
            </Text>
            {sub ? (
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {sub}
              </Text>
            ) : null}
          </View>
          {/* Success: a chevron into the group. Waiting/error: a dismiss. Running
              carries no trailing control — just the bar below. */}
          {error || waiting ? (
            <Pressable
              onPress={dismissImport}
              accessibilityRole="button"
              accessibilityLabel={t.common.close}
              hitSlop={10}
            >
              <Ionicons name="close" size={iconSize.lg} color={theme.color.textMuted} />
            </Pressable>
          ) : undoable ? (
            <Pressable
              onPress={runUndo}
              disabled={undo === 'working'}
              accessibilityRole="button"
              accessibilityLabel={t.groupImport.undo}
              hitSlop={10}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                {undo === 'working' ? t.groupImport.undoing : t.groupImport.undo}
              </Text>
            </Pressable>
          ) : success && imp.groupId && imp.groupId !== groupId ? (
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.lg}
              color={theme.color.textFaint}
            />
          ) : null}
        </Row>
        {/* A slim indeterminate bar while the write is in flight — no `progress`,
            so it slides on the native driver and never re-renders per frame. */}
        {running ? (
          <ProgressBar
            animated={!reduceMotion}
            height={3}
            progress={
              imp.progress ? imp.progress.done / Math.max(1, imp.progress.total) : undefined
            }
          />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
