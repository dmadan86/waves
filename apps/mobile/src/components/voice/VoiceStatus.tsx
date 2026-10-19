/**
 * The status line under the mic: an icon and a word, never colour alone.
 *
 * It is a polite live region (Android) and is announced on iOS when it changes,
 * so a screen-reader user hears "Listening…", "Understanding your expense…",
 * "Expense ready" as they happen — once each, never a repeat.
 */

import { useEffect, useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AccessibilityInfo, Platform, View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

import { statusAnnouncement, type VoiceStatusKey } from '@/lib/voiceFlowPure';

const ICON: Record<VoiceStatusKey, React.ComponentProps<typeof Ionicons>['name']> = {
  ready: 'ellipse-outline',
  starting: 'hourglass-outline',
  listening: 'radio-button-on',
  processing: 'sparkles-outline',
  noSpeech: 'volume-mute-outline',
  noAmount: 'help-circle-outline',
  permission: 'lock-closed-outline',
  error: 'alert-circle-outline',
  expenseReady: 'checkmark-circle-outline',
  check: 'help-circle-outline',
  saving: 'hourglass-outline',
  saved: 'checkmark-done-outline',
};

export function VoiceStatus({ status, text }: { status: VoiceStatusKey; text: string }) {
  const theme = useTheme();
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const line = statusAnnouncement(announced.current, text);
    announced.current = text;
    if (line && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(line);
  }, [text]);
  const warn = status === 'noSpeech' || status === 'noAmount' || status === 'check';
  const bad = status === 'error' || status === 'permission';
  const color = bad
    ? theme.color.negative
    : warn
      ? theme.color.warning
      : status === 'ready'
        ? theme.color.textMuted
        : theme.color.brand;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        minHeight: 24,
      }}
    >
      <Ionicons name={ICON[status]} size={iconSize.sm} color={color} />
      <Text
        variant="body"
        style={{ fontWeight: '600', color: bad || warn ? theme.color.text : color }}
      >
        {text}
      </Text>
    </View>
  );
}
