/**
 * The capture surface, in two parts. {@link VoiceTop} is the fixed area over
 * the photo (title, the lines under it, the floating mic, the status pill and
 * the waveform's slot): the screen draws it once, above the sheet, in every
 * phase, so moving from listening to processing changes words and the mic's
 * glyph, never the layout. {@link VoiceSheetBody} is what sits at the head of
 * the sheet: the transcript and whatever the step shows under it.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { Text, useTheme } from '@waves/ui';

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

export interface VoiceTopProps {
  status: VoiceStatusKey;
  micMode: MicMode;
  onMicPress: () => void;
  reduceMotion: boolean;
  level?: SharedValue<number> | null;
  /** The status bar's height; the title starts below the ✕ row under it. */
  topInset: number;
  /** A short phone: the halo, wave room and title give a little. */
  compact?: boolean;
}

/** Height of the ✕ row the title sits under. */
export const TOP_BAR = 52;

export function VoiceTop({
  status,
  micMode,
  onMicPress,
  reduceMotion,
  level,
  topInset,
  compact = false,
}: VoiceTopProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const open = micMode === 'stop';
  return (
    <View
      pointerEvents="box-none"
      style={{
        alignItems: 'center',
        paddingTop: topInset + TOP_BAR,
        paddingHorizontal: theme.spacing.xl,
      }}
    >
      <Text
        align="center"
        accessibilityRole="header"
        style={{ fontSize: compact ? 26 : 32, lineHeight: compact ? 32 : 38, fontWeight: '800' }}
      >
        {t.voice.title}
      </Text>
      <Text
        variant="body"
        tone="muted"
        align="center"
        style={{ fontWeight: '500', marginTop: theme.spacing.xs }}
      >
        {t.voiceScreen.headline}
      </Text>
      <Text variant="body" tone="muted" align="center">
        {t.voiceScreen.subline}
      </Text>
      {/* The halo's box is roomy; a short phone trims it rather than scrolling. */}
      <View style={{ marginVertical: compact ? -14 : -4 }}>
        <FloatingMicrophone
          mode={micMode}
          level={level}
          onPress={onMicPress}
          label={micLabel(t, micMode)}
          reduceMotion={reduceMotion}
        />
      </View>
      <VoiceStatus status={status} text={statusText(t, status)} />
      {/* The wave's room is always kept, so nothing below it moves. */}
      <View
        style={{
          height: compact ? WAVEFORM_HEIGHT * 0.6 : WAVEFORM_HEIGHT,
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {open && level ? <AudioWaveform level={level} reduceMotion={reduceMotion} /> : null}
      </View>
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
    <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <LiveTranscript text={transcript} final={final} reserve={reserve} onEdit={onEditTranscript} />
      {children}
    </View>
  );
}
