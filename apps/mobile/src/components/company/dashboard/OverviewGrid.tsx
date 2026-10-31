/**
 * The customizable Overview: `OverviewCards` draws the person's cards in their order (a long press anywhere
 * on them opens the editor), `LayoutEditor` is edit mode: drag a row by its handle, tap − to hide a card,
 * tap + to bring a hidden one back. The cards themselves are untouched; this only orders and hides them.
 */

import { Fragment, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  NestableDraggableFlatList,
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { iconSize, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { hapticLight, hapticSelect } from '@/lib/assistantHaptics';
import {
  hideCard,
  moveCard,
  showCard,
  withOrder,
  type CardId,
  type OverviewLayout,
  type OverviewRole,
} from '@/lib/overviewLayout';

export type CardNodes = Partial<Record<CardId, ReactNode>>;

export function useCardNames(): Record<CardId, string> {
  const { t } = useStrings();
  const c = t.company;
  return {
    attendance: c.ovCardAttendance,
    money: c.ovCardMoney,
    attention: c.ovCardAttention,
    upcoming: c.ovCardUpcoming,
    activity: c.ovCardActivity,
    budget: c.ovCardBudget,
    stats: c.ovCardStats,
    quick: c.ovCardQuick,
    workday: c.ovCardWorkday,
    team: c.ovCardTeam,
  };
}

export function OverviewCards({
  layout,
  cards,
  onEdit,
}: {
  layout: OverviewLayout;
  cards: CardNodes;
  onEdit: () => void;
}) {
  const theme = useTheme();
  // One long press for the whole column (not one per card), so a card that draws nothing leaves no gap.
  const press = Gesture.LongPress()
    .minDuration(700)
    .runOnJS(true)
    .onStart(() => {
      hapticLight();
      onEdit();
    });
  return (
    <GestureDetector gesture={press}>
      <View style={{ gap: theme.spacing.md }}>
        {layout.order.map((id) => (
          <Fragment key={id}>{cards[id]}</Fragment>
        ))}
      </View>
    </GestureDetector>
  );
}

function Round({
  icon,
  color,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={icon} size={iconSize.lg} color={color} />
    </Pressable>
  );
}

export function LayoutEditor({
  role,
  layout,
  onChange,
  onReset,
  onDone,
}: {
  role: OverviewRole;
  layout: OverviewLayout;
  onChange: (next: OverviewLayout) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const names = useCardNames();
  const first = layout.order[0]!;
  const rest = layout.order.slice(1);
  const row = {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingStart: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  } as const;

  const renderItem = ({ item, drag, isActive }: RenderItemParams<CardId>) => (
    <ScaleDecorator>
      <View
        accessible
        accessibilityLabel={names[item]}
        accessibilityActions={[
          { name: 'moveUp', label: t.company.ovMoveUp },
          { name: 'moveDown', label: t.company.ovMoveDown },
          { name: 'hide', label: fill(t.company.ovHideCard, { name: names[item] }) },
        ]}
        onAccessibilityAction={(e) => {
          const a = e.nativeEvent.actionName;
          if (a === 'moveUp') onChange(moveCard(role, layout, item, -1));
          else if (a === 'moveDown') onChange(moveCard(role, layout, item, 1));
          else if (a === 'hide') onChange(hideCard(role, layout, item));
        }}
        style={[row, { marginBottom: 8, opacity: isActive ? 0.9 : 1 }]}
      >
        <Round
          icon="remove-circle"
          color={theme.color.negative}
          label={fill(t.company.ovHideCard, { name: names[item] })}
          onPress={() => onChange(hideCard(role, layout, item))}
        />
        <Text style={{ flex: 1, fontWeight: '600' }}>{names[item]}</Text>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLongPress={drag}
          delayLongPress={150}
          disabled={isActive}
          hitSlop={8}
          style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="reorder-three" size={iconSize.lg} color={theme.color.textMuted} />
        </Pressable>
      </View>
    </ScaleDecorator>
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="title" accessibilityRole="header" style={{ flex: 1, fontSize: 18 }}>
          {t.company.ovEditLayout}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onReset}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
        >
          <Text style={{ color: theme.color.brand, fontWeight: '600' }}>
            {t.company.ovResetLayout}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={{
            minHeight: 44,
            paddingHorizontal: 18,
            borderRadius: 14,
            justifyContent: 'center',
            backgroundColor: theme.color.brand,
          }}
        >
          <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>{t.common.done}</Text>
        </Pressable>
      </View>
      <Text variant="caption" tone="muted">
        {t.company.ovLayoutHint}
      </Text>

      <View style={[row, { paddingEnd: 16, gap: 8, opacity: 0.7 }]}>
        <View style={{ width: 36, alignItems: 'center' }}>
          <Ionicons name="lock-closed" size={iconSize.base} color={theme.color.textMuted} />
        </View>
        <Text style={{ flex: 1, fontWeight: '600' }}>{names[first]}</Text>
        <Text variant="caption" tone="muted">
          {t.company.ovAlwaysFirst}
        </Text>
      </View>

      <NestableDraggableFlatList
        data={rest}
        keyExtractor={(id) => id}
        renderItem={renderItem}
        onDragBegin={hapticSelect}
        onDragEnd={({ data }) => {
          hapticLight();
          onChange(withOrder(role, layout, data));
        }}
        containerStyle={{ marginTop: 0 }}
      />

      {layout.hidden.length > 0 ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text variant="caption" tone="muted" accessibilityRole="header">
            {t.company.ovHiddenCards}
          </Text>
          {layout.hidden.map((id) => (
            <View key={id} style={row}>
              <Round
                icon="add-circle"
                color={theme.color.brand}
                label={fill(t.company.ovAddCard, { name: names[id] })}
                onPress={() => onChange(showCard(layout, id))}
              />
              <Text style={{ flex: 1 }} tone="muted">
                {names[id]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
