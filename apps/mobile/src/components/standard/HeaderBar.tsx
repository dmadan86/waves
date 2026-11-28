import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** The round back and action buttons of every screen header. */
export const HEADER_BUTTON = 40;

/**
 * The one back header every sub-screen draws (PlainHeader, ScenicHeader and PlanningHeader all
 * render it): a round back button, a 21sp title with an optional one-line 13sp subtitle, up to
 * two round actions at the right, and an optional row of controls underneath. It sits directly
 * under the status bar with a single top inset. Change the family here, not on a screen.
 */
export function HeaderBar({
  title,
  subtitle,
  subtitleIcon,
  onBack,
  hideBack = false,
  action,
  identity,
  onTitlePress,
  titleHint,
  below,
}: {
  title: string;
  subtitle?: string;
  subtitleIcon?: ReactNode;
  /** Defaults to going back one screen. */
  onBack?: () => void;
  /** A tab root has no way back: the bar is the navigation. */
  hideBack?: boolean;
  /** Up to two round buttons (or one pill) at the far end. */
  action?: ReactNode;
  /** Replaces the title block with your own (an icon tile, title and subtitle). */
  identity?: ReactNode;
  /** Makes the title a tap target with a chevron after it (a switcher). */
  onTitlePress?: () => void;
  titleHint?: string;
  /** Controls on their own row under the title (pills, a month switcher). */
  below?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.xs,
        paddingBottom: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm, minHeight: HEADER_BUTTON }}>
        {hideBack ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            hitSlop={6}
            onPress={onBack ?? (() => router.back())}
            style={{
              width: HEADER_BUTTON,
              height: HEADER_BUTTON,
              borderRadius: HEADER_BUTTON / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.surface,
              borderWidth: 1,
              borderColor: theme.color.border,
            }}
          >
            <Ionicons
              name={directionalIcon('arrow-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </Pressable>
        )}
        {identity ? (
          <View style={{ flex: 1, minWidth: 0 }}>{identity}</View>
        ) : (
          <Pressable
            disabled={!onTitlePress}
            accessibilityRole={onTitlePress ? 'button' : undefined}
            accessibilityLabel={onTitlePress ? titleHint : undefined}
            onPress={onTitlePress}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
              <Text
                variant="heading"
                accessibilityRole="header"
                numberOfLines={1}
                style={{ flexShrink: 1, fontWeight: '800', fontSize: 21, lineHeight: 26 }}
              >
                {title}
              </Text>
              {onTitlePress ? (
                <Ionicons name="chevron-down" size={iconSize.base} color={theme.color.textMuted} />
              ) : null}
            </Row>
            {subtitle ? (
              <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                {subtitleIcon}
                <Text
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  style={{ fontSize: 13, flexShrink: 1 }}
                >
                  {subtitle}
                </Text>
              </Row>
            ) : null}
          </Pressable>
        )}
        {action ? <View>{action}</View> : null}
      </Row>
      {below}
    </View>
  );
}
