'use client';

import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import {
  bankNotedKey,
  companyDetailsMutation,
  shouldShowBankNotice,
  vendorDetailsMutation,
} from '@/lib/company/details';
import { useVendorsData } from '@/lib/company/useVendors';
import { Page } from '../vendors/_components/parts';
import { DetailsSections } from './_components/DetailsSections';
import { DetailsCardView, useNoted } from './_components/DetailsCard';

/** Company details, or one vendor's (`?vendorId=`; `&mine=1` for a vendor's own). */
export default function CompanyDetailsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Suspense fallback={null}>
        <Inner groupId={groupId} />
      </Suspense>
    </CompanyFrame>
  );
}

function Inner({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors.details;
  const params = useSearchParams();
  const vendorId = params.get('vendorId') ?? undefined;
  const d = useVendorsData(groupId);
  const vendor = vendorId ? d.vendors.vendors.find((v) => v.id === vendorId) : undefined;
  const view = vendorId ? d.vendorCard(vendorId) : d.companyCard;
  const noted = useNoted(bankNotedKey(view));
  const isMine = params.get('mine') === '1' && !!vendor && vendor.memberId === d.vendors.myMemberId;
  const [editing, setEditing] = useState(false);
  const heading = vendorId ? (isMine ? s.myDetails : s.vendorDetails) : s.title;
  const title = vendor?.name ?? s.title;
  return (
    <Page title={heading}>
      {vendorId ? null : (
        <DetailsSections
          groupId={groupId}
          name={d.company.name}
          memberCount={d.company.members.filter((m) => !m.left_at).length}
          card={view.card}
          canEdit={view.canEdit}
          onEdit={() => setEditing(true)}
        />
      )}
      <DetailsCardView
        editing={editing}
        setEditing={setEditing}
        title={title}
        card={view.card}
        canEdit={view.canEdit}
        notice={{
          at: view.card?.bankChangedAt ?? null,
          show: shouldShowBankNotice(view, noted.noted),
          onNoted: noted.markNoted,
        }}
        onSave={(values) => {
          const m = vendorId
            ? vendorDetailsMutation(vendorId, values)
            : companyDetailsMutation(values);
          return d.mutate(m.kind, groupId, m.payload);
        }}
      />
    </Page>
  );
}
