import { NotFoundBody } from '@/components/not-found-body';
import { notFoundStrings } from '@/i18n/not-found-strings';

export default function NotFound() {
  return <NotFoundBody strings={notFoundStrings} />;
}
