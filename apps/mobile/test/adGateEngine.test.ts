import { expect, it } from 'vitest';
import {
  emptyLedger,
  parseLedger,
  touch,
  passesUsed,
  grantPass,
  decideGate,
  declineOffer,
  shouldOfferCredit,
  classifyFailure,
  shouldProbeAdHost,
  isNoFill,
  PASS_WINDOW_MS,
  FUTURE_SKEW_MS,
} from '@/lib/adGateEngine';
const placement = 'group_create_rewarded' as const;
const input = {
  paid: false,
  online: false,
  required: null,
  placement,
  localGroups: 1,
  credits: 0,
  passesUsed: 0,
};
it('caps passes at two in seven days and expires the window', () => {
  let l = grantPass(emptyLedger(), 100, placement);
  l = grantPass(l, 101, placement);
  expect(passesUsed(l, 102)).toBe(2);
  expect(decideGate({ ...input, passesUsed: passesUsed(l, 102) })).toBe('offline_capped');
  expect(passesUsed(l, 101 + PASS_WINDOW_MS)).toBe(0);
  expect(decideGate({ ...input, passesUsed: 0 })).toBe('offline_pass');
});
it('does not revive or extend passes on a backward jump', () => {
  const l = touch(grantPass(grantPass(emptyLedger(), 100), 101), 1000);
  expect(passesUsed(l, 0)).toBe(2);
  expect(grantPass(l, 0).passes.at(-1)).toBe(1000);
  const expired = touch(l, 101 + PASS_WINDOW_MS);
  expect(passesUsed(expired, 0)).toBe(0);
});
it('counts future passes, including beyond the skew allowance', () => {
  expect(passesUsed({ ...emptyLedger(), passes: [100 + FUTURE_SKEW_MS + 1] }, 100)).toBe(1);
});
it('accepts the documented offline forward-jump residual', () => {
  const l = grantPass(grantPass(emptyLedger(), 100), 101);
  expect(passesUsed(l, 102 + PASS_WINDOW_MS)).toBe(0);
  expect(passesUsed(touch(l, 102 + PASS_WINDOW_MS), 100)).toBe(0);
});
it.each([
  [{ localGroups: 0 }, 'allow'],
  [{ localGroups: 0, passesUsed: 2 }, 'allow'],
  [{ placement: 'export_rewarded' as const, localGroups: 0 }, 'offline_pass'],
  [{ online: true, required: null }, 'allow'],
  [{ online: true, required: false }, 'allow'],
  [{ online: true, required: true, credits: 6 }, 'use_credit'],
  [{ online: true, required: true }, 'ask'],
  [{ paid: true, passesUsed: 2 }, 'allow'],
] as const)('decides %j', (patch, expected) =>
  expect(decideGate({ ...input, ...patch })).toBe(expected),
);
it('parses old local credits but never uses them as the server balance', () => {
  const ledger = parseLedger({ ...emptyLedger(), credits: 1 });
  expect(ledger.credits).toBe(1);
  expect(decideGate({ ...input, online: true, required: true, credits: 0 })).toBe('ask');
});
const ready = { now: 100, online: true, paid: false, offeredThisSession: false, busy: false };
it('offers only after a pass and stops after three recent declines', () => {
  expect(shouldOfferCredit(emptyLedger(), ready)).toBe('none');
  let l = grantPass(emptyLedger(), 100, placement);
  expect(shouldOfferCredit(l, ready)).toBe('offer');
  for (let n = 0; n < 3; n++) l = declineOffer(l, 100);
  expect(shouldOfferCredit(l, ready)).toBe('none');
  expect(shouldOfferCredit(l, { ...ready, now: 100 + PASS_WINDOW_MS })).toBe('offer');
});
it.each([{ online: false }, { busy: true }, { offeredThisSession: true }])(
  'waits for %j',
  (patch) => {
    expect(
      shouldOfferCredit(grantPass(emptyLedger(), 100, placement), { ...ready, ...patch }),
    ).toBe('wait');
  },
);
it('never offers to paid users and ignores legacy local credits', () => {
  const l = grantPass(emptyLedger(), 100, placement);
  expect(shouldOfferCredit(l, { ...ready, paid: true })).toBe('none');
  expect(shouldOfferCredit({ ...l, credits: 1 }, ready)).toBe('offer');
});
const failureInput = {
  online: true,
  backendOk: true,
  adHostReachable: null,
  noFillStreak: 0,
  failure: '',
};
it.each([
  ['network-error pagead2.googlesyndication.com timeout', 'retry'],
  ['network-error googleads.g.doubleclick.net/0.0.0.0:443', 'blocked'],
  ['unable to resolve host googleads.g.doubleclick.net', 'blocked'],
  ['googleads.g.doubleclick.net [::]', 'blocked'],
  ['googleads.g.doubleclick.net :: port 443', 'blocked'],
  ['googleads.g.doubleclick.net 2001::1', 'retry'],
  ['0.0.0.0 example.com', 'retry'],
  ['network-error pagead2 fetch failed', 'retry'],
] as const)('classifies %s', (failure, expected) =>
  expect(classifyFailure({ ...failureInput, failure })).toBe(expected),
);
it('requires backend evidence and respects reachable probe veto', () => {
  const failure = 'googleads 127.0.0.1';
  expect(classifyFailure({ ...failureInput, failure, backendOk: false })).toBe('retry');
  expect(classifyFailure({ ...failureInput, failure, adHostReachable: true })).toBe('retry');
  expect(
    classifyFailure({ ...failureInput, failure: 'network-error', adHostReachable: false }),
  ).toBe('retry');
  expect(classifyFailure({ ...failureInput, failure, online: false })).toBe('offline');
});
it('allows only after three consecutive no-fills', () => {
  expect(classifyFailure({ ...failureInput, failure: 'no-fill', noFillStreak: 2 })).toBe('retry');
  expect(classifyFailure({ ...failureInput, failure: 'no-fill', noFillStreak: 3 })).toBe(
    'nofill_allow',
  );
});
it.each(['no-fill', 'TIMEOUT', 'mediation-no-fill'])('recognizes %s', (s) =>
  expect(isNoFill(s)).toBe(true),
);
it('does not treat internal-error as no-fill', () => expect(isNoFill('internal-error')).toBe(false));
it('probes only ad-host sinkholes with online backend', () => {
  const i = { online: true, backendOk: true, failure: 'network-error doubleclick.net 0.0.0.0' };
  expect(shouldProbeAdHost(i)).toBe(true);
  for (const patch of [
    { online: false },
    { backendOk: false },
    { failure: 'timeout' },
    { failure: 'network-error' },
    { failure: 'network-error [::]' },
  ])
    expect(shouldProbeAdHost({ ...i, ...patch })).toBe(false);
});
it.each([
  null,
  [],
  'bad',
  {},
  { passes: [] },
  { ...emptyLedger(), hw: Infinity },
  { ...emptyLedger(), offerPlacement: 'bad' },
])('parses garbage %j', (raw) => expect(parseLedger(raw)).toEqual(emptyLedger()));
it('clamps credit and drops nonfinite timestamps', () => {
  expect(
    parseLedger({
      ...emptyLedger(),
      credits: 3,
      passes: [1, NaN, Infinity, '2'],
      declines: [2, null],
    }),
  ).toEqual({ ...emptyLedger(), credits: 1, passes: [1], declines: [2] });
  expect(parseLedger({ ...emptyLedger(), credits: -1 }).credits).toBe(0);
});
