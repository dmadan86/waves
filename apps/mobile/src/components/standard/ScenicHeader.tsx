/**
 * The standard screen header: a compact bar on the page colour with a back
 * chevron, the title set against it, one optional control at the far end and,
 * optionally, a row of controls underneath. No photo, no overlap: the screen
 * is about its content, and on a small Android every row of height counts.
 *
 * See docs/design-standard.md. Start the body in a `ScenicBody` for the gutters.
 * (The name is historical; it is kept so every screen keeps compiling.)
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useHeroStatusBar } from '@/components/ScreenHero';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** The body no longer rides over the header; kept at 0 for the screens that read it. */
export const SCENIC_OVERLAP = 0;

export function ScenicHeader({
  title,
  onBack,
  children,
  trailing,
  subtitle,
  action,
  onTitlePress,
  titleHint,
  identity,
}: {
  title: string;
  /** Defaults to going back one screen. */
  onBack?: () => void;
  /** The pills under the title, on the left. */
  children?: ReactNode;
  /** One pill at the right-hand end; on a narrow phone it drops to its own row. */
  trailing?: ReactNode;
  /** A line under the title. */
  subtitle?: string;
  /** One round control at the top-right, in the back button's place on the far side. */
  action?: ReactNode;
  /** Accepted for old callers; the title is always set against the back button now. */
  titleAlign?: 'center' | 'start';
  /** Accepted for old callers; there is no photo to read over. */
  circleBack?: boolean;
  /** Accepted for old callers; there is no photo to read over. */
  wash?: boolean;
  /** The children fill the row, so a control inside them can sit at the far end. */
  wide?: boolean;
  /** Makes the title a tap target with a chevron after it (a switcher); `titleHint` is its spoken label. */
  onTitlePress?: () => void;
  titleHint?: string;
  /** Replaces the centred title with your own block (an icon tile, title and subtitle) beside the back button. */
  identity?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  useHeroStatusBar(theme.scheme === 'dark' ? 'light' : 'dark');
  const ink = theme.color.text;
  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
      }}
    >
      <Row style={{ alignItems: 'center', minHeight: 44 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          onPress={onBack ?? (() => router.back())}
          hitSlop={8}
          style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.xl} color={ink} />
        </Pressable>
        {identity ? (
          <View style={{ flex: 1, marginStart: theme.spacing.xs }}>{identity}</View>
        ) : (
          <Pressable
            disabled={!onTitlePress}
            accessibilityRole={onTitlePress ? 'button' : undefined}
            accessibilityLabel={onTitlePress ? titleHint : undefined}
            onPress={onTitlePress}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginStart: theme.spacing.xs,
            }}
          >
            <Text
              variant="heading"
              accessibilityRole="header"
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: 20, lineHeight: 26 }}
            >
              {title}
            </Text>
            {onTitlePress ? (
              <Ionicons name="chevron-down" size={iconSize.base} color={theme.color.textMuted} />
            ) : null}
          </Pressable>
        )}
        {action ? (
          <View style={{ minWidth: 40, alignItems: 'flex-end', marginEnd: theme.spacing.sm }}>
            {action}
          </View>
        ) : null}
      </Row>
      {subtitle ? (
        <Text
          variant="caption"
          tone="muted"
          numberOfLines={2}
          style={{ marginStart: 40 + theme.spacing.xs, marginEnd: theme.spacing.sm }}
        >
          {subtitle}
        </Text>
      ) : null}
      {children || trailing ? (
        <Row
          style={{
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            columnGap: theme.spacing.sm,
            rowGap: theme.spacing.sm,
            marginTop: theme.spacing.md,
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm, flexShrink: 1 }}>
            {children}
          </Row>
          {trailing}
        </Row>
      ) : null}
    </View>
  );
}

/** The body under a `ScenicHeader`: the standard gutters and gaps. `flush`: the Team shell draws its own header. */
export function ScenicBody({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginTop: flush ? theme.spacing.md : theme.spacing.xs,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.lg,
      }}
    >
      {children}
    </View>
  );
}
