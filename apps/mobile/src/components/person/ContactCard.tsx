/**
 * Contact information, or the honest reason there is none.
 *
 * The server sends contact details only when the person has let group-mates see
 * them, and "they asked us not to tell you" is a different thing from "we have
 * nothing": the first is a decision and says so. Everything else with no data is
 * simply absent — no empty rows, no "not provided" — so the card appears only
 * when there is something on it. There is no Edit here: a person's details are
 * theirs, and nothing in the app edits somebody else's.
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Card, Divider, iconSize, Row, Text, useTheme } from '@waves/ui';

import type { PersonProfileRow } from '@/data/api';
import { fill, useStrings } from '@/i18n';

type Glyph = keyof typeof Ionicons.glyphMap;

export function ContactCard({ profile }: { profile: PersonProfileRow }) {
  const theme = useTheme();
  const { t } = useStrings();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string): Promise<void> => {
    await Clipboard.setStringAsync(value);
    setCopied(value);
  };

  if (profile.contact_withheld) {
    return (
      <Card>
        <Text tone="muted">{fill(t.person.contactWithheld, { name: profile.display_name })}</Text>
      </Card>
    );
  }

  const lines: {
    key: string;
    icon: Glyph;
    label: string;
    value: string;
    actionIcon?: Glyph;
    actionLabel?: string;
    onAction?: () => void;
  }[] = [];
  if (profile.phone) {
    const phone = profile.phone;
    lines.push({
      key: 'phone',
      icon: 'call-outline',
      label: t.person.phone,
      value: phone,
      actionIcon: 'call-outline',
      actionLabel: t.person.call,
      onAction: () => void Linking.openURL(`tel:${phone}`),
    });
  }
  if (profile.email) {
    const email = profile.email;
    lines.push({
      key: 'email',
      icon: 'mail-outline',
      label: t.person.email,
      value: email,
      actionIcon: 'mail-outline',
      actionLabel: t.person.message,
      onAction: () => void Linking.openURL(`mailto:${email}`),
    });
  }
  if (profile.payment_handle) {
    lines.push({
      key: 'handle',
      icon: 'wallet-outline',
      label: t.person.paidVia,
      value: profile.payment_handle,
    });
  }
  if (lines.length === 0) return null;

  return (
    <Card style={{ paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg }}>
      <Text variant="subheading" style={{ marginBottom: theme.spacing.xs }}>
        {t.person.contactInfo}
      </Text>
      {lines.map((line, index) => (
        <View key={line.key}>
          {index > 0 ? <Divider /> : null}
          <Row style={{ alignItems: 'center', gap: theme.spacing.md, minHeight: 56 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name={line.icon} size={iconSize.md} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption" tone="muted">
                {line.label}
              </Text>
              {/* Latin digits inside whatever script the screen is in: isolated
                  like every other number here, or a leading '+' walks to the
                  wrong end in Arabic. */}
              <Text numberOfLines={1} style={{ writingDirection: 'ltr', textAlign: 'left' }}>
                {line.value}
              </Text>
            </View>
            <SquareAction
              icon={copied === line.value ? 'checkmark' : 'copy-outline'}
              label={copied === line.value ? t.person.copied : t.person.copy}
              color={copied === line.value ? theme.color.positive : theme.color.textMuted}
              onPress={() => void copy(line.value)}
            />
            {line.actionIcon && line.onAction ? (
              <SquareAction
                icon={line.actionIcon}
                label={line.actionLabel ?? ''}
                color={theme.color.brand}
                onPress={line.onAction}
              />
            ) : null}
          </Row>
        </View>
      ))}
    </Card>
  );
}

function SquareAction({
  icon,
  label,
  color,
  onPress,
}: {
  icon: Glyph;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: theme.radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surfaceMuted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.color.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={color} />
    </Pressable>
  );
}
