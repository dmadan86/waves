import { describe, expect, it } from 'vitest';

import { canQueryCompanyPeople, shouldRetryCompanyPeople } from '../src/data/companyPeopleQuery';

const groupId = '550e8400-e29b-41d4-a716-446655440000';

describe('company people query guards', () => {
  it('requires a session, a UUID group id, and a company group', () => {
    expect(canQueryCompanyPeople({ session: {}, groupId, groupType: 'company' })).toBe(true);
    expect(canQueryCompanyPeople({ session: null, groupId, groupType: 'company' })).toBe(false);
    expect(canQueryCompanyPeople({ session: {}, groupId: '', groupType: 'company' })).toBe(false);
    expect(
      canQueryCompanyPeople({ session: {}, groupId: 'not-a-uuid', groupType: 'company' }),
    ).toBe(false);
    expect(canQueryCompanyPeople({ session: {}, groupId, groupType: 'trip' })).toBe(false);
  });

  it('skips retries for permission and UUID input failures and retries other errors once', () => {
    expect(
      shouldRetryCompanyPeople(0, new Error('permission denied for function waves_company_people')),
    ).toBe(false);
    expect(shouldRetryCompanyPeople(0, new Error('invalid input syntax for type uuid: ""'))).toBe(
      false,
    );
    expect(shouldRetryCompanyPeople(0, new Error('temporary failure'))).toBe(true);
    expect(shouldRetryCompanyPeople(1, new Error('temporary failure'))).toBe(false);
  });
});
