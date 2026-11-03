'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { BillForm } from '../BillForm';

function New() {
  const { groupId } = useParams<{ groupId: string }>();
  const q = useSearchParams();
  return (
    <BillForm
      groupId={groupId}
      type={q.get('type')}
      clientId={q.get('clientId')}
      inquiryId={q.get('inquiryId')}
      copyFrom={q.get('copyFrom') ?? undefined}
    />
  );
}

export default function NewBillPage() {
  return (
    <Suspense>
      <New />
    </Suspense>
  );
}
