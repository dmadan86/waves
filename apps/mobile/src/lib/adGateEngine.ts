export type Placement = 'group_create_rewarded' | 'export_rewarded';
export type AdLedger = {
  credits: 0 | 1;
  passes: number[];
  hw: number;
  declines: number[];
  offerPlacement: Placement | null;
};
export const PASS_CAP = 2;
export const PASS_WINDOW_MS = 7 * 86400000;
export const DECLINE_CAP = 3;
export const DECLINE_WINDOW_MS = PASS_WINDOW_MS;
export const FUTURE_SKEW_MS = 5 * 60000;
export const emptyLedger = (): AdLedger => ({
  credits: 0,
  passes: [],
  hw: 0,
  declines: [],
  offerPlacement: null,
});
export function parseLedger(raw: unknown): AdLedger {
  if (!raw || typeof raw !== 'object') return emptyLedger();
  const l = raw as AdLedger;
  if (
    !Array.isArray(l.passes) ||
    !Array.isArray(l.declines) ||
    typeof l.credits !== 'number' ||
    !Number.isFinite(l.credits) ||
    !Number.isFinite(l.hw) ||
    ![null, 'group_create_rewarded', 'export_rewarded'].includes(l.offerPlacement)
  )
    return emptyLedger();
  return {
    credits: l.credits >= 1 ? 1 : 0,
    passes: l.passes.filter(Number.isFinite),
    hw: Math.max(0, l.hw),
    declines: l.declines.filter(Number.isFinite),
    offerPlacement: l.offerPlacement,
  };
}
export const effectiveNow = (l: AdLedger, now: number) => Math.max(now, l.hw);
export const touch = (l: AdLedger, now: number): AdLedger => ({ ...l, hw: effectiveNow(l, now) });
export const passesUsed = (l: AdLedger, now: number) =>
  l.passes.filter((at) => at > effectiveNow(l, now) - PASS_WINDOW_MS).length;
// Future entries (including beyond FUTURE_SKEW_MS) always count as used.
// shortcut: a forward jump seen only offline can expire passes; accepted, bounded to 2 free actions without a server clock.
export function grantPass(
  l: AdLedger,
  now: number,
  placement: Placement | null = l.offerPlacement,
): AdLedger {
  const hw = effectiveNow(l, now);
  return {
    ...l,
    hw,
    passes: [...l.passes.filter((at) => at > hw - PASS_WINDOW_MS), hw],
    offerPlacement: placement,
  };
}
export function decideGate(i: {
  paid: boolean;
  online: boolean;
  required: boolean | null;
  placement: Placement;
  localGroups: number;
  credits: number;
  passesUsed: number;
}): 'allow' | 'use_credit' | 'offline_pass' | 'offline_capped' | 'ask' {
  if (i.paid) return 'allow';
  if (i.online) return i.required !== true ? 'allow' : i.credits >= 1 ? 'use_credit' : 'ask';
  if (i.placement === 'group_create_rewarded' && i.localGroups === 0) return 'allow';
  return i.passesUsed < PASS_CAP ? 'offline_pass' : 'offline_capped';
}
export const spendCredit = (l: AdLedger): AdLedger => ({ ...l, credits: 0 });
export const earnCredit = (l: AdLedger): AdLedger => ({ ...l, credits: 1, offerPlacement: null });
export function declineOffer(l: AdLedger, now: number): AdLedger {
  const hw = effectiveNow(l, now);
  return { ...l, hw, declines: [...l.declines.filter((at) => at > hw - DECLINE_WINDOW_MS), hw] };
}
export function shouldOfferCredit(
  l: AdLedger,
  i: { now: number; online: boolean; paid: boolean; offeredThisSession: boolean; busy: boolean },
): 'offer' | 'wait' | 'none' {
  if (
    i.paid ||
    !l.offerPlacement ||
    l.credits >= 1 ||
    l.declines.filter((at) => at > effectiveNow(l, i.now) - DECLINE_WINDOW_MS).length >= DECLINE_CAP
  )
    return 'none';
  return !i.online || i.offeredThisSession || i.busy ? 'wait' : 'offer';
}
export type FailureClass = 'offline' | 'blocked' | 'nofill_allow' | 'retry';
export const NOFILL_ALLOW_AFTER = 3;
export const isNoFill = (failure: string) =>
  /no-fill|timeout|internal-error|mediation-no-fill/i.test(failure);
const sinkhole = (s: string) =>
  /(?:^|[^\d.])(?:0\.0\.0\.0|127\.0\.0\.1)(?=$|[^\d.])|\[::\]|(?:^|[^\w:])::(?=$|[^\w:])|unable to resolve host/i.test(
    s,
  );
export function classifyFailure(i: {
  online: boolean;
  failure: string;
  backendOk: boolean;
  adHostReachable: boolean | null;
  noFillStreak: number;
}): FailureClass {
  if (!i.online) return 'offline';
  if (
    i.backendOk &&
    sinkhole(i.failure) &&
    /google|doubleclick|admob|gstatic|pagead|2mdn/i.test(i.failure) &&
    i.adHostReachable !== true
  )
    return 'blocked';
  return isNoFill(i.failure) && i.noFillStreak >= NOFILL_ALLOW_AFTER ? 'nofill_allow' : 'retry';
}
export function shouldProbeAdHost(i: {
  online: boolean;
  backendOk: boolean;
  failure: string;
}): boolean {
  return i.online && i.backendOk && /network-error/i.test(i.failure) && !sinkhole(i.failure);
}
