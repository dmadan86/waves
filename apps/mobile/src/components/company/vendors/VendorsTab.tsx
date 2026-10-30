import { useState } from 'react';
import { View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { useMoney } from '@/components/company/dashboard/parts';
import { VendorForm } from '@/components/company/vendors/forms';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyVendors } from '@/data/companyVendors';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function VendorsTab({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(groupId);
  const fmt = useMoney(view.currency);
  const [adding, setAdding] = useState(false);
  const open = (id: string) => router.push(`/group/${groupId}/company-vendor?vendorId=${id}`);
  return (
    <View style={{ gap: theme.spacing.lg }}>
      <SectionHeader title={s.title} />
      <StandardCard>
        {view.vendors.length === 0 ? (
          <Text tone="muted">{s.empty}</Text>
        ) : (
          view.vendors.map((vendor, index) => {
            const balance = view.balances.get(vendor.id) ?? 0n;
            return (
              <ListRow
                key={vendor.id}
                title={vendor.name}
                leading={<PersonAvatar name={vendor.name} size={40} />}
                subtitle={[vendor.category, vendor.phone].filter(Boolean).join(' · ')}
                amount={
                  balance > 0n
                    ? fill(s.youOwe, { amount: fmt(balance) })
                    : balance < 0n
                      ? fill(s.hasAdvance, { amount: fmt(-balance) })
                      : s.settled
                }
                onPress={() => open(vendor.id)}
                divider={index < view.vendors.length - 1}
              />
            );
          })
        )}
      </StandardCard>
      {view.canManage ? (
        <SaveButton label={s.addVendor} disabled={false} onPress={() => setAdding(true)} />
      ) : null}
      {adding ? (
        <VendorForm groupId={groupId} onClose={() => setAdding(false)} onSaved={open} />
      ) : null}
    </View>
  );
}
