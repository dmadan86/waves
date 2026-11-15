/** Company bar: payments. */

import { useLocalSearchParams } from 'expo-router';

import { CompanyPayments } from '@/components/company/bar/CompanyPayments';

export default function CompanyPaymentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyPayments groupId={id ?? ''} />;
}
