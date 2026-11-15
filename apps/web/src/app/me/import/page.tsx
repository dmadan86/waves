'use client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { StatementImport } from '@/components/StatementImport';

export default function Page() {
  return (
    <AppFrame current={Section.Me}>
      {({ profileId }) => <StatementImport profileId={profileId} />}
    </AppFrame>
  );
}
