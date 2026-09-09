/**
 * The shield in front of the private personal ledger.
 *
 * Every screen in the section — the Me tab and each `personal/*` room — shows
 * this, and they all read one unlock (`lib/personalLock`), so proving who you
 * are once covers the whole section until you genuinely leave it or the app
 * goes away for longer than the "Ask again after" window. Moving between the
 * rooms costs nothing.
 *
 * While the check is in flight the shield stays up, so the figures are never on
 * show behind the OS prompt, and a refusal leaves the user here with the two
 * honest choices — try again, or go back — rather than being thrown backwards a
 * few seconds later with nothing said.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, View } from 'react-native';

import { Button, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { usePersonalGate, type PersonalGateValue } from '@/lib/lock';
import { useGoBack } from '@/lib/navigation';

/** Wraps a personal screen so its body never mounts while the section is shut. */
export function PersonalGuard({ children }: { children: ReactNode }) {
  const { t } = useStrings();
  const gate = usePersonalGate(t.lock.personalPrompt);
  if (!gate.unlocked) return <PersonalLocked gate={gate} />;
  return <>{children}</>;
}

/**
 * The shield itself, also used directly by the Me tab (whose body is the
 * section's home and computes its month before it can early-return).
 */
export function PersonalLocked({ gate }: { gate: PersonalGateValue }) {
  const theme = useTheme();
  const { t } = useStrings();
  // Home is the fallback: this screen can be the first thing a cold open from a
  // shortcut or a notification lands on, with no history to pop.
  const goBack = useGoBack('/');

  return (
    <Screen edges={[]}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.lg,
          paddingHorizontal: theme.spacing.xxxl,
        }}
      >
        <Ionicons name="lock-closed" size={iconSize.huge} color={theme.color.textFaint} />
        <Text variant="title" align="center">
          {t.lock.personalLockedTitle}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {gate.failed ? t.lock.personalLockedRefused : t.lock.personalLockedBody}
        </Text>
        {/* Only one of the three: a spinner while the OS sheet is up, the way
            back in once it has been refused, and nothing at all in the moment
            before the prompt appears — a button that flashes past is a button
            people press by accident. */}
        {gate.checking ? (
          <ActivityIndicator color={theme.color.textFaint} />
        ) : gate.failed ? (
          <View style={{ alignSelf: 'stretch', gap: theme.spacing.md }}>
            <Button label={t.extras.unlock} size="lg" fullWidth onPress={gate.retry} />
            <Button
              label={t.common.back}
              variant="secondary"
              size="lg"
              fullWidth
              onPress={goBack}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
