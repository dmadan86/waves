/**
 * Three things to say, as compact rows with a small icon: one personal expense,
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
    {
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
    <View style={{ alignSelf: 'stretch', gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
        {t.voiceScreen.suggestionsTitle}
      </Text>
      {suggestions.map((row) => {
        const pick = onPick && (canPick ? canPick(row) : true) ? onPick : null;
        const body = (
          <>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name={row.icon} size={iconSize.sm} color={theme.color.brand} />
            </View>
            <Text variant="body" style={{ flex: 1 }}>
              {row.text}
            </Text>
            {pick ? (
              <Ionicons
                name={row.kind === 'question' ? 'arrow-forward' : 'create-outline'}
                size={iconSize.sm}
                color={theme.color.textMuted}
              />
            ) : null}
          </>
        );
        const style = {
          flexDirection: 'row' as const,
          alignItems: 'center' as const,
          gap: theme.spacing.sm,
          minHeight: 48,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surface,
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
