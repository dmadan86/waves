/**
 * The capture surface, in parts that all sit in one scroll over the photo.
 * {@link VoiceHeader} is the title row (brand mic, "Speak an expense", the ✕).
 * {@link VoiceTop} is the stage under it (headline, the floating mic, the status
 * line and the waveform): moving from listening to processing changes words and
 * the mic's glyph, never the layout. It is dropped once a card is answering.
 * {@link VoiceSheetBody} is the transcript and whatever the step shows under it.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings, type UiStrings } from '@/i18n';
import type { VoiceStatusKey } from '@/lib/voiceFlowPure';

import { AudioWaveform, WAVEFORM_HEIGHT } from './AudioWaveform';
import { FloatingMicrophone, type MicMode } from './FloatingMicrophone';
import { LiveTranscript } from './LiveTranscript';
import { VoiceStatus } from './VoiceStatus';

export function statusText(t: UiStrings, key: VoiceStatusKey): string {
  const s = t.voiceScreen;
  switch (key) {
    case 'ready':
      return s.statusReady;
    case 'starting':
      return s.statusStarting;
    case 'listening':
      return s.statusListening;
    case 'processing':
      return s.statusProcessing;
    case 'noSpeech':
      return s.statusNoSpeech;
    case 'noAmount':
      return s.statusNoAmount;
    case 'permission':
      return s.statusPermission;
    case 'error':
      return s.statusError;
    case 'expenseReady':
      return s.statusExpenseReady;
    case 'check':
      return s.statusCheck;
    case 'saving':
      return s.statusSaving;
    case 'saved':
      return s.statusSaved;
  }
}

export function micLabel(t: UiStrings, mode: MicMode): string {
  return mode === 'stop'
    ? t.voiceScreen.micStop
    : mode === 'busy'
      ? t.voiceScreen.micBusy
      : mode === 'retry'
        ? t.voiceScreen.micRetry
        : t.voiceScreen.micStart;
}

/** The title row: the brand mic, the heading, and the icon buttons at the end. */
export function VoiceHeader({ children }: { children?: ReactNode }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name="mic" size={iconSize.base} color={theme.color.brand} />
      </View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{ flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '800' }}
      >
        {t.voice.title}
      </Text>
      {children}
    </View>
  );
}

export interface VoiceTopProps {
  status: VoiceStatusKey;
  micMode: MicMode;
  onMicPress: () => void;
  reduceMotion: boolean;
  level?: SharedValue<number> | null;
  /** A short phone: the halo trims a little. */
  compact?: boolean;
}

export function VoiceTop({
  status,
  micMode,
  onMicPress,
  reduceMotion,
  level,
  compact = false,
}: VoiceTopProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const open = micMode === 'stop';
  return (
    <View style={{ alignItems: 'center' }}>
      <Text
        align="center"
        style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', marginTop: theme.spacing.md }}
      >
        {t.voiceScreen.headline}
      </Text>
      <Text variant="body" tone="muted" align="center">
        {t.voiceScreen.subline}
      </Text>
      {/* The halo's box is roomy; a short phone trims it rather than scrolling. */}
      <View
        style={{ alignSelf: 'stretch', alignItems: 'center', marginVertical: compact ? -14 : -4 }}
      >
        <FloatingMicrophone
          mode={micMode}
          level={level}
          onPress={onMicPress}
          label={micLabel(t, micMode)}
          reduceMotion={reduceMotion}
        />
      </View>
      <VoiceStatus status={status} text={statusText(t, status)} />
      {/* The wave only while the mic is open, under the mic; the words and cards follow it. */}
      {open && level ? (
        <View
          style={{
            alignSelf: 'stretch',
            height: WAVEFORM_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AudioWaveform level={level} reduceMotion={reduceMotion} />
        </View>
      ) : null}
    </View>
  );
}

export interface VoiceSheetBodyProps {
  transcript: string;
  final: boolean;
  /** Hold room for the words about to arrive (the mic is open). */
  reserve?: boolean;
  onEditTranscript?: () => void;
  /** Under the transcript: suggestions, the error card. */
  children?: ReactNode;
}

export function VoiceSheetBody({
  transcript,
  final,
  reserve,
  onEditTranscript,
  children,
}: VoiceSheetBodyProps) {
  const theme = useTheme();
  return (
    <View style={{ alignSelf: 'stretch', gap: theme.spacing.md }}>
      <LiveTranscript text={transcript} final={final} reserve={reserve} onEdit={onEditTranscript} />
      {children}
    </View>
  );
}
