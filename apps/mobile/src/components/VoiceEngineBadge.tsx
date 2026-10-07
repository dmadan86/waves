/**
 * A small pill saying which engine is hearing the mic: "Cloud" (the live
 * Deepgram stream) or "On-device", with the reason when it fell back.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import type { VoiceEngineInfo } from '@/lib/voiceEnginePure';

export function VoiceEngineBadge({ info }: { info: VoiceEngineInfo | null }) {
  const theme = useTheme();
  const { t } = useStrings();
  if (!info) return null;
  const cloud = info.engine === 'cloud';
  const reason =
    info.reason === 'free'
      ? t.voice.engineReasonFree
      : info.reason === 'quota'
        ? t.voice.engineReasonQuota
        : info.reason === 'offline'
          ? t.voice.engineReasonOffline
          : null;
  const label = cloud ? t.voice.engineCloud : t.voice.engineOnDevice;
  const text = reason ? `${label} · ${reason}` : label;
  return (
    <View
      accessible
      accessibilityLabel={text}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.surfaceMuted,
      }}
    >
      <Ionicons
        name={cloud ? 'cloud-outline' : 'phone-portrait-outline'}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
      <Text variant="caption" tone="muted">
        {text}
      </Text>
    </View>
  );
}
