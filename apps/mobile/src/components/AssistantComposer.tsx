/**
 * The typed composer: the keyboard way into the assistant.
 *
 * One pill with a text field and a send button, and a mic on the side that
 * hands the screen back to voice. What is typed is sent exactly as a spoken
 * sentence would be ("800 lunch with Anu", "who owes me?"); the screen decides
 * whether the on-device parser or the agent reads it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { directionalIcon, iconSize, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { canSendTyped, cleanTyped, MAX_TYPED_CHARS } from '@/lib/assistantComposerPure';
import { hapticSelect } from '@/lib/assistantHaptics';
import { CHIP_HIT_SLOP } from '@/lib/assistantMotion';

export function AssistantComposer({
  value,
  onChangeText,
  onSend,
  onUseMic,
  busy = false,
  autoFocus = true,
}: {
  /** The draft lives with the screen, so a miss can put the text back. */
  value: string;
  onChangeText: (next: string) => void;
  onSend: (text: string) => void;
  /** Back to the mic. */
  onUseMic: () => void;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const sendable = canSendTyped(value, busy);

  const send = (): void => {
    const text = cleanTyped(value);
    if (!text || busy) return;
    hapticSelect();
    onSend(text);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        paddingLeft: theme.spacing.xs,
        paddingRight: theme.spacing.xs,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: theme.color.surface,
      }}
    >
      <Pressable
        onPress={() => {
          hapticSelect();
          onUseMic();
        }}
        accessibilityRole="button"
        accessibilityLabel={t.assistant.composerUseMic}
        hitSlop={CHIP_HIT_SLOP}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="mic-outline" size={iconSize.lg} color={theme.color.brand} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={send}
        autoFocus={autoFocus}
        editable={!busy}
        maxLength={MAX_TYPED_CHARS}
        returnKeyType="send"
        blurOnSubmit={false}
        placeholder={t.assistant.composerPlaceholder}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={t.assistant.composerLabel}
        style={{
          flex: 1,
          minHeight: 40,
          paddingVertical: 0,
          fontSize: theme.typography.body.fontSize,
          color: theme.color.text,
        }}
      />
      <Pressable
        onPress={send}
        disabled={!sendable}
        accessibilityRole="button"
        accessibilityLabel={t.assistant.composerSend}
        accessibilityState={{ disabled: !sendable }}
        hitSlop={CHIP_HIT_SLOP}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: sendable ? theme.color.brand : theme.color.surfaceMuted,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Ionicons
          name={directionalIcon('arrow-forward')}
          size={iconSize.lg}
          color={sendable ? theme.color.onBrand : theme.color.textFaint}
        />
      </Pressable>
    </View>
  );
}
