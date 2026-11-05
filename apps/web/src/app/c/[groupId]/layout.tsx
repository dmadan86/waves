import type { ReactNode } from 'react';

import { TwoStepGuard } from '@/components/TwoStepGuard';

export default function CompanyLayout({ children }: { children: ReactNode }) {
  return <TwoStepGuard>{children}</TwoStepGuard>;
}
