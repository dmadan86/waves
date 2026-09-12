/**
 * The note field the private ledger's three editors share — with its mic.
 *
 * A note on a personal record is the same thing a note on a shared expense is:
 * a sentence somebody would rather say than thumb in, usually while standing at
 * the counter that produced it. The shared side has had the mic since A5 (see
 * `expense/DescriptionField`), and the friends IOU has it too, but the "Me" tab
 * grew its own note as a plain `TextInput` on three separate screens and so
 * quietly missed out — the same field, with the one affordance removed, three
 * times over.
 *
 * It is one component rather than three copies for exactly that reason. The
 * three call sites had already drifted apart in small ways (one labels the
 * field, two rely on the placeholder; none of them named it for a screen
 * reader), and a fourth editor added later would have copied whichever one its
 * author happened to open. The accompanying test reads those screens' source
 * and insists a personal note goes through here, so the next one cannot ship
 * mute.
 *
 * The mic itself is not reimplemented and must not be: `DictateButton` is the
 * launch-safe wrapper that reaches the native recogniser through a guarded
 * `require`, and every question about permissions, on-device models and OEM
 * ROMs with dead network speech is already answered behind it. This file only
 * decides where the button sits.
 */

import { TextInput, View } from 'react-native';

import { Row, Text, useTheme } from '@waves/ui';

import { DictateButton } from '@/components/DictateButton';

export function PersonalNoteField({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  label,
  hints,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /**
   * What the field is, for a screen reader. Not optional: the two sheet editors
   * used to offer a box whose only description was its placeholder, which a
   * screen reader stops announcing the moment anything is typed into it.
   */
  accessibilityLabel: string;
  /** The caption drawn above the box, where the screen shows one. */
  label?: string;
  /** Names to bias the recogniser towards — see {@link DictateButton}. */
  hints?: readonly string[];
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {label ? (
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      ) : null}
      {/* The mic sits beside the box rather than inside it, as it does on the
          expense description: it is a 44-point target in its own right, and a
          button floated over a text field is one the keyboard's own suggestion
          strip fights with. `Row` is `flexDirection: 'row'`, so the mic follows
          the writing direction into the leading position under RTL without this
          file needing to know which way that is. */}
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.textFaint}
          accessibilityLabel={accessibilityLabel}
          style={{
            flex: 1,
            fontSize: 16,
            color: theme.color.text,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.md,
          }}
        />
        {/* Renders nothing on web, and nothing on a binary built before the
            speech module existed. Both leave the field exactly as it is today. */}
        <DictateButton value={value} onChange={onChange} hints={hints} />
      </Row>
    </View>
  );
}
