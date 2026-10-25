export type CreditKind = 'voice' | 'scan' | 'export' | 'group';
export type CreditsStatus = {
  credits: number;
  walletCap: number;
  perAd: number;
  costs: Record<CreditKind, number>;
  canWatch: boolean;
  reason:
    | null
    | 'ineligible'
    | 'wallet_full'
    | 'daily_cap'
    | 'hourly_cap'
    | 'gap'
    | 'voluntary_daily'
    | 'voluntary_weekly';
  nextAt: string | null;
};
export function parseCredits(raw: unknown): CreditsStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as CreditsStatus;
  if (
    ![s.credits, s.walletCap, s.perAd].every((n) => Number.isInteger(n) && n >= 0) ||
    !s.costs ||
    !['voice', 'scan', 'export', 'group'].every(
      (k) => Number.isInteger(s.costs[k as CreditKind]) && s.costs[k as CreditKind] > 0,
    ) ||
    typeof s.canWatch !== 'boolean' ||
    ![
      null,
      'ineligible',
      'wallet_full',
      'daily_cap',
      'hourly_cap',
      'gap',
      'voluntary_daily',
      'voluntary_weekly',
    ].includes(s.reason) ||
    !(s.nextAt === null || (typeof s.nextAt === 'string' && Number.isFinite(Date.parse(s.nextAt))))
  )
    return null;
  return s;
}
export function creditButtonKey(
  s: CreditsStatus,
): 'watch' | 'tomorrow' | 'later' | 'full' | 'unavailable' {
  if (s.canWatch) return 'watch';
  if (s.reason === 'wallet_full') return 'full';
  if (s.reason === 'daily_cap' || s.reason === 'voluntary_daily') return 'tomorrow';
  if (s.reason === 'gap' || s.reason === 'hourly_cap' || s.reason === 'voluntary_weekly')
    return 'later';
  return 'unavailable';
}
export const showCreditsRow = (paid: boolean, status: CreditsStatus | null | undefined) =>
  !paid && !!status && !(status.reason === 'ineligible' && status.credits === 0);
export function parseSpend(raw: unknown): { ok: boolean; spent?: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { ok: boolean; spent?: number; reason?: string; credits?: number };
  if (s.ok === true && Number.isInteger(s.spent) && s.spent! >= 0) return s;
  if (
    s.ok === false &&
    s.reason === 'insufficient' &&
    Number.isInteger(s.credits) &&
    s.credits! >= 0
  )
    return s;
  return null;
}

export function watchBlocked(s: CreditsStatus | null): 'daily' | null {
  return s && creditButtonKey(s) === 'tomorrow' ? 'daily' : null;
}
