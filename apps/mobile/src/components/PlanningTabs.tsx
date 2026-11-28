/**
 * The header and the Recurring | Budgets | Loans switch shared by the three
 * Planning screens, so they read as one set. Switching uses `replace`: the three
 * are siblings, so Back leaves Planning instead of walking through every tab.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { HEADER_BUTTON, HeaderBar } from '@/components/standard/HeaderBar';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { PLANNING_ROUTE, type PlanningSegment } from '@/lib/openPlanning';

type Tab = PlanningSegment;

/** The three siblings are the Planning tab, however they were opened: never a back button. */
export function PlanningHeader({
  title,
  subtitle,
  addLabel,
  onAdd,
}: {
  title: string;
  subtitle: string;
  addLabel?: string;
  onAdd?: () => void;
}) {
  const theme = useTheme();
  return (
    <HeaderBar
      hideBack
      title={title}
      subtitle={subtitle}
      action={
        onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addLabel}
            onPress={onAdd}
            style={{
              width: HEADER_BUTTON,
              height: HEADER_BUTTON,
              borderRadius: HEADER_BUTTON / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
          </Pressable>
        ) : undefined
      }
    />
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
        padding: 3,
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
              if (!on) router.replace(PLANNING_ROUTE[key]);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              backgroundColor: on ? theme.color.brand : 'transparent',
            }}
          >
            <Text
              variant="caption"
              numberOfLines={1}
              style={{
                fontSize: 14,
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
