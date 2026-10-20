/**
 * Why the mic stopped without words, and the way forward: a refused permission
 * (Open settings when only Settings can fix it, else the mic asks again), or an
 * error (Try again): one explanation and one recovery. Typing is the header's
 * keypad, so it is not offered a second time here.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Button, iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import type { CaptureProblem } from '@/lib/voiceFlowPure';

export function VoiceErrorState({
  problem,
  onRetry,
  onOpenSettings,
}: {
  problem: Exclude<CaptureProblem, { kind: 'no-speech' }>;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const permission = problem.kind === 'permission';
  const settings = permission && problem.settings;
  return (
    <View
      accessibilityRole="alert"
      style={{
        alignSelf: 'stretch',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        ...theme.shadow.soft,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' }}>
        <Ionicons
          name={permission ? 'lock-closed-outline' : 'alert-circle-outline'}
          size={iconSize.md}
          color={theme.color.negative}
        />
        <Text variant="body" style={{ flex: 1 }}>
          {permission ? `${problem.message} ${t.voiceScreen.permissionBody}` : problem.message}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        <Button
          variant="brand"
          label={settings ? t.voiceScreen.openSettings : t.voiceScreen.retry}
          onPress={settings ? onOpenSettings : onRetry}
        />
      </View>
    </View>
  );
}
