/**
 * The header and the Recurring | Budgets | Loans switch shared by the three
 * Planning screens, so they read as one set. Switching uses `replace`: the three
 * are siblings, so Back leaves Planning instead of walking through every tab.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

type Tab = 'recurring' | 'budgets' | 'loans';
const HREF = {
  recurring: '/personal/recurring',
  budgets: '/personal/budgets',
  loans: '/personal/loans',
} as const;

export function PlanningHeader({
  title,
  subtitle,
  addLabel,
  onAdd,
  hideBack = false,
}: {
  title: string;
  subtitle: string;
  addLabel?: string;
  onAdd?: () => void;
  hideBack?: boolean;
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
      {hideBack ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          onPress={() => router.back()}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="heading" numberOfLines={1} style={{ fontWeight: '800' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          onPress={onAdd}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
        </Pressable>
      ) : null}
    </Row>
  );
}

export function PlanningTabs({ value }: { value: Tab }) {
  const theme = useTheme();
  const { t } = useStrings();
  const tabs: readonly [Tab, string][] = [
    ['recurring', t.personal.recurring],
    ['budgets', t.personal.budgets],
    ['loans', t.personal.loans],
  ];
  return (
    <Row
      accessibilityRole="tablist"
      style={{
        padding: 4,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.brandSoft,
        gap: 2,
      }}
    >
      {tabs.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (!on) router.replace(HREF[key]);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              backgroundColor: on ? theme.color.brand : 'transparent',
            }}
          >
            <Text
              variant="body"
              numberOfLines={1}
              style={{
                fontWeight: on ? '700' : '500',
                color: on ? theme.color.onBrand : theme.color.text,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}
