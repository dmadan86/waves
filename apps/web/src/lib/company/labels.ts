import { companyTagLabel, type CompanyEntry, type CompanyTag } from '@waves/core';

import type { WebStrings } from '@/i18n';
import type { CompanyView } from '@/lib/company/view';

/** What an entry is, in words: a tag name for an expense, else its kind. */
export function kindLabel(
  t: WebStrings['company'],
  view: CompanyView,
  entry: CompanyEntry,
): string {
  switch (entry.kind) {
    case 'expense': {
      const tags = Array.isArray(view.group?.company_tags)
        ? (view.group.company_tags as CompanyTag[])
        : [];
      return entry.category ? companyTagLabel(entry.category, tags) : t.kind.expense;
    }
    case 'allowance':
      return t.kind.bata;
    case 'advance':
      return t.kind.advance;
    case 'wages':
    case 'wage_payment':
      return t.kind.wages;
    case 'allocation':
      return t.kind.allocation;
    case 'pool_return':
      return t.kind.poolReturn;
    case 'pool_adjustment':
      return t.kind.poolAdjustment;
    case 'pool_request':
      return t.kind.poolRequest;
    case 'reimbursement':
      return entry.direction === 'employee_to_company' ? t.kind.cashReturned : t.kind.reimbursement;
  }
}
