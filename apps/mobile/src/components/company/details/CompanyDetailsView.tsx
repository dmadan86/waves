import { useState } from 'react';

import { emptyDetails } from '../../../../../../packages/core/src/company/details';

import { DetailsCard } from '@/components/company/details/DetailsCard';
import { DetailsForm } from '@/components/company/details/DetailsForm';
import {
  useCompanyCard,
  useSetCompanyCard,
  useSetVendorCard,
  useVendorCard,
  useBankNotice,
} from '@/data/companyDetails';
import { useCompanyVendors } from '@/data/companyVendors';
import { useStrings } from '@/i18n';

export function DetailsScreenBody({ groupId, vendorId }: { groupId: string; vendorId?: string }) {
  const { t } = useStrings();
  const vendors = useCompanyVendors(groupId);
  const vendor = vendorId ? vendors.vendors.find((item) => item.id === vendorId) : undefined;
  const companyView = useCompanyCard(groupId);
  const vendorView = useVendorCard(groupId, vendorId ?? '');
  const view = vendorId ? vendorView : companyView;
  const companySave = useSetCompanyCard(groupId);
  const vendorSave = useSetVendorCard(groupId, vendorId ?? '');
  const notice = useBankNotice(view);
  const [editing, setEditing] = useState(false);
  const title = vendor?.name ?? t.companyDetails.title;
  return (
    <>
      <DetailsCard
        title={title}
        shareTitle={title}
        card={view.card}
        canEdit={view.canEdit}
        onEdit={() => setEditing(true)}
        notice={{ show: notice.show, onNoted: notice.markNoted }}
      />
      {/* Mounted only while editing, so each edit starts from the saved card. */}
      {editing ? (
        <DetailsForm
          visible
          onClose={() => setEditing(false)}
          initial={view.card?.values ?? emptyDetails()}
          title={title}
          onSave={(values) =>
            vendorId ? vendorSave.mutateAsync(values) : companySave.mutateAsync(values)
          }
        />
      ) : null}
    </>
  );
}
