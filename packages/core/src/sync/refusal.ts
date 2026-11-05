export enum RefusalReason {
  CompanyGroup = 'companyGroup',
  AdminOnly = 'adminOnly',
  NotMember = 'notMember',
  Archived = 'archived',
  NotFound = 'notFound',
  Conflict = 'conflict',
  GuestExpired = 'guestExpired',
  CompanySlot = 'companySlot',
  /** A company that requires two-step login, from a session that has not verified. */
  TwoStep = 'twoStep',
  Generic = 'generic',
}

export function refusalReason(code: string): RefusalReason {
  switch (code) {
    case 'TWO_STEP_REQUIRED':
      return RefusalReason.TwoStep;
    case 'COMPANY_SLOT_REQUIRED':
      return RefusalReason.CompanySlot;
    case 'COMPANY_GROUP':
      return RefusalReason.CompanyGroup;
    case 'ADMIN_ONLY':
    case 'NOT_AN_ADMIN':
    case 'FORBIDDEN_COLUMN':
    case 'NOT_ALLOWED':
      return RefusalReason.AdminOnly;
    case 'NOT_A_MEMBER':
    case 'NOT_A_PARTY':
    case 'NOT_OWNER':
    case 'NOT_THE_AUTHOR':
    case 'NOT_THE_PAYER':
    case 'NOT_THE_PAYEE':
      return RefusalReason.NotMember;
    case 'GROUP_ARCHIVED':
    case 'GROUP_DELETED':
      return RefusalReason.Archived;
    case 'NOT_FOUND':
    case 'NO_SUCH_GROUP':
    case 'NO_SUCH_PACK':
    case 'UNKNOWN_MEMBER':
    case 'UNKNOWN_EXPENSE':
    case 'UNKNOWN_BATCH':
    case 'WRONG_GROUP':
    case 'EXPENSE_MISSING':
      return RefusalReason.NotFound;
    case 'CONFLICT_SUPERSEDED':
    case 'UNITS_CONFLICT':
    case 'VERSION_CONFLICT':
    case 'INVALID_TRANSITION':
    case 'SELECTION_CHANGED':
    case 'ENTRY_REIMBURSED':
    case 'POLICY_BLOCKED':
    case 'NOT_CANCELLABLE':
    case 'NOT_DISPUTABLE':
      return RefusalReason.Conflict;
    case 'GUEST_TRIAL_EXPIRED':
    case 'GUEST_GROUP_LIMIT':
      return RefusalReason.GuestExpired;
    default:
      return RefusalReason.Generic;
  }
}

/** Kept in the queue and retried quietly. TWO_STEP_REQUIRED clears once this device verifies. */
export function isTransientRefusal(code: string): boolean {
  return code === 'RATE_LIMITED' || code === 'CONFLICT_SUPERSEDED' || code === 'TWO_STEP_REQUIRED';
}
