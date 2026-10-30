import type { MemberRow } from './types';

type Person = Pick<MemberRow, 'id' | 'role' | 'manager_id' | 'left_at'>;
export function employmentPeople<T extends Person>(
  members: readonly T[],
  notEmployed: boolean,
): T[] {
  return members.filter((member) => isNotEmployed(member) === notEmployed);
}
export function isEmploymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isNotEmployed(member: Person): boolean {
  return !!member.left_at && (member.role === 'member' || member.role === 'manager');
}
export function canSetEmployment(
  viewer: Person | null,
  member: Person,
  suspended: boolean,
): boolean {
  if (
    suspended ||
    !viewer ||
    viewer.left_at ||
    viewer.id === member.id ||
    (member.role !== 'member' && member.role !== 'manager')
  )
    return false;
  return (
    viewer.role === 'admin' ||
    (viewer.role === 'manager' && member.role === 'member' && member.manager_id === viewer.id)
  );
}
export function employmentErrorKey(
  error: unknown,
):
  | 'employmentPool'
  | 'employmentIdTaken'
  | 'employmentBlocked'
  | 'employmentDenied'
  | 'employmentFailed' {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('MANAGER_HAS_POOL')) return 'employmentPool';
  if (message.includes('EMPLOYEE_ID_TAKEN')) return 'employmentIdTaken';
  if (message.includes('COMPANY_BLOCKED')) return 'employmentBlocked';
  if (message.includes('NOT_ALLOWED')) return 'employmentDenied';
  return 'employmentFailed';
}
