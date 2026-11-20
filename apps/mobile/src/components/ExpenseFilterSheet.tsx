import { ScrollView, View } from 'react-native';

import { Button, Chip, Row, Sheet, Text, useTheme } from '@waves/ui';

import type { ExpenseScope } from '@/components/ExpenseFilterBar';
import { useStrings } from '@/i18n';

/**
 * The one sheet behind the Expenses Filter pill: who paid, which month, and how
 * to group. Single-select chips that apply at once; Done just closes.
 */
export function ExpenseFilterSheet({
  visible,
  onClose,
  scope,
  onScope,
  months,
  month,
  onMonth,
  byPerson,
  onByPerson,
  onReset,
  dirty,
}: {
  visible: boolean;
  onClose: () => void;
  scope: ExpenseScope;
  onScope: (next: ExpenseScope) => void;
  /** Months the ledger spans, newest first. */
  months: { key: string; label: string }[];
  month: string | null;
  onMonth: (next: string | null) => void;
  byPerson: boolean;
  onByPerson: (next: boolean) => void;
  onReset: () => void;
  dirty: boolean;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  const g = t.group;
  const group = (label: string, children: React.ReactNode) => (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {children}
    </View>
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.md }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="heading">{g.filterTitle}</Text>
        {dirty ? (
          <Text variant="caption" tone="brand" accessibilityRole="button" onPress={onReset}>
            {g.filterReset}
          </Text>
        ) : null}
      </Row>
      {group(
        g.filterShow,
        <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {(
            [
              ['all', g.filterAll],
              ['mine', g.filterMine],
              ['others', g.filterOthers],
            ] as const
          ).map(([key, label]) => (
            <Chip
              repeatable
              key={key}
              label={label}
              selected={scope === key}
              onPress={() => onScope(key)}
            />
          ))}
        </Row>,
      )}
      {group(
        g.filterMonth,
        // Horizontal scroll so many months stay on one line.
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: theme.spacing.sm }}>
            <Chip
              repeatable
              label={g.allMonths}
              selected={month === null}
              onPress={() => onMonth(null)}
            />
            {months.map((m) => (
              <Chip
                repeatable
                key={m.key}
                label={m.label}
                selected={month === m.key}
                onPress={() => onMonth(m.key)}
              />
            ))}
          </Row>
        </ScrollView>,
      )}
      {group(
        g.filterGroupBy,
        <Row style={{ gap: theme.spacing.sm }}>
          <Chip
            repeatable
            label={g.viewByDate}
            selected={!byPerson}
            onPress={() => onByPerson(false)}
          />
          <Chip
            repeatable
            label={g.viewByPerson}
            selected={byPerson}
            onPress={() => onByPerson(true)}
          />
        </Row>,
      )}
      <Button label={t.common.done} onPress={onClose} />
    </Sheet>
  );
}
