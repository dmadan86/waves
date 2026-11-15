import { describe, expect, it } from 'vitest';

import { isTransientRefusal, refusalReason, RefusalReason } from '../src/index';

const mappings: [string, RefusalReason][] = [
  ['COMPANY_GROUP', RefusalReason.CompanyGroup],
  ['ADMIN_ONLY', RefusalReason.AdminOnly],
  ['NOT_AN_ADMIN', RefusalReason.AdminOnly],
  ['FORBIDDEN_COLUMN', RefusalReason.AdminOnly],
  ['NOT_ALLOWED', RefusalReason.AdminOnly],
  ['NOT_A_MEMBER', RefusalReason.NotMember],
  ['NOT_A_PARTY', RefusalReason.NotMember],
  ['NOT_OWNER', RefusalReason.NotMember],
  ['NOT_THE_AUTHOR', RefusalReason.NotMember],
  ['NOT_THE_PAYER', RefusalReason.NotMember],
  ['NOT_THE_PAYEE', RefusalReason.NotMember],
  ['GROUP_ARCHIVED', RefusalReason.Archived],
  ['GROUP_DELETED', RefusalReason.Archived],
  ['NOT_FOUND', RefusalReason.NotFound],
  ['NO_SUCH_GROUP', RefusalReason.NotFound],
  ['NO_SUCH_PACK', RefusalReason.NotFound],
  ['UNKNOWN_MEMBER', RefusalReason.NotFound],
  ['UNKNOWN_EXPENSE', RefusalReason.NotFound],
  ['UNKNOWN_BATCH', RefusalReason.NotFound],
  ['WRONG_GROUP', RefusalReason.NotFound],
  ['EXPENSE_MISSING', RefusalReason.NotFound],
  ['CONFLICT_SUPERSEDED', RefusalReason.Conflict],
  ['UNITS_CONFLICT', RefusalReason.Conflict],
  ['VERSION_CONFLICT', RefusalReason.Conflict],
  ['INVALID_TRANSITION', RefusalReason.Conflict],
  ['NOT_CANCELLABLE', RefusalReason.Conflict],
  ['NOT_DISPUTABLE', RefusalReason.Conflict],
  ['GUEST_TRIAL_EXPIRED', RefusalReason.GuestExpired],
  ['GUEST_GROUP_LIMIT', RefusalReason.GuestExpired],
  ['UNKNOWN_CODE', RefusalReason.Generic],
  ['', RefusalReason.Generic],
  ['RATE_LIMITED', RefusalReason.Generic],
];

describe('sync refusals', () => {
  it.each(mappings)('maps %s to %s', (code, reason) => {
    expect(refusalReason(code)).toBe(reason);
  });

  it.each(['RATE_LIMITED', 'CONFLICT_SUPERSEDED'])('silently retries %s', (code) => {
    expect(isTransientRefusal(code)).toBe(true);
  });

  it.each(mappings.filter(([code]) => code !== 'CONFLICT_SUPERSEDED' && code !== 'RATE_LIMITED'))(
    'does not silently retry %s',
    (code) => {
      expect(isTransientRefusal(code)).toBe(false);
    },
  );
});
