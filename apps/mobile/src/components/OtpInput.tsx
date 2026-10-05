/**
 * The one-time code, as a row of boxed cells rather than one long field.
 *
 * Shared by the phone and the email verification screens. A single hidden
 * `TextInput` does the actual work — it holds the digits, raises the number pad
 * and receives the SMS/email autofill — and the boxes are only a drawing of its
 * value. Tapping anywhere on the row focuses it. Each empty cell shows a faint
 * `0` as a placeholder; the cell about to be typed carries a blinking caret.
 * The row is pinned left-to-right so the digits keep
 * their order under an RTL layout, where a code is still read the same way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Text, useTheme } from '@waves/ui';

/** Both the phone and email codes are six digits. */
export const OTP_LEN = 6;

export function OtpInput({
  value,
  onChangeText,
  length = OTP_LEN,
  accessibilityLabel,
  autoFocus,
}: {
  value: string;
  onChangeText: (next: string) => void;
  length?: number;
  accessibilityLabel: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  // The caret blinks on its own.
  const blink = useSharedValue(1);
  useEffect(() => {
    blink.value = withRepeat(withTiming(0, { duration: 550, easing: Easing.ease }), -1, true);
    return () => cancelAnimation(blink);
  }, [blink]);
  const caretStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  // `focus()` on a field the native side already believes is focused does
  // nothing, and that is exactly the state a return from a browser leaves it in:
  // Firebase's reCAPTCHA custom tab backgrounds the activity while this screen
  // mounts, `autoFocus` fires once into a window that is not showing, and the
  // field is left "focused" with no keyboard and no input connection — the
  // caret draws, typing goes nowhere. So a focus request lets go first.
  const focus = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    if (input.isFocused()) input.blur();
    input.focus();
  }, []);

  // Asked more than once, a beat apart: the first request can land before the
  // window is interactive (new architecture mounts and focuses in one commit).
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const focusSoon = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [60, 350].map((ms) => setTimeout(focus, ms));
  }, [focus]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // On arrival, on the screen regaining focus, and on the app coming back to
  // the foreground — never relying on `autoFocus` alone.
  useFocusEffect(
    useCallback(() => {
      if (autoFocus) focusSoon();
    }, [autoFocus, focusSoon]),
  );
  useEffect(() => {
    if (!autoFocus) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') focusSoon();
    });
    return () => sub.remove();
  }, [autoFocus, focusSoon]);

  return (
    <Pressable
      onPress={focus}
      accessibilityRole="none"
      style={{ flexDirection: 'row', gap: theme.spacing.sm, direction: 'ltr' }}
    >
      {Array.from({ length }, (_, i) => {
        const digit = value[i];
        const active = focused && i === value.length && value.length < length;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              aspectRatio: 0.82,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
            }}
          >
            {active ? (
              <Animated.View
                style={[
                  { width: 2, height: 28, borderRadius: 1, backgroundColor: theme.color.brand },
                  caretStyle,
                ]}
              />
            ) : null}
            <Text
              style={{
                fontSize: 28,
                fontWeight: '700',
                color: digit ? theme.color.text : theme.color.textFaint,
              }}
            >
              {digit ?? '0'}
            </Text>
          </View>
        );
      })}

      {/* The real field, off-screen but focusable: it owns the value and the
          keyboard; the boxes above are its readout. */}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, '').slice(0, length))}
        // No `maxLength`: the native cap would cut a pasted "G-123456" before
        // it could be stripped to its digits.
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoFocus={autoFocus}
        autoCorrect={false}
        importantForAutofill="yes"
        accessibilityLabel={accessibilityLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
    </Pressable>
  );
}
