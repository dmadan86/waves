/**
 * The description field the expense forms share.
 *
 * A single underlined field rather than a boxed card — it sits right under the
 * amount so the two things a person always fills in are together, with a leading
 * receipt glyph and the mic to speak it instead of type (A5). Group or member
 * names are handed to the recogniser as hints — a general model mangles Indian
 * names, and a note like "dinner with Ravi" is exactly where they turn up.
 *
 * `multiline` lets the group form keep its taller note while capture stays a
 * single line; the underline styling is the same either way.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { TextInput, View } from 'react-native';

import { iconSize, Row, useTheme } from '@waves/ui';

import { DictateButton } from '@/components/DictateButton';

export function DescriptionField({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  hints,
  multiline = false,
  boxed = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  /** Names to bias the recogniser towards (group names, or member names). */
  hints?: readonly string[];
  multiline?: boolean;
  /** The Save an expense look: a card of its own, the mic set off by a rule. */
  boxed?: boolean;
  /** Raise the keyboard on arrival (the "Add vendor" hand-off). */
  autoFocus?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Row
      style={
        boxed
          ? {
              alignItems: multiline ? 'flex-start' : 'center',
              gap: theme.spacing.md,
              paddingStart: theme.spacing.lg,
              paddingEnd: theme.spacing.sm,
              paddingVertical: theme.spacing.sm,
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
            }
          : {
              alignItems: multiline ? 'flex-start' : 'center',
              gap: theme.spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: theme.color.border,
              paddingBottom: theme.spacing.xs,
            }
      }
    >
      <Ionicons
        name="receipt-outline"
        size={boxed ? iconSize.lg : iconSize.md}
        color={theme.color.textMuted}
        style={multiline ? { paddingTop: theme.spacing.sm } : undefined}
      />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={accessibilityLabel}
        multiline={multiline}
        autoFocus={autoFocus}
        textAlignVertical={multiline ? 'top' : undefined}
        style={{
          flex: 1,
          fontSize: 17,
          fontWeight: '600',
          color: theme.color.text,
          paddingVertical: theme.spacing.sm,
          ...(multiline ? { minHeight: 44 } : null),
        }}
      />
      {boxed ? (
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }} />
      ) : null}
      <View style={multiline ? { paddingTop: theme.spacing.xs } : undefined}>
        <DictateButton value={value} onChange={onChange} hints={hints} />
      </View>
    </Row>
  );
}
