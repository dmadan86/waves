'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { CompanyEntryForm } from '@/lib/company/entryForm';
import { entryStrings as s } from '@/lib/company/entryStrings';
import { useCompanyView } from '@/lib/company/view';

function Inner({ groupId, entryId }: { groupId: string; entryId: string }) {
  const view = useCompanyView(groupId);
  const entry = view.entries.find((e) => e.id === entryId && !e.deleted);
  if (!entry) return <p>{view.ready ? s.none : s.loading}</p>;
  return <CompanyEntryForm groupId={groupId} entry={entry} />;
}

export default function EditCompanyEntryPage() {
  const { groupId, entryId } = useParams<{ groupId: string; entryId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <Suspense fallback={null}>
            <Inner groupId={groupId} entryId={entryId} />
          </Suspense>
        </div>
      </div>
    </CompanyFrame>
  );
}
