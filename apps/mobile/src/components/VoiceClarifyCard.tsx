/**
 * The agent's question, with tappable answers. The agent could not settle
 * which of several amounts, groups or people was meant, so it offers 2-4
 * choices: the question is the card's title, each choice a tinted row, and a
 * tap answers at once (no Continue). When the agent asked which group, "Another
 * group" opens a searchable list of the reader's other groups in the card
 * itself; a tap there answers at once too.
 *
 * Nothing here animates, so reduced motion needs no special case.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import type { VoiceClarifyOption } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import {
  clarifyOptionViews,
  filterGroupChoices,
  type ClarifyOptionView,
} from '@/lib/voiceClarifyPure';

/** Past this many groups the list gets a search field. */
const SEARCH_FROM = 6;

export interface VoiceClarifyCardProps {
  question: string;
  options: readonly VoiceClarifyOption[];
  /** The reader's other groups, for a which-group question (see otherGroupChoices). */
  moreChoices?: readonly ClarifyOptionView[];
  /** A row was tapped: its answer text. */
  onPick: (answer: string) => void;
}

export function VoiceClarifyCard({
  question,
  options,
  moreChoices = [],
  onPick,
}: VoiceClarifyCardProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const offered = clarifyOptionViews(options);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');
  const others = moreChoices;
  const shown = filterGroupChoices(others, query);

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.color.surface,
      }}
    >
      <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 17 }}>
        {question}
      </Text>

      <View style={{ gap: theme.spacing.sm }}>
        {offered.map((view, index) => {
          const tint = theme.tint[view.tint];
          return (
            <Pressable
              key={`${index}-${view.answer}`}
              accessibilityRole="button"
              accessibilityLabel={view.detail ? `${view.label}, ${view.detail}` : view.label}
              onPress={() => onPick(view.answer)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: tint.bg,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surface,
                }}
              >
                <Ionicons
                  name={view.icon as React.ComponentProps<typeof Ionicons>['name']}
                  size={iconSize.xl}
                  color={tint.ink}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 20, fontWeight: '800', color: tint.ink }}
                >
                  {view.label}
                </Text>
                {view.detail ? (
                  <Text numberOfLines={1} style={{ color: tint.inkMuted }}>
                    {view.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {others.length > 0 ? (
        browsing ? (
          <View
            style={{
              gap: theme.spacing.xs,
              padding: theme.spacing.sm,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
            }}
          >
            {others.length > SEARCH_FROM ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder={t.voice.agentSearchGroups}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.voice.agentSearchGroups}
                style={{
                  height: 44,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surfaceMuted,
                  fontSize: 16,
                  color: theme.color.text,
                }}
              />
            ) : null}
            {shown.map((choice) => (
              <Pressable
                key={choice.answer}
                accessibilityRole="button"
                accessibilityLabel={
                  choice.detail ? `${choice.label}, ${choice.detail}` : choice.label
                }
                onPress={() => onPick(choice.answer)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  minHeight: 44,
                  paddingHorizontal: theme.spacing.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed ? theme.color.brandSoft : 'transparent',
                })}
              >
                <Ionicons
                  name="people-outline"
                  size={iconSize.base}
                  color={theme.color.textMuted}
                />
                <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                  {choice.label}
                </Text>
                {choice.detail ? (
                  <Text numberOfLines={1} tone="muted" style={{ maxWidth: '40%' }}>
                    {choice.detail}
                  </Text>
                ) : null}
              </Pressable>
            ))}
            {shown.length === 0 ? (
              <Text tone="muted" style={{ padding: theme.spacing.sm }}>
                {t.voice.agentNoGroupMatch}
              </Text>
            ) : null}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.voice.agentOtherGroup}
            accessibilityState={{ expanded: false }}
            onPress={() => setBrowsing(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              minHeight: 48,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: theme.color.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="search-outline" size={iconSize.base} color={theme.color.brand} />
            <Text style={{ flex: 1, color: theme.color.brand, fontWeight: '700' }}>
              {t.voice.agentOtherGroup}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.base} color={theme.color.brand} />
          </Pressable>
        )
      ) : null}
    </View>
  );
}
