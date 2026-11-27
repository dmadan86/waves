import { MoneyCalendar } from '@/components/home/MoneyCalendar';
import { PersonalGuard } from '@/components/PersonalGuard';

export default function PersonalCalendarScreen() {
  return (
    <PersonalGuard>
      <MoneyCalendar />
    </PersonalGuard>
  );
}
