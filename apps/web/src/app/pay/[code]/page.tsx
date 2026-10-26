import type { Metadata } from 'next';

import { PotPay } from './PotPay';

export const metadata: Metadata = {
  title: 'Pay · Waves',
  robots: { index: false, follow: false },
};

export default async function PayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PotPay key={code} code={code} />;
}
