/**
 * A plain page header for a screen that opens straight onto cards: a back
 * arrow, a left-set title and, optionally, one control at the far end (a ⋮),
 * all on the page background. The body that follows supplies its own gutters.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function PlainHeader({
  title,
  subtitle,
  onBack,
  trailing,
}: {
  title: string;
  /** A muted line under the title (a document's number and status). */
  subtitle?: string;
  /** Defaults to going back one screen. */
  onBack?: () => void;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingTop: insets.top + theme.spacing.sm,
        paddingBottom: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.common.back}
        hitSlop={10}
        onPress={onBack ?? (() => router.back())}
        style={{ minWidth: 32, minHeight: 44, justifyContent: 'center' }}
      >
        <Ionicons
          name={directionalIcon('arrow-back')}
          size={iconSize.xl}
          color={theme.color.text}
        />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1} style={{ fontWeight: '800' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View>{trailing}</View> : null}
    </Row>
  );
}
