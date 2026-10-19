/**
 * One heard expense as a plain line: "₹8,000 · Groceries", with a small ✕ to drop
 * it. Tapping the line opens its amount and words in place; there is no Done —
 * the screen's one button (Add, Save) finishes the edit. The review's batch and
 * the agent's list both draw their rows with this, so they read the same.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { decimalToMinor, format, money } from '@waves/core';
import { Divider, IconButton, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';

export interface DraftRowValue {
  key: string;
  note: string;
  amount: string;
  category: string | null;
}

/** "₹8,000" when the text is a number, else the text and its currency as typed. */
export function amountDisplay(amount: string, currency: string, locale: string): string {
  const text = amount.trim();
  const minor = decimalToMinor(text.replace(/,/g, ''), currency);
  if (minor === null || minor <= 0n) return `${text} ${currency}`.trim();
  return format(money(minor, currency), { locale });
}

export function DraftRow({
  editing: editingProp,
  locked = false,
  draft,
  currency,
  locale,
  onEdit,
  onRemove,
  fallbackNote,
  editLabel,
  removeLabel,
  amountLabel,
  noteLabel,
  notePlaceholder,
  caption,
}: {
  /** Held open from outside (the single expense's tap on its card). */
  editing?: boolean;
  /** Written or writing: shown as a done line, nothing to tap. */
  locked?: boolean;
  draft: DraftRowValue;
  /** The currency Save will persist this row in. */
  currency: string;
  locale: string;
  onEdit: (key: string, patch: Partial<DraftRowValue>) => void;
  /** Omitted when the row is the only one: nothing to drop. */
  onRemove?: (key: string) => void;
  /** Shown as the title when the note came back empty. */
  fallbackNote: string;
  editLabel: string;
  removeLabel: string;
  amountLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  /** A quiet line under the row (a failure, a problem). */
  caption?: { text: string; negative?: boolean } | null;
}) {
  const theme = useTheme();
  const [openOwn, setOpenOwn] = useState(false);
  const editing = !locked && (editingProp ?? openOwn);
  const title = draft.note.trim() || fallbackNote;
  const shown = amountDisplay(draft.amount, currency, locale);
  const remove =
    onRemove && !locked ? (
      <IconButton label={removeLabel} onPress={() => onRemove(draft.key)}>
        <Ionicons name="close" size={iconSize.md} color={theme.color.textFaint} />
      </IconButton>
    ) : null;

  const note = caption ? (
    <Text
      variant="caption"
      tone={caption.negative ? 'negative' : 'muted'}
      style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm }}
    >
      {caption.text}
    </Text>
  ) : null;

  if (!editing) {
    return (
      <View>
        <Row style={{ alignItems: 'center' }}>
          <Pressable
            onPress={() => setOpenOwn(true)}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel={`${shown}, ${title}. ${editLabel}`}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {locked ? (
              <Ionicons name="checkmark-circle" size={28} color={theme.color.brand} />
            ) : (
              <CategoryBadge category={draft.category} description={draft.note} size={28} />
            )}
            <Text numberOfLines={1} style={{ flex: 1, color: theme.color.text }}>
              <Text style={{ fontWeight: '700' }}>{shown}</Text>
              <Text tone="faint"> · </Text>
              {title}
            </Text>
          </Pressable>
          {remove}
        </Row>
        {note}
      </View>
    );
  }

  // Opened for a correction: the amount is the one field worth making big.
  return (
    <View
      style={{
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <CategoryBadge category={draft.category} description={draft.note} size={36} />
        <TextInput
          value={draft.amount}
          onChangeText={(value) => onEdit(draft.key, { amount: value })}
          keyboardType="decimal-pad"
          accessibilityLabel={amountLabel}
          autoFocus
          style={{
            flex: 1,
            minHeight: 44,
            fontSize: 26,
            fontWeight: '700',
            color: theme.color.text,
            paddingVertical: 0,
          }}
        />
        {currency ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 4,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surfaceMuted,
            }}
          >
            <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
              {currency}
            </Text>
          </View>
        ) : null}
        {remove}
      </Row>
      <Divider />
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="create-outline" size={iconSize.sm} color={theme.color.textFaint} />
        <TextInput
          value={draft.note}
          onChangeText={(value) => onEdit(draft.key, { note: value })}
          placeholder={notePlaceholder}
          placeholderTextColor={theme.color.textFaint}
          accessibilityLabel={noteLabel}
          style={{
            flex: 1,
            minHeight: 44,
            fontSize: 15,
            color: theme.color.text,
            paddingVertical: 0,
          }}
        />
      </Row>
      {note}
    </View>
  );
}
