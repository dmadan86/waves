/**
 * The full personal ledger (A48): every entry, newest first, grouped by day.
 * Tapping one opens it to edit; the header "+" adds a new one.
 *
 * A `category` param narrows it to one category — where the budget sheet's
 * "View transactions" lands, so a cap that looks wrong can be checked against
 * the entries behind it. The filter is the ledger's own: every entry filed
 * under that category, income and loan repayments included. A budget's own
 * arithmetic excludes some of those (see `personalBudgetProgress`), so this is
 * deliberately the longer list — "show me what I spent this on" is a question
 * about the ledger, and a list that quietly hid rows would be the harder thing
 * to explain.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { format, money, type PersonalTxn } from '@waves/core';
import {
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { dayHeading } from '@/data/activity';
import { usePersonalLedger } from '@/data/personal';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

/** One row of the flattened ledger: a day heading, or an entry under it. */
type LedgerItem =
  | { kind: 'day'; key: string; day: string; first: boolean }
  | { kind: 'txn'; key: string; txn: PersonalTxn };

function PersonalTransactionsScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { txns } = usePersonalLedger();
  const params = useLocalSearchParams<{ category?: string }>();
  const filter = typeof params.category === 'string' ? params.category : null;

  /**
   * Grouped by day, flattened into one recyclable list — a heading item where
   * the day changes, then its entries. The ledger already comes newest first,
   * so days do too. It was a SectionList, which keeps every row it has ever
   * rendered mounted; FlashList recycles each kind against its own pool, the
   * way the group month screen does.
   */
  const items: LedgerItem[] = useMemo(() => {
    const shown = filter ? txns.filter((txn) => txn.category === filter) : txns;
    const list: LedgerItem[] = [];
    let day: string | null = null;
    for (const txn of shown) {
      if (txn.date !== day) {
        list.push({ kind: 'day', key: `day-${txn.date}`, day: txn.date, first: day === null });
        day = txn.date;
      }
      list.push({ kind: 'txn', key: txn.id, txn });
    }
    return list;
  }, [txns, filter]);

  const labelFor = (id: string | null): string | null =>
    id ? (t.categories[id as keyof typeof t.categories] ?? null) : null;

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          {/* The category's own name is the title when one is being shown, so
              the screen says what it is a list *of* rather than leaving the
              person to wonder where the rest of their ledger went. */}
          <Text variant="heading" numberOfLines={1}>
            {(filter ? labelFor(filter) : null) ?? t.personal.transactions}
          </Text>
        </View>
        <IconButton
          label={t.personal.add}
          onPress={() => router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })}
        >
          <Ionicons name="add" size={iconSize.xxl} color={theme.color.brand} />
        </IconButton>
      </Row>

      <FlashList
        data={items}
        extraData={`${locale}|${theme.scheme}`}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        // The group ledger's settings: render well beyond the viewport so a hard
        // fling down a long ledger never outruns recycling and flashes blank rows.
        drawDistance={1500}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.personal.empty} />
          </View>
        }
        // The SectionList's `gap` fell between every cell, including the empty
        // footer cell it keeps after each day — so a row sat `sm` below the one
        // above it, a new day `2 × sm` below the last row, and the list ended on
        // one more `sm`. The same spacing, as margins, since FlashList has no gap.
        ListFooterComponent={
          items.length > 0 ? <View style={{ height: theme.spacing.sm }} /> : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'day') {
            return (
              <Text
                variant="micro"
                tone="faint"
                style={{
                  letterSpacing: 0.8,
                  marginTop: item.first ? 0 : theme.spacing.sm * 2,
                  paddingTop: theme.spacing.lg,
                  paddingBottom: theme.spacing.xs,
                }}
              >
                {/* The day as a person says it — "Today", "Yesterday", "Friday",
                    then "18 September" — not the ISO key the ledger groups by. The
                    same `dayHeading` the activity feed, the captures inbox and the
                    SMS threads use, so every dated list in the app reads alike. */}
                {dayHeading(locale, item.day)}
              </Text>
            );
          }
          const txn = item.txn;
          const income = txn.kind === 'income';
          const title = txn.note?.trim() || labelFor(txn.category) || '—';
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/personal/entry', params: { id: txn.id } })}
              style={{ marginTop: theme.spacing.sm }}
            >
              <Card
                padded={false}
                style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}
              >
                <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                  <CategoryBadge category={txn.category ?? 'other'} meta={null} size={32} />
                  <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {title}
                  </Text>
                  <Text
                    variant="body"
                    style={{
                      fontWeight: '700',
                      color: income ? theme.color.positive : theme.color.text,
                    }}
                  >
                    {income ? '+' : '−'}
                    {format(money(txn.amount, txn.currency), { locale })}
                  </Text>
                </Row>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function PersonalTransactionsScreen() {
  return (
    <PersonalGuard>
      <PersonalTransactionsScreenBody />
    </PersonalGuard>
  );
}
