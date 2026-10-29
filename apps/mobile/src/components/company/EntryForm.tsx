/**
 * The pieces of the company "Add entry" form: kind tiles, labelled fields, the
 * category grid and the save bar. Plain, compact, one look (the mockup's).
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { BLUE, GREEN } from './dashboard/parts';

type Icon = keyof typeof Ionicons.glyphMap;

export function KindTile({
  icon,
  title,
  sub,
  selected,
  onPress,
}: {
  icon: Icon;
  title: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = selected ? theme.color.onBrand : theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 64,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingHorizontal: 4,
        borderRadius: theme.radius.lg,
        backgroundColor: selected ? theme.color.brand : theme.color.brandSoft,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={iconSize.base} color={ink} />
        <Text
          variant="body"
          numberOfLines={1}
          style={{
            fontWeight: '700',
            fontSize: 13,
            color: selected ? theme.color.onBrand : undefined,
          }}
        >
          {title}
        </Text>
      </View>
      {sub ? (
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ fontSize: 10, color: selected ? theme.color.onBrand : theme.color.textMuted }}
        >
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="muted" style={{ fontWeight: '600', marginBottom: -4 }}>
      {children}
    </Text>
  );
}

/** An outlined row: a leading glyph, the value (or a muted placeholder), a trailing control. */
export function SelectField({
  icon,
  text = '',
  input,
  placeholder = false,
  onPress,
  trailing,
  chevron = true,
  label,
}: {
  icon: Icon;
  text?: string;
  /** A field of its own in place of the text (the note). */
  input?: ReactNode;
  placeholder?: boolean;
  onPress?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${text}`}
      disabled={!onPress}
      onPress={onPress}
      style={{
        minHeight: 46,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      <Ionicons name={icon} size={iconSize.base} color={theme.color.textMuted} />
      {input ?? (
        <Text
          variant="body"
          numberOfLines={1}
          tone={placeholder ? 'muted' : undefined}
          style={{ flex: 1 }}
        >
          {text}
        </Text>
      )}
      {trailing}
      {onPress && chevron ? (
        <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
      ) : null}
    </Pressable>
  );
}

/** The dashed "Add receipt or photo" row. */
export function DashedRow({
  icon,
  label,
  onPress,
}: {
  icon: Icon;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.color.border,
      }}
    >
      <Ionicons name={icon} size={iconSize.base} color={theme.color.textMuted} />
      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
        {label}
      </Text>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}

const TAG_ICON: Record<string, [Icon, string]> = {
  food: ['restaurant', '#6D4AE8'],
  transport: ['car', BLUE],
  fuel: ['color-fill', GREEN],
  travel: ['airplane', '#0EA5E9'],
  office: ['briefcase', '#F97316'],
  stay: ['bed', '#5B5BD6'],
  other: ['ellipsis-horizontal', '#8B5CF6'],
};

export interface TagTile {
  readonly key: string;
  readonly label: string;
}

/** 4 x 2: the seven best tags and "All tags", which opens the full picker. */
export function TagGrid({
  tags,
  value,
  onChange,
  onMore,
  moreLabel,
}: {
  tags: readonly TagTile[];
  value: string | null;
  onChange: (key: string) => void;
  onMore: () => void;
  moreLabel: string;
}) {
  const theme = useTheme();
  // The chosen tag always shows, even when it ranks below the seventh.
  const shown = tags.slice(0, 7);
  const chosen = tags.find((tag) => tag.key === value);
  if (chosen && !shown.includes(chosen)) shown[shown.length - 1] = chosen;
  const cells = [
    ...shown.map((tag) => {
      const [icon, tint] = TAG_ICON[tag.key] ?? ['pricetag', theme.color.brand];
      return { key: tag.key, label: tag.label, icon, tint, selected: tag.key === value };
    }),
    {
      key: '__all',
      label: moreLabel,
      icon: 'pricetag-outline' as Icon,
      tint: theme.color.textMuted,
      selected: false,
    },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {cells.map((cell) => (
        <Pressable
          key={cell.key}
          accessibilityRole="button"
          accessibilityState={{ selected: cell.selected }}
          onPress={() => (cell.key === '__all' ? onMore() : onChange(cell.key))}
          style={{
            width: '23%',
            flexGrow: 1,
            height: 68,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            borderRadius: theme.radius.lg,
            borderWidth: 1.5,
            borderColor: cell.selected ? theme.color.brand : 'transparent',
            backgroundColor: cell.selected ? theme.color.brandSoft : theme.color.surfaceMuted,
          }}
        >
          <Ionicons name={cell.icon} size={iconSize.lg} color={cell.tint} />
          <Text variant="caption" numberOfLines={1} style={{ fontSize: 12, fontWeight: '500' }}>
            {cell.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The full-width brand button with its arrow at the far end. */
export function SaveButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: 52,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radius.pill,
          backgroundColor: pressed ? theme.color.brandPressed : theme.color.brand,
          opacity: disabled ? 0.45 : 1,
        },
        theme.shadow.soft,
      ]}
    >
      <Text variant="subheading" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
        {label}
      </Text>
      <View style={{ position: 'absolute', end: theme.spacing.xl }}>
        <Ionicons
          name={directionalIcon('arrow-forward')}
          size={iconSize.base}
          color={theme.color.onBrand}
        />
      </View>
    </Pressable>
  );
}
