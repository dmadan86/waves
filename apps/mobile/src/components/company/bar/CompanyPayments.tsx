/** Payments: record wages / money given, wage runs and recent payments. Records only; Waves never moves money. */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { ReceiptArt } from '@/components/company/dashboard/art';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { RecentActivity, useMoney } from '@/components/company/dashboard/parts';
import { ListRow, RowTile, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyDocs } from '@/data/companyDocuments';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { paymentRowKind, paymentsHero } from '@/lib/paymentRows';

/** A round tinted quick action with its label under it. */
function Quick({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
      </View>
      <Text variant="micro" align="center" numberOfLines={2} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function CompanyPayments({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const { canUse: canDocs } = useCompanyDocs(groupId);
  const fmt = useMoney(view.currency);
  const [tab, setTab] = useState<'tx' | 'exp'>('tx');
  const [showAllPayments, setShowAllPayments] = useState(false);
  const me = view.me;
  const teamIds = new Set(view.members.filter((m) => m.id !== me?.id).map((m) => m.id));
  const mine = view.entries.filter((e) => !e.deleted && (view.isOwner || teamIds.has(e.memberId)));
  const payments = mine.filter(
    (e) =>
      e.kind === 'wage_payment' ||
      e.kind === 'wages' ||
      e.kind === 'advance' ||
      e.kind === 'reimbursement',
  );
  const expenses = mine.filter((e) => e.kind === 'expense');
  const vendors = useCompanyVendors(groupId);
  let toVendors = 0n;
  if (view.isOwner) for (const v of vendors.balances.values()) if (v > 0n) toVendors += v;
  // Same inputs as the Overview's "Payments due" tile, so the two never disagree.
  const ids = view.members
    .filter((m) => !m.left_at && (view.isOwner || teamIds.has(m.id)))
    .map((m) => m.id);
  const { paid: totalPaid, pending: totalPending } = paymentsHero(
    view.entries,
    ids,
    todayIso(),
    toVendors,
  );
  const sorted = [...payments].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const rows = showAllPayments ? sorted : sorted.slice(0, 5);
  return (
    <SectionShell groupId={groupId} view={view} tab>
      <>
        <LinearGradient
          colors={[...theme.gradient.brand] as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flexDirection: 'row', borderRadius: theme.radius.lg, padding: theme.spacing.lg }}
        >
          {(
            [
              [t.companyVendors.paidThisMonth, totalPaid],
              [t.company.totalPending, totalPending],
            ] as const
          ).map(([label, v], i) => (
            <View
              key={label}
              accessible
              accessibilityLabel={`${label}: ${fmt(v)}`}
              style={{
                flex: 1,
                minWidth: 0,
                paddingStart: i ? theme.spacing.lg : 0,
                borderStartWidth: i ? 1 : 0,
                borderStartColor: 'rgba(255,255,255,0.4)',
              }}
            >
              <Text variant="caption" style={{ color: theme.color.onBrand }}>
                {label}
              </Text>
              <Text
                tabular
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontSize: 24, fontWeight: '800', color: theme.color.onBrand }}
              >
                {fmt(v)}
              </Text>
            </View>
          ))}
        </LinearGradient>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Quick
            icon="cash-outline"
            label={t.company.payWages}
            onPress={() => router.push(`/group/${groupId}/company-wages`)}
          />
          <Quick
            icon="receipt-outline"
            label={t.company.addExpenseAction}
            onPress={() => router.push(`/group/${groupId}/company-entry`)}
          />
          {canDocs ? (
            <Quick
              icon="document-text-outline"
              label={t.company.recordBill}
              onPress={() => router.push(`/group/${groupId}/company-bill-form?type=bill`)}
            />
          ) : null}
          <Quick
            icon="arrow-up-circle-outline"
            label={t.company.gaveMoney}
            onPress={() => router.push(`/group/${groupId}/company-entry?kind=advance`)}
          />
        </View>
        <SegmentedPills
          options={[
            { value: 'tx' as const, label: t.companyVendors.transactions },
            { value: 'exp' as const, label: t.company.expenses },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'exp' ? (
          <RecentActivity
            groupId={groupId}
            view={view}
            entries={expenses}
            limit={expenses.length}
          />
        ) : (
          <StandardCard style={{ paddingVertical: 0 }}>
            {rows.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 2, paddingVertical: 12 }}>
                <ReceiptArt />
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {t.company.paymentsNone}
                </Text>
                <Text variant="caption" tone="muted" align="center">
                  {t.company.paymentsNoneBody}
                </Text>
              </View>
            ) : (
              rows.map((e, i) => {
                const owner = view.members.find((m) => m.id === e.memberId);
                const name = owner
                  ? displayName(owner, null, null, t.misc.someone)
                  : t.misc.someone;
                const advance = e.kind === 'advance';
                const k = paymentRowKind(e);
                const title = fill(t.company[k.title], { name });
                const sub = `${showDate(e.occurredOn, locale)} · ${t.company[k.sub]}`;
                const incoming = k.incoming;
                const amount = `${incoming ? '+' : '−'}${fmt(e.amount)}`;
                return (
                  <ListRow
                    key={e.id}
                    divider={i < rows.length - 1}
                    title={title}
                    subtitle={sub}
                    accessibilityLabel={`${title}, ${sub}, ${amount}`}
                    leading={
                      <RowTile tint={theme.color.brandSoft}>
                        <Ionicons
                          name={advance ? 'arrow-up-circle-outline' : 'cash-outline'}
                          size={iconSize.md}
                          color={theme.color.brand}
                        />
                      </RowTile>
                    }
                    trailing={
                      <Text
                        tabular
                        style={{
                          fontWeight: '700',
                          color: incoming ? theme.color.positive : theme.color.negative,
                        }}
                      >
                        {amount}
                      </Text>
                    }
                    onPress={() =>
                      router.push(`/group/${groupId}/company-entry-view?entry=${e.id}`)
                    }
                  />
                );
              })
            )}
            {!showAllPayments && sorted.length > 5 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.viewAll}
                onPress={() => setShowAllPayments(true)}
                style={{ paddingVertical: theme.spacing.md, alignItems: 'center' }}
              >
                <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
                  {t.company.viewAll}
                </Text>
              </Pressable>
            ) : null}
          </StandardCard>
        )}
      </>
    </SectionShell>
  );
}
