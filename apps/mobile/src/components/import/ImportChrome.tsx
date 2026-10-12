/**
 * The frame the import steps share: a header with a back arrow and the step's
 * name, a soft tinted glyph, and a pinned footer for the step's one action.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { directionalIcon, IconButton, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';

export function ImportHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  /** Null hides the arrow, for a step that must not be left (an import under way). */
  onBack: (() => void) | null;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
      {onBack ? (
        <IconButton label={t.common.back} onPress={onBack}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

/** A glyph in a soft disc: the one mark a card or row leads with. */
export function Disc({
  icon,
  fill,
  ink,
  size = 40,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  fill: string;
  ink: string;
  size?: number;
}): React.JSX.Element {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size > 36 ? iconSize.lg : iconSize.md} color={ink} />
    </View>
  );
}

/** The step's action, pinned above the bottom bar. */
export function ImportFooter({
  children,
  note,
}: {
  children: ReactNode;
  /** One quiet line over the button: what will be left out, or why it is waiting. */
  note?: string | null;
}): React.JSX.Element {
  const theme = useTheme();
  const clearance = useBottomClearance();
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.md,
        paddingBottom: clearance,
        gap: theme.spacing.xs,
        backgroundColor: theme.color.bg,
        borderTopWidth: 1,
        borderTopColor: theme.color.border,
      }}
    >
      {note ? (
        <Text variant="caption" tone="muted" align="center">
          {note}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
