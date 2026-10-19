/**
 * The assistant's answer to a money question: one sentence, a chip for the
 * period it was answered for (and its neighbour, so "this month or last?" is
 * one tap), and a "Show in Spending" link. Never a chart; the Spending screen
 * is where the detail lives.
 *
 * Two parts. `AssistantAnswerCard` is presentational and takes the finished
 * answer. `AssistantMoneyAnswer` binds it to the phone's data: it answers a
 * parsed query and re-answers when a different period chip is tapped.
 *
 * Compact on purpose: it sits in the agent panel under the heard line, beside
 * the follow-up cards. Theme tokens only, so dark mode needs no special case;
 * nothing animates, so Reduce Motion needs none either.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import type { SpendQuery } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import type { AssistantAnswer, PeriodChip, SpendingLink } from '@/lib/assistantAnswers';
import { router } from '@/lib/navigation';
import { useAssistantAnswerer } from '@/lib/useAssistantAnswerer';

export interface AssistantAnswerCardProps {
  text: string;
  chips: readonly PeriodChip[];
  link: SpendingLink | null;
  onChip: (chip: PeriodChip) => void;
  onLink: (link: SpendingLink) => void;
}

export function AssistantAnswerCard({
  text,
  chips,
  link,
  onChip,
  onLink,
}: AssistantAnswerCardProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
      }}
    >
      <Text variant="subheading" accessibilityLiveRegion="polite">
        {text}
      </Text>
      {chips.length > 0 || link ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityState={{ selected: chip.selected }}
              accessibilityLabel={chip.label}
              disabled={chip.selected}
              hitSlop={4}
              onPress={() => onChip(chip)}
              style={({ pressed }) => ({
                height: 36,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: chip.selected ? theme.color.brand : theme.color.border,
                backgroundColor: chip.selected ? theme.color.brandSoft : theme.color.bg,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                variant="caption"
                style={{ color: chip.selected ? theme.color.brand : theme.color.textMuted }}
              >
                {chip.label}
              </Text>
            </Pressable>
          ))}
          {link ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={link.label}
              hitSlop={8}
              onPress={() => onLink(link)}
              style={({ pressed }) => ({
                marginStart: 'auto',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="caption" style={{ color: theme.color.brand }}>
                {link.label}
              </Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.brand} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface AssistantMoneyAnswerProps {
  query: SpendQuery;
  /** Called just before a link navigates, so the panel behind it can close. */
  onNavigate?: () => void;
}

/** A parsed money question, answered from the phone's own data. */
export function AssistantMoneyAnswer({ query, onNavigate }: AssistantMoneyAnswerProps) {
  const answerer = useAssistantAnswerer();
  const [chosen, setChosen] = useState<PeriodChip['key'] | null>(null);
  const answer: AssistantAnswer = chosen
    ? answerer.answerFor(query, chosen)
    : answerer.answer(query);
  return (
    <AssistantAnswerCard
      text={answer.text}
      chips={answer.chips}
      link={answer.link}
      onChip={(chip) => setChosen(chip.key)}
      onLink={(link) => {
        onNavigate?.();
        router.push({ pathname: link.pathname, params: link.params });
      }}
    />
  );
}
