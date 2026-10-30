import Ionicons from '@expo/vector-icons/Ionicons';
import { format, money, type CurrencyCode } from '@waves/core';
import { useTheme } from '@waves/ui';

import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useComingUp } from '@/data/companyOverview';
import { useStrings, fill } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

export function ComingUpCard({ groupId, currency }: { groupId: string; currency: string }) {
  const rows = useComingUp(groupId);
  const theme = useTheme();
  const { t, locale } = useStrings();
  if (!rows.length) return null;
  return (
    <>
      <SectionHeader title={t.company.overviewComingUp} />
      <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
        {rows.map((row, i) => (
          <ListRow
            key={row.key}
            leading={
              <Ionicons
                name={row.kind === 'recurring' ? 'repeat-outline' : 'cash-outline'}
                size={20}
                color={theme.color.brand}
              />
            }
            title={row.title}
            subtitle={
              row.kind === 'receivable'
                ? t.company.overviewToCollect
                : row.date
                  ? fill(t.company.overviewDueOn, { date: showDate(row.date, locale) })
                  : undefined
            }
            amount={format(money(row.amountMinor, currency as CurrencyCode), { locale })}
            onPress={
              row.kind === 'receivable'
                ? () => router.push(`/group/${groupId}/company-bills`)
                : undefined
            }
            divider={i < rows.length - 1}
          />
        ))}
      </StandardCard>
    </>
  );
}
