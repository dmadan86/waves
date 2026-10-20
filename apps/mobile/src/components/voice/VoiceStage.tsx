/**
 * The capture surface's fixed frame: the prompt, the floating mic, the status
 * line, the waveform's slot and the transcript. The live mic panel
 * (`VoiceCapture`) and the screen's "understanding…" step both draw it, so
 * moving from listening to processing changes words and the mic's glyph, never
 * the layout.
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

export interface VoiceStageProps {
  status: VoiceStatusKey;
  micMode: MicMode;
  onMicPress: () => void;
  reduceMotion: boolean;
  level?: SharedValue<number> | null;
  transcript: string;
  final: boolean;
  onEditTranscript?: () => void;
  /**
   * A card is answering under the stage (a question, the expense, Saved): the
   * "say it naturally" prompt and the empty wave room give way to it, so the
   * card sits right under the mic instead of below the fold.
   */
  settled?: boolean;
  /** Under the transcript: suggestions, the error card. */
  children?: ReactNode;
}

export function VoiceStage({
  status,
  micMode,
  onMicPress,
  reduceMotion,
  level,
  transcript,
  final,
  onEditTranscript,
  settled = false,
  children,
}: VoiceStageProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const open = micMode === 'stop';
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
      {/* Kept while speaking and understanding, so stopping the mic changes nothing. */}
      {settled ? null : (
        <View style={{ alignItems: 'center', gap: 4, paddingHorizontal: theme.spacing.sm }}>
          <Text variant="heading" align="center" accessibilityRole="header">
            {t.voiceScreen.headline}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t.voiceScreen.subline}
          </Text>
        </View>
      )}
      <FloatingMicrophone
        mode={micMode}
        level={level}
        onPress={onMicPress}
        label={micLabel(t, micMode)}
        reduceMotion={reduceMotion}
      />
      <View style={{ alignItems: 'center', gap: theme.spacing.sm, marginTop: -theme.spacing.sm }}>
        <VoiceStatus status={status} text={statusText(t, status)} />
        {/* The wave's room is kept until a card arrives, so nothing below it moves. */}
        {settled ? null : (
          <View style={{ height: WAVEFORM_HEIGHT, justifyContent: 'center' }}>
            {open && level ? <AudioWaveform level={level} reduceMotion={reduceMotion} /> : null}
          </View>
        )}
      </View>
      <LiveTranscript text={transcript} final={final} reserve onEdit={onEditTranscript} />
      {children}
    </View>
  );
}
