/**
 * Change one field, in a sheet over the list it came from.
 *
 * The account screen reads as a list of what you have set, which only works if
 * the list is short — and a list is short when each row is one line rather than
 * a card wrapped around a text input. So the input lives here instead: tap the
 * row, type, save, and the row shows the new value.
 *
 * It keeps its own draft. Editing straight into the caller's state means a
 * cancelled edit has already been applied to everything watching it, and the
 * caller has to remember what the value was to put it back. The draft is seeded
 * each time the sheet opens, so re-opening after a cancel shows the saved value
 * and not the abandoned one.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

import { Button, Row, Sheet, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export function EditTextSheet({
  visible,
  title,
  hint,
  value,
  placeholder,
  multiline = false,
  autoCapitalize = 'words',
  saving = false,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** One line under the title: what this is for, when that is not obvious. */
  hint?: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'words' | 'sentences';
  /** A write is in flight — the field and both doors hold still until it lands. */
  saving?: boolean;
  onSave: (next: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [draft, setDraft] = useState(value);
  const field = useRef<TextInput>(null);

  /**
   * Seeded once per opening, during render rather than from an effect.
   *
   * It has to be once per *opening* and not on every render: the saved value
   * arrives from the mirror while somebody is still typing, and re-seeding on
   * it would overwrite their edit with the value they are in the middle of
   * changing. And it is done in render because seeding from an effect means a
   * first frame drawn with the previous field's text, then a second with this
   * one — the cascading render the lint rule is about. A `setState` during a
   * component's own render is React's sanctioned way to say "this is derived
   * from a prop change", and it re-renders before anything is committed.
   */
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  if (visible && openedWith === null) {
    setOpenedWith(value);
    setDraft(value);
  }
  if (!visible && openedWith !== null) setOpenedWith(null);

  // The keyboard comes up with the sheet. Somebody who tapped a row to change
  // a value has already decided to type; making them tap again is a tap this
  // screen exists to remove. Delayed a frame so the field is laid out first —
  // focusing a view that has not been measured is a no-op on Android.
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => field.current?.focus(), 150);
    return () => clearTimeout(id);
  }, [visible]);

  const trimmed = draft.trim();
  const changed = trimmed !== value.trim();

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">{title}</Text>
          {hint ? (
            <Text variant="caption" tone="muted">
              {hint}
            </Text>
          ) : null}
        </View>

        <TextInput
          ref={field}
          value={draft}
          onChangeText={setDraft}
          editable={!saving}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          accessibilityLabel={title}
          placeholder={placeholder}
          placeholderTextColor={theme.color.textFaint}
          // Enter saves a single-line field, the way a search or a rename does
          // everywhere else. A multiline field keeps Enter as a newline.
          returnKeyType={multiline ? 'default' : 'done'}
          onSubmitEditing={() => {
            if (!multiline && changed && !saving) onSave(trimmed);
          }}
          style={{
            borderWidth: 1,
            borderColor: theme.color.border,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
            fontSize: 16,
            color: theme.color.text,
            backgroundColor: theme.color.surface,
            ...(multiline ? { minHeight: 96, textAlignVertical: 'top' as const } : null),
          }}
        />

        <Row style={{ gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t.common.cancel} variant="secondary" fullWidth onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            {/* Disabled until something actually changed: a Save that writes the
                value already saved is a request, a spinner and a "Saved" for
                nothing. */}
            <Button
              label={saving ? t.common.loading : t.common.save}
              fullWidth
              disabled={!changed || saving}
              onPress={() => onSave(trimmed)}
            />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}
