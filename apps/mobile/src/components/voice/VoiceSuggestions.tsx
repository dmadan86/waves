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

import { voiceEntryExamples } from '@/lib/voiceEntryExamples';

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
  const { t, locale } = useStrings();
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
  const cards = voiceEntryExamples(
    [t.voiceScreen.exampleCoffee, t.voiceScreen.exampleRent, t.voiceScreen.examplePetrol],
    currency,
    locale,
  );
  return [
    ...cards.map((text, index): Suggestion => ({
      text,
      kind: 'expense',
      icon: (['cafe-outline', 'home-outline', 'car-outline'] as const)[index]!,
    })),
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
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="body" tone="muted" style={{ fontWeight: '600' }}>
          {t.voiceScreen.suggestionsTitle}
        </Text>
        {suggestions.length > 3 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.voiceScreen.seeMore}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded(!expanded)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text tone="brand" style={{ fontWeight: '600' }}>
              {t.voiceScreen.seeMore}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {(expanded ? suggestions : suggestions.slice(0, 3)).map((row, index) => {
          const pick = onPick && (canPick ? canPick(row) : true) ? onPick : null;
          const tint = theme.tint[ROW_TINTS[index % ROW_TINTS.length]];
          const body = (
            <>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: tint.bg,
                }}
              >
                <Ionicons name={row.icon} size={iconSize.base} color={tint.ink} />
              </View>
              <Text variant="caption" style={{ flexShrink: 1, fontWeight: '500' }}>
                {row.text}
              </Text>
            </>
          );
          const style = {
            flexDirection: 'column' as const,
            alignItems: 'flex-start' as const,
            flexGrow: 1,
            flexBasis: '30%' as const,
            gap: theme.spacing.sm,
            minHeight: 100,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.brandSoft,
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
    </View>
  );
}
