/**
 * "Category (optional)" — the quick sheet's one nod to TDR §8's charts.
 *
 * A dropdown pill naming the choice, and the catalog's first few entries as
 * circular glyphs under it so the common ones are one tap rather than a sheet
 * away. Both open the same full list for everything else (`CategoryChoices`,
 * the same catalog the capture screen's chip row and the expense form's own
 * category field draw from — nothing here is a second category system).
 *
 * Optional, unlike the capture screen's guess-and-confirm chips: nothing is
 * pre-selected and nothing is guessed from the note, because a quick add's
 * note is typed after the amount, if at all, and a category guessed off an
 * empty field would just be wrong. Tapping the one already chosen clears it —
 * the one way back to "optional" without a separate control for it.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { resolveCategory, type CategoryMeta } from '@waves/core';
import { Row, Sheet, Text, useTheme } from '@waves/ui';

import { CategoryChoices, useLabelledCategoryCatalog } from '@/components/Category';
import { useStrings } from '@/i18n';

/** How many of the catalog's own entries get their own circle before "More". */
const SHOWN = 5;

export function QuickCategoryRow({
  value,
  meta,
  onChange,
}: {
  value: string | null;
  meta: CategoryMeta | null;
  onChange: (key: string | null, meta: CategoryMeta | null) => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const soft = dark ? theme.color.surfaceMuted : '#F3F0FE';
  const accent = dark ? theme.color.brand : '#6A45E8';
  const { t } = useStrings();
  const { visible } = useLabelledCategoryCatalog();
  const [sheetOpen, setSheetOpen] = useState(false);

  // The live catalog first — that is where a renamed or re-tinted custom tag
  // lives — and the snapshot handed in as a fallback for the one case the
  // catalog cannot answer: a custom tag deleted since this was chosen. Null
  // is "nothing picked", not "picked something gone", so it still falls
  // through to the plain pill rather than resolving to "Other".
  const chosen = value
    ? (visible.find((entry) => entry.key === value) ?? resolveCategory(value, meta))
    : null;
  const pillLabel = chosen?.label ?? t.quickExpense.category;
  const pillIcon = chosen?.icon ?? 'pricetag-outline';

  const choose = (key: string, nextMeta: CategoryMeta | null): void => {
    // A second tap on what is already chosen is how an optional field goes
    // back to unset — there is no other control here for "never mind".
    if (key === value) onChange(null, null);
    else onChange(key, nextMeta);
    setSheetOpen(false);
  };

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.color.text }}>
          {t.quickExpense.category}{' '}
          <Text style={{ fontSize: 13, fontWeight: '400', color: theme.color.textMuted }}>
            {t.quickExpense.categoryOptional}
          </Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.quickExpense.categoryPicker.replace('{category}', pillLabel)}
          onPress={() => setSheetOpen(true)}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 32,
            paddingHorizontal: 10,
            borderRadius: theme.radius.pill,
            backgroundColor: soft,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name={pillIcon as keyof typeof Ionicons.glyphMap} size={15} color={accent} />
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: '600', color: theme.color.text, maxWidth: 110 }}
          >
            {pillLabel}
          </Text>
          <Ionicons name="chevron-down" size={13} color={theme.color.textMuted} />
        </Pressable>
      </Row>

      <Row style={{ gap: theme.spacing.sm }} accessibilityRole="radiogroup">
        {visible.slice(0, SHOWN).map((entry) => {
          const selected = entry.key === value;
          const entryMeta: CategoryMeta | null = entry.custom
            ? { label: entry.label, icon: entry.icon, tint: entry.tint }
            : null;
          return (
            <Pressable
              key={entry.key}
              accessibilityRole="radio"
              // A radio's state is read through `checked`, not `selected` —
              // VoiceOver/TalkBack say nothing about which one is chosen
              // without it.
              accessibilityState={{ checked: selected }}
              accessibilityLabel={entry.label}
              onPress={() => choose(entry.key, entryMeta)}
              style={({ pressed }) => ({
                alignItems: 'center',
                gap: 4,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? (dark ? theme.color.brandSoft : '#FFFFFF') : soft,
                  borderWidth: selected ? 1.5 : 0,
                  borderColor: accent,
                }}
              >
                <Ionicons
                  name={entry.icon as keyof typeof Ionicons.glyphMap}
                  size={20}
                  color={selected ? accent : theme.color.textMuted}
                />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  fontWeight: selected ? '700' : '500',
                  color: selected ? accent : theme.color.textMuted,
                  maxWidth: 56,
                }}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}

        {/* The catalog's own chip picker, in a sheet rather than a scrolling
            row — a quick add is a glance, not a second place to browse the
            whole list of ten-plus tags. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.quickExpense.moreCategories}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => ({ alignItems: 'center', gap: 4, opacity: pressed ? 0.7 : 1 })}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: soft,
            }}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={theme.color.textMuted} />
          </View>
          <Text
            numberOfLines={1}
            style={{ fontSize: 11, fontWeight: '500', color: theme.color.textMuted, maxWidth: 56 }}
          >
            {t.quickExpense.moreCategories}
          </Text>
        </Pressable>
      </Row>

      {sheetOpen ? (
        <Sheet visible onClose={() => setSheetOpen(false)} title={t.whatFor}>
          <CategoryChoices value={value} onChange={choose} />
        </Sheet>
      ) : null}
    </View>
  );
}
