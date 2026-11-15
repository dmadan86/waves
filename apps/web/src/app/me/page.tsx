'use client';

import { AppFrame } from '@/components/AppFrame';
import { MePage } from '@/components/MePage';
import { Section } from '@/components/Shell';

export default function Page() {
  return (
    <AppFrame current={Section.Me}>{({ profileId }) => <MePage profileId={profileId} />}</AppFrame>
  );
}
