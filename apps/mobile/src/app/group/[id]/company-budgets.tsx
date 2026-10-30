/** Company bar: budgets. */

import { useLocalSearchParams } from 'expo-router';

import { CompanyBudgets } from '@/components/company/bar/CompanyBudgets';

export default function CompanyBudgetsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyBudgets groupId={id ?? ''} />;
}
