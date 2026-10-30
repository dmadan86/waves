import { useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Screen, Text, useTheme } from '@waves/ui';

import { DashBody, DashHeader, useMoney } from '@/components/company/dashboard/parts';
import { VendorLineForm } from '@/components/company/vendors/forms';
import { BankChangedNotice } from '@/components/company/details/DetailsCard';
import { useCompanyCard, useBankNotice } from '@/data/companyDetails';
import { VendorHistory } from '@/components/company/vendors/VendorHistory';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useBottomClearance } from '@/lib/clearance';

export function VendorHome({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const s = t.companyVendors;
  const company = useCompanyEntries(groupId);
  const view = useCompanyVendors(groupId);
  const fmt = useMoney(view.currency);
  const [adding, setAdding] = useState(false);
  const vendor = view.vendors.find((v) => v.memberId === view.myMemberId);
  const companyCard = useCompanyCard(groupId);
  const bankNotice = useBankNotice(companyCard);
  const balance = vendor ? (view.balances.get(vendor.id) ?? 0n) : 0n;
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}>
        <DashHeader
          groupId={groupId}
          view={company}
          subtitle={vendor?.name ?? s.title}
          showGear={false}
        />
        <DashBody>
          {vendor ? (
            <>
              <StandardCard style={{ gap: theme.spacing.lg }}>
                <Text variant="title">
                  {fill(
                    balance > 0n ? s.companyOwes : balance < 0n ? s.yourAdvance : s.allSettled,
                    { amount: fmt(balance < 0n ? -balance : balance) },
                  )}
                </Text>
                <Button label={s.addBill} onPress={() => setAdding(true)} />
              </StandardCard>
              {bankNotice.show ? (
                <BankChangedNotice
                  view={{ show: bankNotice.show, at: companyCard.card?.bankChangedAt }}
                  onNoted={bankNotice.markNoted}
                />
              ) : null}
              <StandardCard>
                <ListRow
                  title={t.companyDetails.title}
                  onPress={() => router.push(`/group/${groupId}/company-details`)}
                  divider
                />
                <ListRow
                  title={t.companyDetails.myDetails}
                  onPress={() =>
                    router.push(`/group/${groupId}/company-details?vendorId=${vendor.id}&mine=1`)
                  }
                />
              </StandardCard>
              <SectionHeader title={s.history} />
              <VendorHistory
                groupId={groupId}
                lines={view.lines.filter((l) => l.vendorId === vendor.id)}
                vendorView
              />
            </>
          ) : (
            <Text tone="muted">{s.notFound}</Text>
          )}
        </DashBody>
      </ScrollView>
      {adding && vendor ? (
        <VendorLineForm
          groupId={groupId}
          vendorId={vendor.id}
          currency={view.currency}
          submitted
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Screen>
  );
}
