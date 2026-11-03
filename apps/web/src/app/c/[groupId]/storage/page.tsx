'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { fill } from '@/i18n';
import { formatBytes, parseStorageUsage, storagePercent, type CompanyStorageUsage } from '@/lib/company/storage';
import { useCompanyView } from '@/lib/company/view';
import { supabase } from '@/lib/waves';

export default function CompanyStoragePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const view = useCompanyView(groupId);
  const { t, locale } = useCompanyText(view.currency);
  const c = t.company.docs.storage;
  const [usage, setUsage] = useState<CompanyStorageUsage | null>(null);
  const [failed, setFailed] = useState(false);

  // The server answers owners and managers only.
  useEffect(() => {
    if (!view.isAdmin) return;
    let live = true;
    void supabase.rpc('waves_company_storage_usage', { p_group_id: groupId }).then(({ data, error }) => {
      if (!live) return;
      if (error) setFailed(true);
      else setUsage(parseStorageUsage(data));
    });
    return () => {
      live = false;
    };
  }, [groupId, view.isAdmin]);

  const percent = usage ? storagePercent(usage) : 0;
  return (
    <CompanyPage groupId={groupId} title={c.title}>
      {!view.isAdmin ? (
        <p className="muted">{t.company.docs.noAccess}</p>
      ) : failed && !usage ? (
        <p className="error">{c.loading}</p>
      ) : !usage ? (
        <p className="faint">{t.company.docs.loading}</p>
      ) : (
        <section className="panel">
          <p>
            <b>
              {fill(c.usedOfQuota, {
                used: formatBytes(usage.usedBytes, locale),
                quota: formatBytes(usage.quotaBytes, locale),
              })}
            </b>
          </p>
          <progress value={percent} max={100} aria-label={fill(c.percentUsed, { percent: String(percent) })} />
          <p className="faint">{fill(c.percentUsed, { percent: String(percent) })}</p>
          {usage.usedBytes >= usage.quotaBytes ? <p className="error">{c.full}</p> : null}
          <p className="muted">{c.note}</p>
          <p>{c.buyInApp}</p>
        </section>
      )}
    </CompanyPage>
  );
}
