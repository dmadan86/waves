export interface CompanyPeopleQueryInput {
  session: unknown;
  groupId: string;
  groupType: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canQueryCompanyPeople({
  session,
  groupId,
  groupType,
}: CompanyPeopleQueryInput): boolean {
  return Boolean(session) && UUID.test(groupId) && groupType === 'company';
}

export function shouldRetryCompanyPeople(failureCount: number, error: Error): boolean {
  if (/permission denied for function|invalid input syntax for type uuid/i.test(error.message))
    return false;
  return failureCount < 1;
}
