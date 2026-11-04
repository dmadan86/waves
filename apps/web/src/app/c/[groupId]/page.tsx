'use client';

import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { CompanyHome } from '@/components/company/Home';

export default function CompanyHomePage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <CompanyHome groupId={groupId} />
    </CompanyFrame>
  );
}
