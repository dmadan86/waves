/**
 * Three things to say, as a card of rows with a tinted icon: one personal expense,
 * one split with two people, one question. The sentences are fitted to the
 * phone's country and the reader's groups (`lib/voiceExamples`), so the names
 * and amounts are plausible here rather than fixed.
 *
 * A row is a button only when `onPick` is given, and what it does is real: the
 * screen sends a question straight through the assistant, and puts an expense
 * sentence in the typed composer to check and send. Without `onPick` the rows
 * are read-only text.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

import { deviceCountry, fill, useStrings } from '@/i18n';
import { useDefaultCurrency } from '@/lib/currency';
import { exampleCountry, voiceExamples } from '@/lib/voiceExamples';

import { sceneCardColor } from './sceneCard';

/** One tint per row, in order, as in the design. */
const ROW_TINTS = ['sky', 'peach', 'mint'] as const;

export type SuggestionKind = 'expense' | 'question';

export interface Suggestion {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** As shown, in curly quotes. */
  text: string;
  kind: SuggestionKind;
}

/** The words of a suggestion without its display quotes. */
export function suggestionWords(text: string): string {
  return text.replace(/^[\s“”"«»„]+|[\s“”"«»„]+$/g, '');
}

/** A small seeded generator (Park–Miller), so one draw stays one draw. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function useVoiceSuggestions(groupNames: readonly string[]): Suggestion[] {
  const { t } = useStrings();
  const currency = useDefaultCurrency();
  // Drawn once per visit, so the names stay put while somebody reads them.
  const [seed] = useState(() => Math.floor(Math.random() * 2147483646) + 1);
  const groupsKey = groupNames.join('\u0000');
  const example = useMemo(
    () => voiceExamples(exampleCountry(currency, deviceCountry()), groupNames, seededRandom(seed)),
    // Keyed on the names themselves, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupsKey, seed, currency],
  );
  return [
    // With a real group, the first thing to try is the sentence that would have
    // worked in that group ("Groceries 850 to Goa Trip").
    example.group
      ? {
          icon: 'bag-handle-outline',
          kind: 'expense',
          text: fill(t.voice.tryGroup, { amount: example.groceries, group: example.group }),
        }
      : {
          icon: 'cafe-outline',
          kind: 'expense',
          text: fill(t.voice.tryJustMe, { amount: example.coffee }),
        },
    {
      icon: 'restaurant-outline',
      kind: 'expense',
      text: fill(t.voice.trySplit, {
        amount: example.dinner,
        a: example.names[0],
        b: example.names[1],
      }),
    },
    { icon: 'people-outline', kind: 'question', text: t.assistant.tryWhoOwes },
  ];
}

export function VoiceSuggestions({
  suggestions,
  onPick,
  canPick,
}: {
  suggestions: readonly Suggestion[];
  onPick?: (suggestion: Suggestion) => void;
  /** Which rows are buttons; all of them when omitted. */
  canPick?: (suggestion: Suggestion) => boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.xl,
        backgroundColor: sceneCardColor(theme.scheme, theme.color.surface),
        ...theme.shadow.soft,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        <Ionicons name="bulb-outline" size={iconSize.base} color={theme.color.warning} />
        <Text variant="body" style={{ fontWeight: '600', flexShrink: 1 }}>
          {t.voiceScreen.suggestionsTitle}
        </Text>
      </View>
      {suggestions.map((row, index) => {
        const pick = onPick && (canPick ? canPick(row) : true) ? onPick : null;
        const tint = theme.tint[ROW_TINTS[index % ROW_TINTS.length]];
        const body = (
          <>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tint.bg,
              }}
            >
              <Ionicons name={row.icon} size={iconSize.base} color={tint.ink} />
            </View>
            <Text variant="body" tone="muted" style={{ flexShrink: 1 }}>
              {row.text}
            </Text>
          </>
        );
        const style = {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          gap: theme.spacing.md,
          minHeight: 56,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.color.surfaceMuted,
        };
        return pick ? (
          <Pressable
            key={row.text}
            onPress={() => pick(row)}
            accessibilityRole="button"
            accessibilityLabel={suggestionWords(row.text)}
            style={({ pressed }) => ({ ...style, opacity: pressed ? 0.7 : 1 })}
          >
            {body}
          </Pressable>
        ) : (
          <View key={row.text} style={style}>
            {body}
          </View>
        );
      })}
    </View>
  );
}
