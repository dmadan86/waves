/**
 * The body of the create-group "Event template" sheet: which fixed sub-event
 * list a new Event group starts with (a wedding's ceremonies, a birthday's
 * spend areas), or the person's own name for it. Controlled by the create
 * screen, which writes the choice out once the group exists.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Keyboard, Pressable, TextInput, View } from 'react-native';

import { EVENT_TEMPLATES, type EventTemplateId } from '@waves/core';
import { ChipRow, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { GROUP_TAG_MAX } from '@/lib/groupTypeTag';

export function EventTemplateSheetBody({
  template,
  onTemplateChange,
  custom,
  onCustomChange,
  saved,
  onRemoveSaved,
  onClose,
}: {
  template: EventTemplateId | null;
  onTemplateChange: (next: EventTemplateId) => void;
  /** The person's own name, used when the template is "other". */
  custom: string;
  onCustomChange: (next: string) => void;
  /** Own names remembered on this device. */
  saved: readonly string[];
  onRemoveSaved: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
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
          <Ionicons name="sparkles-outline" size={iconSize.lg} color={theme.color.brand} />
        </View>
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {t.eventOrganizer.templateLabel}
        </Text>
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
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
        </Pressable>
      </Row>

      <View>
        <ChipRow<EventTemplateId>
          value={template ?? 'other'}
          onChange={onTemplateChange}
          options={EVENT_TEMPLATES.map((entry) => ({
            value: entry.id,
            label: t.eventOrganizer.templateNames[entry.id],
          }))}
        />
        {saved.length > 0 ? (
          <Row style={{ flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: theme.spacing.xs }}>
            {saved.map((name) => {
              const on =
                template === 'other' &&
                custom.trim().toLocaleLowerCase() === name.toLocaleLowerCase();
              return (
                <Row
                  key={name}
                  style={{
                    alignItems: 'center',
                    height: 36,
                    borderRadius: theme.radius.pill,
                    borderWidth: 1,
                    borderColor: on ? theme.color.brand : theme.color.border,
                    backgroundColor: on ? theme.color.brandSoft : 'transparent',
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={name}
                    onPress={() => {
                      onTemplateChange('other');
                      onCustomChange(name);
                    }}
                    style={{ paddingStart: theme.spacing.md, justifyContent: 'center' }}
                  >
                    <Text variant="caption" numberOfLines={1}>
                      {name}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t.eventOrganizer.customTemplateRemove}: ${name}`}
                    hitSlop={8}
                    onPress={() => onRemoveSaved(name)}
                    style={{ paddingHorizontal: theme.spacing.sm }}
                  >
                    <Ionicons name="close" size={iconSize.sm} color={theme.color.textMuted} />
                  </Pressable>
                </Row>
              );
            })}
          </Row>
        ) : null}
        {(template ?? 'other') === 'other' ? (
          <TextInput
            value={custom}
            onChangeText={(v) => onCustomChange(v.slice(0, GROUP_TAG_MAX))}
            maxLength={GROUP_TAG_MAX}
            placeholder={t.eventOrganizer.customTemplatePlaceholder}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={t.eventOrganizer.customTemplatePlaceholder}
            returnKeyType="done"
            style={{
              marginTop: theme.spacing.xs,
              height: 40,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surfaceMuted ?? theme.color.brandSoft,
              color: theme.color.text,
              fontSize: 15,
            }}
          />
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.common.done}
        onPress={() => {
          Keyboard.dismiss();
          onClose();
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
