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
}: {
  title: string;
  body: string;
  action: string;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.lg }}>
      <Image
        source={GROUP_EMPTY_ART}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: EMPTY_ART_WIDTH, height: EMPTY_ART_WIDTH / EMPTY_ART_RATIO }}
      />
      <Text
        style={{
          fontSize: 26,
          lineHeight: 32,
          fontWeight: '800',
          textAlign: 'center',
          color: dark ? theme.color.text : SPEC_INK,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontSize: 16,
          lineHeight: 23,
          textAlign: 'center',
          maxWidth: 300,
          color: dark ? theme.color.textMuted : SPEC_MUTED,
        }}
      >
        {body}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onAdd}
        style={({ pressed }) => ({
          marginTop: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          height: 54,
          paddingHorizontal: theme.spacing.xxl,
          borderRadius: 27,
          backgroundColor: accent,
          shadowColor: accent,
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="add" size={24} color="#FFFFFF" />
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>{action}</Text>
      </Pressable>
    </View>
  );
}

/** The empty state's picture: a receipt and a plant. Its shape (width over
 *  height, 1536 × 1024) and how wide it sits. */
const GROUP_EMPTY_ART = require('../../assets/images/group-empty.webp') as number;
const EMPTY_ART_RATIO = 1536 / 1024;
const EMPTY_ART_WIDTH = 200;
