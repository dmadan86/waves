/**
 * Home's body drawn from the stored snapshot while the live data is still
 * loading. Same cards, titles, rows and empty states as the live sections, so
 * the swap to live data changes figures in place rather than reshaping the
 * screen. Nothing here is interactive beyond navigation.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Card, iconSize, Row, Text, useTheme } from '@waves/ui';

import { GroupRowView } from '@/components/home/HomeSpaces';
import { BALANCE_MASK } from '@/components/home/ScenicBalanceCard';
import { CardTitle } from '@/components/personal/PersonalHomeParts';
import { useStrings } from '@/i18n';
import type { HomeSnapshot, SnapRow } from '@/lib/homeSnapshot';
import { router } from '@/lib/navigation';

/** A Needs you row as the live `NeedRow` lays it out, with a disabled pill. */
function SnapNeedRow({ row, first, hidden }: { row: SnapRow; first: boolean; hidden: boolean }) {
  const theme = useTheme();
  const tint = row.icon === 'alert-circle-outline' ? theme.tint.coral : theme.tint.mint;
  const sub =
    row.memberLabel + (row.amountText ? ` \u00b7 ${hidden ? BALANCE_MASK : row.amountText}` : '');
  const strong = row.strong === true;
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.title}
        onPress={() => row.href && router.push(row.href as never)}
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.md,
            backgroundColor: tint.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={(row.icon ?? 'receipt-outline') as never}
            size={iconSize.md}
            color={tint.ink}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {row.title}
          </Text>
          {sub ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          paddingHorizontal: theme.spacing.md,
          height: 32,
          borderRadius: theme.radius.pill,
          justifyContent: 'center',
          backgroundColor: strong ? theme.color.brand : theme.color.brandSoft,
          opacity: 0.6,
        }}
      >
        <Text
          variant="caption"
          style={{ fontWeight: '700', color: strong ? theme.color.onBrand : theme.color.brand }}
        >
          {row.directionLabel}
        </Text>
      </View>
    </Row>
  );
}

export function HomeSnapshotView({
  snapshot,
  hidden,
  personalHidden,
  locale,
}: {
  snapshot: HomeSnapshot;
  hidden: boolean;
  /** The Personal-amounts eye (true until it has loaded). */
  personalHidden: boolean;
  locale: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.homeToday;
  const card = {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    overflow: 'hidden',
  } as const;
  const rowsOf = (rows: readonly SnapRow[], mask: (row: SnapRow) => boolean) => (
    <View style={card}>
      {rows.map((row, i) => (
        <GroupRowView
          key={row.key}
          row={row}
          locale={locale}
          hidden={mask(row)}
          divider={i > 0}
          tagTone={row.isDemo ? 'warning' : 'brand'}
        />
      ))}
    </View>
  );
  const family = snapshot.groups.filter((row) => row.family);
  const others = snapshot.groups.filter((row) => !row.family);
  const sections = [
    ...(family.length ? [{ title: h.family, rows: family }] : []),
    ...(others.length || !family.length ? [{ title: h.spaces, rows: others }] : []),
  ];
  return (
    <View style={{ paddingTop: theme.spacing.sm, gap: theme.spacing.lg }}>
      <View style={{ gap: theme.spacing.sm }}>
        {snapshot.needs.length ? (
          <CardTitle title={h.needsYou} count={snapshot.needsTotal} />
        ) : null}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {snapshot.needs.length ? (
            snapshot.needs.map((row, i) => (
              <SnapNeedRow key={row.key} row={row} first={i === 0} hidden={hidden} />
            ))
          ) : (
            <View
              accessible
              accessibilityLabel={h.nothingNeeds}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.md,
                backgroundColor: theme.color.positiveSoft,
              }}
            >
              <Ionicons name="checkmark-circle" size={iconSize.lg} color={theme.color.positive} />
              <Text style={{ fontWeight: '700', color: theme.color.positive }}>
                {h.nothingNeeds}
              </Text>
            </View>
          )}
        </Card>
      </View>
      <View style={{ gap: theme.spacing.sm }}>
        <CardTitle
          title={h.comingUp}
          action={h.seeAll}
          onAction={() => router.push('/personal/upcoming')}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={h.addReminder}
            onPress={() => router.push('/dates/edit')}
            hitSlop={8}
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
          </Pressable>
        </CardTitle>
        {snapshot.comingUp.length ? (
          rowsOf(snapshot.comingUp, () => hidden)
        ) : (
          <Text variant="caption" tone="muted">
            {t.dates.empty}
          </Text>
        )}
      </View>
      {snapshot.personal ? rowsOf([snapshot.personal], () => hidden || personalHidden) : null}
      {sections.map((section, index) => (
        <View key={section.title} style={{ gap: theme.spacing.sm }}>
          <CardTitle
            title={section.title}
            action={index === 0 ? h.seeAll : undefined}
            onAction={index === 0 ? () => router.navigate('/groups') : undefined}
          />
          {rowsOf(section.rows, () => hidden)}
        </View>
      ))}
    </View>
  );
}
