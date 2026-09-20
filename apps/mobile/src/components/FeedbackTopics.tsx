import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Text, useTheme, type TintName } from '@waves/ui';

import { useStrings } from '@/i18n';
import { artUrl } from '@/lib/art';

/**
 * What a piece of feedback is *about*, picked from pictures.
 *
 * The screen used to open with three chips — general, bug, idea — which asked
 * people to classify their own complaint before they had written it, in words
 * that mean something to a bug tracker and nothing to anybody else. These cards
 * ask the question people can actually answer: which part of the app is this?
 *
 * Multi-select on purpose. "The scanner is slow" is two topics, and forcing a
 * choice between them loses the half that would have made it searchable.
 * Choosing nothing is also allowed: the message is the thing being asked for,
 * and a topic is an offer.
 *
 * Every slug here exists in the database's `feedback_topics_known` constraint
 * and in `waves_submit_feedback`'s filter. Adding one means adding it in all
 * three; removing one is safe from the app's side alone, because the RPC drops
 * slugs it does not recognise rather than rejecting the message.
 */
export const FEEDBACK_TOPICS = [
  'splitting',
  'receipts',
  'voice',
  'groups',
  'speed',
  'design',
  'bug',
  'idea',
] as const;

export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];

/**
 * The picture, the fallback glyph and the wash behind both.
 *
 * The glyph is not a placeholder for a slow network — it is the whole card on a
 * phone that never reaches the bucket. Each one is the icon that already stands
 * for that thing elsewhere in the app, so a card without its illustration still
 * looks like the feature it names.
 */
const ART: Record<
  FeedbackTopic,
  { file: string; icon: keyof typeof Ionicons.glyphMap; tint: TintName }
> = {
  splitting: { file: 'feedback/splitting.webp', icon: 'pie-chart-outline', tint: 'lilac' },
  receipts: { file: 'feedback/receipts.webp', icon: 'receipt-outline', tint: 'peach' },
  voice: { file: 'feedback/voice.webp', icon: 'mic-outline', tint: 'sky' },
  groups: { file: 'feedback/groups.webp', icon: 'people-outline', tint: 'mint' },
  speed: { file: 'feedback/speed.webp', icon: 'flash-outline', tint: 'peach' },
  design: { file: 'feedback/design.webp', icon: 'color-palette-outline', tint: 'lilac' },
  bug: { file: 'feedback/bug.webp', icon: 'bug-outline', tint: 'pink' },
  idea: { file: 'feedback/idea.webp', icon: 'bulb-outline', tint: 'coral' },
};

export function FeedbackTopicGrid({
  selected,
  onToggle,
  disabled = false,
}: {
  selected: readonly FeedbackTopic[];
  onToggle: (topic: FeedbackTopic) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.spacing.md,
      }}
    >
      {FEEDBACK_TOPICS.map((topic) => (
        <TopicCard
          key={topic}
          topic={topic}
          label={t.privacy.feedbackTopics[topic]}
          selected={selected.includes(topic)}
          disabled={disabled}
          onPress={() => onToggle(topic)}
        />
      ))}
    </View>
  );
}

function TopicCard({
  topic,
  label,
  selected,
  disabled,
  onPress,
}: {
  topic: FeedbackTopic;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const art = ART[topic];
  const tint = theme.tint[art.tint];

  // One flag, set once: an illustration that failed to load will not succeed on
  // a re-render, and the glyph underneath is a complete card on its own.
  const [artFailed, setArtFailed] = useState(false);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        // Two per row, with the row's gap taken out of the width. A percentage
        // alone leaves the second card overhanging on narrow phones.
        flexGrow: 1,
        flexBasis: '46%',
        maxWidth: '48%',
        opacity: pressed ? 0.85 : 1,
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.sm,
        gap: theme.spacing.sm,
        // The selected border is drawn at the same width either way, so a card
        // does not resize — and therefore does not nudge the grid — on a tap.
        borderWidth: 2,
        borderColor: selected ? theme.color.brand : 'transparent',
        ...theme.shadow.soft,
      })}
    >
      <View
        style={{
          backgroundColor: tint.bg,
          borderRadius: theme.radius.md,
          aspectRatio: 16 / 10,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {artFailed ? (
          <Ionicons name={art.icon} size={36} color={tint.ink} />
        ) : (
          <Image
            source={{ uri: artUrl(art.file) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
            onError={() => setArtFailed(true)}
            accessible={false}
          />
        )}

        {selected ? (
          <View
            style={{
              position: 'absolute',
              top: theme.spacing.xs,
              // The tick follows the reading direction of the screen, so it
              // does not sit under the thumb on an Arabic layout.
              insetInlineEnd: theme.spacing.xs,
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brand,
            }}
          >
            <Ionicons name="checkmark" size={14} color={theme.color.onBrand} />
          </View>
        ) : null}
      </View>

      <Text variant="caption" align="center" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}
