/** The ONE card that groups everything needing action, with its rows and inline buttons. */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

export function CalmButton({
  label,
  onPress,
  primary = false,
  grow = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  /** The single filled button of the screen's verb. */
  primary?: boolean;
  grow?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: grow ? 1 : undefined,
        minHeight: 36,
        paddingHorizontal: theme.spacing.md,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? theme.color.brand : theme.color.brandSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        variant="body"
        style={{ fontWeight: '600', color: primary ? theme.color.onBrand : theme.color.brand }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface NeedAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
  readonly accessibilityLabel?: string;
}

/**
 * One thing that needs you. One action sits at the row's end; two sit below it,
 * side by side, the filled one last. Text wraps: amounts are never cut.
 */
export function NeedRow({
  icon,
  title,
  subtitle,
  subtitleTone = 'muted',
  actions,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  subtitleTone?: 'muted' | 'negative';
  actions: readonly NeedAction[];
}) {
  const theme = useTheme();
  const inline = actions.length === 1 ? actions[0] : undefined;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="subheading">{title}</Text>
          {subtitle ? (
            <Text
              variant="caption"
              style={{
                color:
                  subtitleTone === 'negative' ? theme.color.negativeText : theme.color.textMuted,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {inline ? (
          <CalmButton
            label={inline.label}
            onPress={inline.onPress}
            primary={inline.primary}
            accessibilityLabel={inline.accessibilityLabel}
          />
        ) : null}
      </Row>
      {actions.length > 1 ? (
        <Row style={{ gap: theme.spacing.sm }}>
          {actions.map((a) => (
            <CalmButton
              key={a.label}
              grow
              label={a.label}
              onPress={a.onPress}
              primary={a.primary}
              accessibilityLabel={a.accessibilityLabel}
            />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

export function NeedsYouCard({
  title,
  children,
  more,
}: {
  /** "Needs you · 3 things" */
  title: string;
  children: ReactNode;
  /** "Show 2 more" / "Show less"; omit when there is nothing to fold. */
  more?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surface,
        borderRadius: 12,
        padding: theme.spacing.md,
        gap: theme.spacing.md,
      }}
    >
      <Text accessibilityRole="header" variant="body" tone="brand" style={{ fontWeight: '700' }}>
        {title}
      </Text>
      {children}
      {more ? (
        <Pressable
          accessibilityRole="button"
          onPress={more.onPress}
          style={{ minHeight: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text variant="body" tone="brand" style={{ fontWeight: '600' }}>
            {more.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
