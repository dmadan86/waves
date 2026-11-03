'use client';

import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';

// Slice E replaces this stub.
export default function CompanySettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { t } = useStrings();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <h1>{t.company.settings.title}</h1>
          </div>
          <p>{t.company.settings.comingSoon}</p>
        </div>
      </div>
    </CompanyFrame>
  );
}
