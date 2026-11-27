import { BigBills } from '@/components/home/BigBills';
import { PersonalGuard } from '@/components/PersonalGuard';

export default function PersonalBigBillsScreen() {
  return (
    <PersonalGuard>
      <BigBills />
    </PersonalGuard>
  );
}
