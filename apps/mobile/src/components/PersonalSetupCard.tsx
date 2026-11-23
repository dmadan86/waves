/**
 * "Finish setting up · N left" on the Personal home: the questions of the setup
 * interview still unanswered, each one a door back into it at that question.
 * Only for accounts that have opened setup, so nobody who never asked for it is
 * nagged; the ⋮ menu is the way in for them.
 */
import { useCallback, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { Pressable } from 'react-native';

import { Card, iconSize, Row, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { personalSetupAnswers, SETUP_STEPS, type SetupStep } from '@/lib/personalSetup';

/** The setup questions still unanswered (none until setup has been opened). */
export function useSetupLeft(): SetupStep[] {
  const ownerId = useViewerId();
  const [left, setLeft] = useState<SetupStep[]>([]);
  // Re-read on focus: the flow runs on its own route and changes this while away.
  useFocusEffect(
    useCallback(() => {
      if (!ownerId) return;
      let live = true;
      void personalSetupAnswers(ownerId).then((state) => {
        if (live) setLeft(state.started ? SETUP_STEPS.filter((x) => !state.done.includes(x)) : []);
      });
      return () => {
        live = false;
      };
    }, [ownerId]),
  );
  return left;
}

export function PersonalSetupCard() {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.personalSetup;
  const left = useSetupLeft();
  if (left.length === 0) return null;
  const names: Record<SetupStep, string> = {
    income: s.nameIncome,
    home: s.nameHome,
    bills: s.nameBills,
    emi: s.nameEmi,
    eatOut: s.nameEat,
    savings: s.nameSavings,
    cap: s.nameCap,
  };
  return (
    <Card style={{ gap: theme.spacing.xs }}>
      <Text variant="body" style={{ fontWeight: '700' }}>
        {fill(s.finishCard, { n: left.length })}
      </Text>
      {left.map((step) => (
        <Pressable
          key={step}
          accessibilityRole="button"
          accessibilityLabel={names[step]}
          onPress={() => router.push({ pathname: '/personal/setup', params: { step } })}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            minHeight: 36,
            justifyContent: 'center',
          })}
        >
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="body" tone="muted">
              {names[step]}
            </Text>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textMuted} />
          </Row>
        </Pressable>
      ))}
    </Card>
  );
}
