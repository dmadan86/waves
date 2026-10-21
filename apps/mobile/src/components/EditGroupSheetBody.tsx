/**
 * The body of the group-settings "Edit group" sheet: the cover with its camera
 * badge, a title and subtitle, a round close, a name field, a description field
 * and a full-width Done button.
 *
 * The fields are controlled by the parent, which saves them on blur, on the
 * keyboard's "done", on Done and whenever the sheet is closed (X, backdrop or
 * swipe) — which is what makes the "Changes save automatically" subtitle true.
 * A name that is empty is never saved: the parent puts the old name back.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { GROUP_DESCRIPTION_MAX } from '@/lib/groupDescription';

export const EDIT_GROUP_NAME_MAX = 120;

function Field({
  icon,
  value,
  onChangeText,
  onCommit,
  label,
  placeholder,
  maxLength,
  multiline,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: string;
  onChangeText: (next: string) => void;
  onCommit: () => void;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        minHeight: 56,
        borderRadius: 18,
        backgroundColor: theme.color.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.color.border,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name={icon} size={iconSize.md} color={theme.color.brand} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onCommit}
        onSubmitEditing={multiline ? undefined : onCommit}
        returnKeyType="done"
        blurOnSubmit
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        maxLength={maxLength}
        multiline={multiline}
        style={{
          flex: 1,
          fontSize: 17,
          fontWeight: '500',
          color: theme.color.text,
          paddingVertical: theme.spacing.sm,
        }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.annotate.clear}
          hitSlop={8}
          onPress={() => onChangeText('')}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: theme.color.border,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: theme.spacing.xs,
          }}
        >
          <Ionicons name="close" size={16} color={theme.color.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function EditGroupSheetBody({
  cover,
  onCoverPress,
  name,
  onNameChange,
  onNameCommit,
  description,
  onDescriptionChange,
  onDescriptionCommit,
  onDone,
  onClose,
}: {
  /** The cover, drawn as the settings header draws it. */
  cover: ReactNode;
  onCoverPress: () => void;
  name: string;
  onNameChange: (next: string) => void;
  onNameCommit: () => void;
  description: string;
  onDescriptionChange: (next: string) => void;
  onDescriptionCommit: () => void;
  onDone: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.group.changeCover}
          onPress={onCoverPress}
        >
          {cover}
          <View
            style={{
              position: 'absolute',
              right: -4,
              bottom: -4,
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brand,
              borderWidth: 2,
              borderColor: theme.color.surface,
            }}
          >
            <Ionicons name="camera" size={16} color={theme.color.onBrand} />
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" accessibilityRole="header">
            {t.group.editGroup}
          </Text>
          <Text variant="caption" tone="muted">
            {t.group.editGroupHint}
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

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="body" tone="muted">
          {t.group.groupName}
        </Text>
        <Field
          icon="pencil-outline"
          value={name}
          onChangeText={onNameChange}
          onCommit={onNameCommit}
          label={t.group.groupName}
          placeholder={t.group.groupName}
          maxLength={EDIT_GROUP_NAME_MAX}
        />
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="body" tone="muted">
          {t.group.descriptionOptional}
        </Text>
        <Field
          icon="text-box-outline"
          value={description}
          onChangeText={onDescriptionChange}
          onCommit={onDescriptionCommit}
          label={t.group.groupDescription}
          placeholder={t.group.descriptionPlaceholder}
          maxLength={GROUP_DESCRIPTION_MAX}
          multiline
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.common.done}
        onPress={() => {
          Keyboard.dismiss();
          onDone();
        }}
        style={({ pressed }) => ({
          height: 56,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.brand,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
          {t.common.done}
        </Text>
      </Pressable>
    </View>
  );
}
