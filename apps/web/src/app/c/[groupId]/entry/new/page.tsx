'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { CompanyEntryForm } from '@/lib/company/entryForm';

export default function NewCompanyEntryPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <Suspense fallback={null}>
            <CompanyEntryForm groupId={groupId} />
          </Suspense>
        </div>
      </div>
    </CompanyFrame>
  );
}
