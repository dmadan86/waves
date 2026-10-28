/** The date ranges a company statement or summary can be cut to. */

export type CompanyPeriod = 'month' | 'last' | 'all';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Inclusive yyyy-mm-dd bounds for a period, relative to `today` (yyyy-mm-dd). */
export function periodRange(period: CompanyPeriod, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (period === 'all') return { from: '0000-01-01', to: '9999-12-31' };
  const target = period === 'month' ? { y: year, m: month } : month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const last = new Date(Date.UTC(target.y, target.m, 0)).getUTCDate();
  return { from: `${target.y}-${pad(target.m)}-01`, to: `${target.y}-${pad(target.m)}-${pad(last)}` };
}
