import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';
import { iconSize, Text, useTheme } from '@waves/ui';
import { CommentMarkdown } from '@/components/CommentMarkdown';
import { RichCommentInput } from '@/components/RichCommentInput';
import { withAlpha } from '@/components/company/dashboard/overviewKit';
import type { MirrorWorkTask } from '@/data/companyWorkday';
import { useStrings } from '@/i18n';
import { toggleWrap, type Selection, type WrapMarker } from '@/lib/richText';
import { WORK_INK } from './WorkSummaryControls';

type Status = MirrorWorkTask['status'];

const TILES: { status: Status; icon: keyof typeof Ionicons.glyphMap }[] = [
  { status: 'todo', icon: 'ellipse-outline' },
  { status: 'doing', icon: 'sync-outline' },
  { status: 'done', icon: 'checkmark-circle-outline' },
  { status: 'blocked', icon: 'ban-outline' },
];

/** Status tiles + optional rich-text note for one task. Mount per task (state is local). */
export function StatusSheetBody({
  task,
  enabled,
  error,
  onPick,
}: {
  task: MirrorWorkTask;
  enabled: boolean;
  error: boolean;
  /** `text` is the trimmed note typed here ('' when none). */
  onPick: (status: Status, text: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const input = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  const [forced, setForced] = useState<Selection | null>(null);
  const [needReason, setNeedReason] = useState(false);
  const labels: Record<Status, string> = {
    todo: t.company.workTodo,
    doing: t.company.workDoing,
    done: t.company.workDone,
    blocked: t.company.workBlocked,
  };
  const wrap = (marker: WrapMarker) => {
    const next = toggleWrap(text, sel, marker);
    setText(next.text);
    setSel(next.selection);
    setForced(next.selection);
  };
  const pick = (status: Status) => {
    if (status === 'blocked' && !text.trim() && !task.blockedReason) {
      // A blocked task needs a reason: turn the note into a required field.
      setNeedReason(true);
      input.current?.focus();
      return;
    }
    onPick(status, text.trim());
  };
  const shown = [task.blockedReason, task.note].filter((s): s is string => !!s);
  const toolbar: { label: string; marker: WrapMarker; letter: string; style: object }[] = [
    { label: t.comments.bold, marker: '**', letter: 'B', style: { fontWeight: '800' } },
    { label: t.comments.italic, marker: '_', letter: 'I', style: { fontStyle: 'italic' } },
    {
      label: t.comments.strike,
      marker: '~~',
      letter: 'S',
      style: { textDecorationLine: 'line-through' },
    },
  ];
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="subheading" style={{ fontWeight: '700' }}>
        {`#${task.number ?? '—'} ${task.title}`}
      </Text>
      {shown.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' }}>
          <Ionicons name="chatbox-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <View style={{ flex: 1, gap: 2 }}>
            {shown.map((s, i) => (
              <CommentMarkdown key={i} source={s} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {TILES.map(({ status, icon }) => {
          const ink = status === 'todo' ? '#4F46E5' : WORK_INK[status];
          const current = task.status === status;
          return (
            <Pressable
              key={status}
              disabled={!enabled}
              onPress={() => pick(status)}
              accessibilityRole="button"
              accessibilityState={{ selected: current, disabled: !enabled }}
              accessibilityLabel={labels[status]}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 2,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                borderWidth: 1.5,
                borderColor: current ? ink : 'transparent',
                backgroundColor: withAlpha(ink, 0.12),
                opacity: enabled ? 1 : 0.5,
              }}
            >
              <Ionicons name={icon} size={iconSize.md} color={ink} />
              <Text variant="micro" numberOfLines={1} style={{ color: ink, fontWeight: '700' }}>
                {labels[status]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {needReason ? (
        <Text variant="caption" tone="negative">
          {t.company.workReason}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="negative">
          {t.company.workSaveError}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
        {toolbar.map(({ label, marker, letter, style }) => (
          <Pressable
            key={marker}
            onPress={() => wrap(marker)}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={6}
            style={{
              width: 32,
              height: 28,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surfaceMuted,
            }}
          >
            <Text variant="body" style={{ color: theme.color.text, ...style }}>
              {letter}
            </Text>
          </Pressable>
        ))}
      </View>
      <RichCommentInput
        ref={input}
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (v.trim()) setNeedReason(false);
        }}
        onSelectionChange={(e) => {
          setSel(e.nativeEvent.selection);
          setForced(null);
        }}
        selection={forced ?? undefined}
        maxLength={120}
        placeholder={t.company.workAddNote}
        accessibilityLabel={t.company.workAddNote}
        style={{
          minHeight: 44,
          maxHeight: 120,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: needReason ? theme.color.negative : theme.color.border,
          backgroundColor: theme.color.surfaceMuted,
          color: theme.color.text,
        }}
      />
    </View>
  );
}
