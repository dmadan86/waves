import type { Metadata } from 'next';

import { NotFoundBody } from '@/components/not-found-body';
import { notFoundStrings } from '@/i18n/not-found-strings';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NotFound() {
  return <NotFoundBody strings={notFoundStrings} />;
}
