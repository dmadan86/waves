import { fill, type UiStrings } from '@/i18n';

import type { PlanItem } from './plan';

export interface PlanRenderContext {
  readonly s: UiStrings['notifications']['plan'];
  readonly hidden: boolean;
  readonly fmt: (amount: bigint) => string;
  readonly categoryName: (category: string | null) => string;
  readonly monthName: (month: string) => string;
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** The words. With amounts hidden, nothing a lock screen could show. */
export function planNudgeText(
  item: PlanItem,
  c: PlanRenderContext,
): { title: string; body: string } {
  const { s, hidden } = c;
  const title = s.title;
  switch (item.kind) {
    case 'bill': {
      if (hidden) return { title, body: s.billHidden };
      const name = item.label?.trim() || c.categoryName(item.category);
      const body = fill(s.bill, { name, amount: c.fmt(item.amount) });
      return { title, body: item.covered ? `${body} ${s.billCovered}` : body };
    }
    case 'week': {
      if (hidden) return { title, body: s.weekHidden };
      const spent = c.fmt(item.spent);
      if (item.delta === null) return { title, body: fill(s.weekPlain, { spent }) };
      return {
        title,
        body: fill(item.delta < 0n ? s.weekLess : s.weekMore, {
          spent,
          delta: c.fmt(abs(item.delta)),
        }),
      };
    }
    case 'month': {
      if (hidden) return { title, body: s.monthHidden };
      return {
        title,
        body: fill(item.leftOver < 0n ? s.monthOver : s.monthLeft, {
          month: c.monthName(item.month),
          amount: c.fmt(abs(item.leftOver)),
        }),
      };
    }
    case 'daily':
      return {
        title,
        body: hidden ? s.dailyHidden : fill(s.daily, { amount: c.fmt(item.amount) }),
      };
  }
}
