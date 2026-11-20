import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import type { ExpenseScope } from '@/components/ExpenseFilterBar';
import { useStrings } from '@/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The one sheet behind the Expenses Filter pill: who paid, which month, and how
 * to group. The choices are a draft held here; "Apply filter" sends them up and
 * closes, and closing any other way throws the draft away. The parent mounts
 * the body only while the sheet is open, so each opening starts from what is
 * applied.
 */
export function ExpenseFilterSheet(props: { visible: boolean; onClose: () => void } & BodyProps) {
  const t = useStrings().t;
  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      closeLabel={t.common.close}
      style={{ paddingHorizontal: 20 }}
    >
      {props.visible ? <Body {...props} /> : null}
    </Sheet>
  );
}

interface BodyProps {
  onClose: () => void;
  scope: ExpenseScope;
  /** Months the ledger spans, newest first. */
  months: { key: string; label: string }[];
  month: string | null;
  byPerson: boolean;
  onApply: (next: { scope: ExpenseScope; month: string | null; byPerson: boolean }) => void;
}

function Body({ onClose, scope, months, month, byPerson, onApply }: BodyProps) {
  const { t } = useStrings();
  const theme = useTheme();
  const g = t.group;
  const [draft, setDraft] = useState({ scope, month, byPerson });
  const [listOpen, setListOpen] = useState(false);
  const dirty = draft.scope !== 'all' || draft.month !== null || draft.byPerson;
  const monthLabel = months.find((m) => m.key === draft.month)?.label ?? g.allMonths;

  const disc = (name: IconName, size = 36) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name={name} size={iconSize.md} color={theme.color.brand} />
    </View>
  );
  const labelCol = (icon: IconName, label: string) => (
    <Row style={{ alignItems: 'center', gap: theme.spacing.sm, minWidth: 110 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.surface,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      </View>
      <Text style={{ fontWeight: '600' }}>{label}</Text>
    </Row>
  );
  const box = (selected: boolean) => ({
    borderWidth: 1,
    borderColor: selected ? theme.color.brand : theme.color.border,
    backgroundColor: selected ? theme.color.brandSoft : theme.color.bg,
  });

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {disc('funnel-outline')}
        <Text variant="heading" style={{ flex: 1 }}>
          {g.filterSheetTitle}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty }}
          disabled={!dirty}
          hitSlop={8}
          onPress={() => setDraft({ scope: 'all', month: null, byPerson: false })}
        >
          <Text style={{ fontWeight: '600', color: theme.color.brand, opacity: dirty ? 1 : 0.4 }}>
            {g.filterReset}
          </Text>
        </Pressable>
      </Row>

      <Text style={{ fontWeight: '600' }}>{g.filterShow}</Text>
      <Row style={{ gap: theme.spacing.sm }}>
        {(
          [
            ['all', g.filterAll, 'layers-outline'],
            ['mine', g.filterMine, 'person-outline'],
            ['others', g.filterOthers, 'people-outline'],
          ] as const
        ).map(([key, label, icon]) => {
          const on = draft.scope === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              onPress={() => setDraft((d) => ({ ...d, scope: key }))}
              style={{
                ...box(on),
                flex: 1,
                height: 68,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              {on ? (
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={theme.color.brand}
                  style={{ position: 'absolute', top: 6, end: 6 }}
                />
              ) : null}
              <Ionicons
                name={icon}
                size={iconSize.md}
                color={on ? theme.color.brand : theme.color.textMuted}
              />
              <Text variant="caption" style={{ fontWeight: on ? '700' : '500' }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {labelCol('calendar-outline', g.filterMonth)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${g.filterMonth}: ${monthLabel}`}
          accessibilityState={{ expanded: listOpen }}
          onPress={() => setListOpen((o) => !o)}
          style={{
            ...box(false),
            flex: 1,
            height: 44,
            borderRadius: theme.radius.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
          }}
        >
          <Ionicons name="calendar-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text numberOfLines={1} style={{ flex: 1 }}>
            {monthLabel}
          </Text>
          <Ionicons
            name={listOpen ? 'chevron-up' : 'chevron-down'}
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </Pressable>
      </Row>
      {listOpen ? (
        <ScrollView
          style={{ maxHeight: 176, ...box(false), borderRadius: theme.radius.md }}
          nestedScrollEnabled
        >
          {[{ key: null, label: g.allMonths }, ...months].map((m) => (
            <Pressable
              key={m.key ?? 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.month === m.key }}
              onPress={() => {
                setDraft((d) => ({ ...d, month: m.key }));
                setListOpen(false);
              }}
              style={{
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: theme.spacing.md,
              }}
            >
              <Text style={{ fontWeight: draft.month === m.key ? '700' : '400' }}>{m.label}</Text>
              {draft.month === m.key ? (
                <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={{ height: 1, backgroundColor: theme.color.border }} />

      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {labelCol('layers-outline', g.filterGroupBy)}
        {([false, true] as const).map((person) => {
          const on = draft.byPerson === person;
          return (
            <Pressable
              key={String(person)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setDraft((d) => ({ ...d, byPerson: person }))}
              style={{
                ...box(on),
                flexShrink: 1,
                height: 40,
                borderRadius: 20,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.xs,
                paddingHorizontal: theme.spacing.sm,
              }}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: 2,
                  borderColor: on ? theme.color.brand : theme.color.textMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.color.brand,
                    }}
                  />
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ fontWeight: on ? '700' : '500' }}>
                {person ? g.viewByPerson : g.viewByDate}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      <Button
        label={g.filterApply}
        onPress={() => {
          onApply(draft);
          onClose();
        }}
      />
    </View>
  );
}
