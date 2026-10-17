/**
 * Answering the agent's question by typing: one compact line with the keyboard
 * up, a mic to switch back to speaking, and a send button that stays off until
 * there is something to send. The caller turns the text into the same follow-up
 * a spoken answer sends (`typedFollowUp`).
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { iconSize, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export interface VoiceTypedAnswerProps {
  /** Send the typed text (already non-blank). */
  onSubmit: (text: string) => void;
  /** Go back to speaking the answer. */
  onVoice: () => void;
  autoFocus?: boolean;
}

export function VoiceTypedAnswer({ onSubmit, onVoice, autoFocus = true }: VoiceTypedAnswerProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const [text, setText] = useState('');
  const ready = text.trim().length > 0;
  const submit = (): void => {
    if (ready) onSubmit(text);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        height: 48,
        paddingLeft: theme.spacing.md,
        paddingRight: theme.spacing.xs,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.bg,
      }}
    >
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus={autoFocus}
        placeholder={t.voice.agentTypePlaceholder}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={t.voice.agentTypePlaceholder}
        returnKeyType="send"
        blurOnSubmit={false}
        onSubmitEditing={submit}
        style={{ flex: 1, fontSize: 16, color: theme.color.text, paddingVertical: 0 }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.voice.agentTypeMic}
        onPress={onVoice}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="mic-outline" size={iconSize.lg} color={theme.color.brand} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.voice.agentTypeSend}
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={submit}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brand,
          opacity: !ready ? 0.4 : pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="arrow-up" size={iconSize.lg} color={theme.color.onBrand} />
      </Pressable>
    </View>
  );
}
