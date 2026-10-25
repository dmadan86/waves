import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

/**
 * An empty list (no expenses, no vendor advances yet): a receipt and a plant, the fact in bold, what to
 * do about it, and the way to do it — inside the empty state rather than left
 * to a button somewhere else on the screen. Soft waves under it close the page.
 */
export function EmptyStateCta({
  title,
  body,
  action,
  onAdd,
  secondary,
  compact = false,
}: {
  compact?: boolean;
  title: string;
  body: string;
  action: string;
  onAdd: () => void;
  /** A quieter second way in, under the main button: a text link. */
  secondary?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const accent = compact || dark ? theme.color.brand : SPEC_ACCENT;
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.xs, paddingTop: theme.spacing.md }}>
      <Image
        source={GROUP_EMPTY_ART}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: compact ? 72 : EMPTY_ART_WIDTH,
          height: (compact ? 72 : EMPTY_ART_WIDTH) / EMPTY_ART_RATIO,
        }}
      />
      <Text
        style={{
          fontSize: 19,
          lineHeight: 24,
          fontWeight: '800',
          textAlign: 'center',
          color: compact || dark ? theme.color.text : SPEC_INK,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
          maxWidth: 300,
          color: compact || dark ? theme.color.textMuted : SPEC_MUTED,
        }}
      >
        {body}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onAdd}
        style={({ pressed }) => ({
          marginTop: theme.spacing.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          height: 44,
          paddingHorizontal: theme.spacing.xl,
          borderRadius: 22,
          backgroundColor: accent,
          shadowColor: accent,
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {action.startsWith('+') ? null : (
          <Ionicons name="add" size={20} color={compact ? theme.color.onBrand : '#FFFFFF'} />
        )}
        <Text
          style={{
            fontSize: 16,
            fontWeight: '700',
            color: compact ? theme.color.onBrand : '#FFFFFF',
          }}
        >
          {action}
        </Text>
      </Pressable>
      {secondary ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={secondary.label}
          onPress={secondary.onPress}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: accent }}>{secondary.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The empty state's picture: a receipt and a plant. Its shape (width over
 *  height, 1536 × 1024) and how wide it sits. */
const GROUP_EMPTY_ART = require('../../assets/images/group-empty.webp') as number;
const EMPTY_ART_RATIO = 1536 / 1024;
const EMPTY_ART_WIDTH = 120;
