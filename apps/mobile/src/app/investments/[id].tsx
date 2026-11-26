/** One holding: what has gone in, the entries, and the actions. */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { investedSoFar, isInvestmentCategory, linkedPersonalTxnIds } from '@waves/core';
import { Button, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { OverflowMenu } from '@/components/OverflowMenu';
import { ListRow, PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { AmountSheet, RenameSheet, useWealthMoney } from '@/components/wealth/parts';
import { todayIso, useDeletePersonalRecord, usePersonalLedger } from '@/data/personal';
import { usePersonalWealth, useWealthWrites } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

type Sheet = 'in' | 'out' | 'value' | null;

function DetailBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const w = t.wealth;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = usePersonalLedger();
  const { investments } = usePersonalWealth();
  const writes = useWealthWrites();
  const del = useDeletePersonalRecord();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [today] = useState(() => todayIso());

  const inv = investments.find((i) => i.id === id);
  if (!inv) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={w.investments} />
      </Screen>
    );
  }
  const cur = inv.currency || dc;
  const rule = ledger.recurrings.find((r) => r.investmentId === inv.id);
  const entries = ledger.txns.filter(
    (x) => x.investmentId === inv.id && isInvestmentCategory(x.category),
  );
  const so = investedSoFar({ ...inv, currency: cur }, ledger.txns);
  const day = (iso: string): string =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const closed = inv.status === 'closed';
  const saveInv = (patch: Partial<typeof inv>): void =>
    void writes.saveInvestment({ ...inv, currency: cur, ...patch });

  return (
    <Screen edges={[]}>
      <PlainHeader
        title={inv.name}
        subtitle={w.types[inv.type]}
        trailing={
          <IconButton label={t.personalHome.toolMore} onPress={() => setMenu(true)}>
            <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.text} />
          </IconButton>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
      >
        <StandardCard style={{ gap: theme.spacing.sm }}>
          <Text variant="body">
            {inv.currentValue !== null && inv.valueAsOf
              ? fill(w.valueLine, {
                  invested: fmt(so, cur),
                  value: fmt(inv.currentValue, cur),
                  date: day(inv.valueAsOf),
                })
              : `${w.investedSoFar} ${fmt(so, cur)}`}
          </Text>
          {inv.currentValue !== null ? (
            <Text variant="micro" tone="muted">
              {w.currentValue}. {w.valueNote}
            </Text>
          ) : null}
        </StandardCard>

        {!closed ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label={w.addMoney} onPress={() => setSheet('in')} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={w.tookOut} variant="secondary" onPress={() => setSheet('out')} />
              </View>
            </Row>
            <Button label={w.updateValue} variant="ghost" onPress={() => setSheet('value')} />
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={w.entries} />
          <StandardCard>
            {entries.length === 0 ? (
              <Text variant="caption" tone="muted">
                {w.noEntries}
              </Text>
            ) : (
              entries.map((e, i) => (
                <ListRow
                  key={e.id}
                  title={e.kind === 'income' ? w.withdrawal : w.invested}
                  subtitle={day(e.date)}
                  amount={`${e.kind === 'income' ? '−' : ''}${fmt(e.amount, cur)}`}
                  divider={i < entries.length - 1}
                  onPress={() => router.push({ pathname: '/personal/entry', params: { id: e.id } })}
                />
              ))
            )}
          </StandardCard>
        </View>
      </ScrollView>

      <AmountSheet
        visible={sheet === 'in' || sheet === 'out'}
        title={sheet === 'out' ? w.tookOutTitle : w.addMoneyTitle}
        currency={cur}
        withDate
        saveLabel={w.save}
        onClose={() => setSheet(null)}
        onSave={(amount, date) => {
          void writes.addEntry(inv, amount, sheet === 'out' ? 'out' : 'in', date, inv.name);
          setSheet(null);
        }}
      />
      <AmountSheet
        visible={sheet === 'value'}
        title={w.updateValueTitle}
        currency={cur}
        initial={inv.currentValue ?? 0n}
        saveLabel={w.save}
        onClose={() => setSheet(null)}
        onSave={(amount) => {
          saveInv({ currentValue: amount, valueAsOf: today });
          setSheet(null);
        }}
      />
      <RenameSheet
        visible={renaming}
        title={t.personal.editDetails}
        placeholder={w.invNamePlaceholder}
        initial={inv.name}
        onClose={() => setRenaming(false)}
        onSave={(name) => {
          saveInv({ name });
          setRenaming(false);
        }}
      />
      <OverflowMenu
        visible={menu}
        onClose={() => setMenu(false)}
        items={[
          {
            icon: 'create-outline' as const,
            label: t.personal.editDetails,
            onPress: () => setRenaming(true),
          },
          ...(rule
            ? [
                {
                  icon: rule.active ? ('pause-outline' as const) : ('play-outline' as const),
                  label: rule.active ? w.pause : w.resume,
                  onPress: () => void writes.setRuleActive(rule, !rule.active),
                },
              ]
            : []),
          {
            icon: closed ? ('refresh-outline' as const) : ('checkmark-done-outline' as const),
            label: closed ? w.resume : w.close,
            onPress: () => {
              saveInv({ status: closed ? 'active' : 'closed' });
              if (rule && !closed && rule.active) void writes.setRuleActive(rule, false);
            },
          },
          {
            icon: 'trash-outline' as const,
            label: t.common.delete,
            tone: 'danger' as const,
            onPress: () => {
              void (async () => {
                const ok = await confirm({
                  title: t.common.delete,
                  body: t.personal.deleteInvestment,
                  confirmLabel: t.common.delete,
                  tone: 'danger',
                });
                if (!ok) return;
                for (const txnId of linkedPersonalTxnIds(ledger.txns, { investmentId: inv.id }))
                  await del.mutateAsync(txnId);
                if (rule) await del.mutateAsync(rule.id);
                await del.mutateAsync(inv.id);
                router.back();
              })();
            },
          },
        ]}
      />
    </Screen>
  );
}

export default function InvestmentDetailScreen() {
  return (
    <PersonalGuard>
      <DetailBody />
    </PersonalGuard>
  );
}
