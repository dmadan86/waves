/**
 * The body of the group-settings Tag sheet: a header, a tag field, the popular
 * tag chips and a full-width Save button.
 *
 * The tag is a draft held here. Nothing reaches the group until "Save tag", and
 * closing any other way throws the draft away — the parent mounts this only
 * while the sheet is open, so every opening starts from the saved tag. Saving
 * an empty draft clears the tag.
 */

import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Keyboard, Pressable, TextInput, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { GROUP_TAG_MAX } from '@/lib/groupTypeTag';

type ChipKey =
  | 'weekend'
  | 'roadTrip'
  | 'holiday'
  | 'officeOffsite'
  | 'birthday'
  | 'wedding'
  | 'family'
  | 'friends'
  | 'other';

type McIcon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export const TAG_CHIPS: readonly { key: ChipKey; icon: McIcon }[] = [
  { key: 'weekend', icon: 'calendar-month-outline' },
  { key: 'roadTrip', icon: 'car-outline' },
  { key: 'holiday', icon: 'palm-tree' },
  { key: 'officeOffsite', icon: 'briefcase-outline' },
  { key: 'birthday', icon: 'cake-variant-outline' },
  { key: 'wedding', icon: 'ring' },
  { key: 'family', icon: 'account-multiple-outline' },
  { key: 'friends', icon: 'account-multiple-outline' },
  { key: 'other', icon: 'dots-horizontal' },
];

export function TagSheetBody({
  value,
  onSave,
  onClose,
}: {
  value: string;
  onSave: (next: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [draft, setDraft] = useState(value);
  const input = useRef<TextInput>(null);

  const save = (): void => {
    Keyboard.dismiss();
    onSave(draft.trim());
    onClose();
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {/* Header: tile, title and subtitle, close. */}
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="pricetag-outline" size={iconSize.lg} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" accessibilityRole="header">
            {t.extras.tagLabel}
          </Text>
          <Text variant="caption" tone="muted">
            {t.extras.tagSheetSubtitle}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
        </Pressable>
      </Row>

      {/* The tag field. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          height: 52,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name="pricetag-outline" size={iconSize.md} color={theme.color.text} />
        <View style={{ width: 1.5, height: 24, backgroundColor: theme.color.textMuted }} />
        <TextInput
          ref={input}
          value={draft}
          onChangeText={setDraft}
          accessibilityLabel={t.extras.tagLabel}
          placeholder={t.extras.tagPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          maxLength={GROUP_TAG_MAX}
          returnKeyType="done"
          onSubmitEditing={save}
          autoCorrect={false}
          style={{ flex: 1, fontSize: 16, color: theme.color.text, paddingVertical: 0 }}
        />
      </View>

      {/* Popular tags. */}
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="body" tone="muted">
          {t.extras.tagPopular}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {TAG_CHIPS.map(({ key, icon }) => {
            const label = t.extras.tagChips[key];
            const isOther = key === 'other';
            const selected = !isOther && draft.trim() === label;
            const tint = selected ? theme.color.brand : theme.color.text;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                onPress={() => {
                  if (isOther) {
                    setDraft('');
                    input.current?.focus();
                  } else {
                    setDraft(selected ? '' : label);
                  }
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.lg,
                  height: 44,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.brandSoft,
                  borderWidth: 1.5,
                  borderColor: selected ? theme.color.brand : 'transparent',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons name={icon} size={iconSize.md} color={tint} />
                <Text variant="body" style={{ color: tint, fontWeight: selected ? '700' : '500' }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.extras.saveTag}
        onPress={save}
        style={({ pressed }) => ({
          height: 52,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.brand,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
          {t.extras.saveTag}
        </Text>
      </Pressable>
    </View>
  );
}
