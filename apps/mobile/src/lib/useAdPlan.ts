import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Network from 'expo-network';
import { useQuery } from '@tanstack/react-query';
import { mergePlacements, type AdSurface } from '@waves/core';
import { adClocks } from '@/lib/adEvents';
import { adBudget } from '@/lib/adBudget';
import { adGateQuery } from '@/lib/adGateQuery';
import { adDetail, planAds, tenureBucket, type Plan, type PlanInput } from '@/lib/adPlanPure';
import { loadAdsSdk } from '@/lib/adsSdk';
import { useViewerId } from '@/lib/auth';
import { useFlagVariant } from '@/lib/flags';
import { nativeDailyCap } from '@/lib/nativeAdsPure';
import { gatherConsentSafe } from '@/lib/rewardedAd';
import { useEntitlement } from '@/lib/useEntitlement';
import { isOnline } from '@/lib/voiceEnginePure';

const NONE: Plan = {
  slots: [],
  footerBanner: false,
  inlineBanner: false,
  requestDelayMs: 0,
  budgetLeft: 0,
  sessionCap: 0,
  reason: 'ineligible',
};
// Reasons that clear with time, so the plan is re-asked every 30 s.
const WAITING = new Set(['session_grace', 'budget', 'rewarded_quiet', 'backoff']);

let appStateWired = false;
function wireAppState() {
  if (appStateWired) return;
  appStateWired = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') adBudget.foreground();
    else adBudget.background();
  });
}
let consent: Promise<boolean> | null = null;
function canRequestAds() {
  consent ??= loadAdsSdk()
    .then(gatherConsentSafe)
    .then((c) => c.canRequestAds)
    .catch(() => false);
  return consent;
}

export interface AdPlanHandle {
  surface: AdSurface;
  profileId: string | null;
  plan: Plan;
  /** When this screen last gained focus (ms); dwell counts from here. */
  focusedAt: React.MutableRefObject<number>;
  nativeCap: number | null | undefined;
  /** Live budget check at request time; the rendered plan keeps its counters from the visit start. */
  canRequest: () => boolean;
  /** The SDK reported an impression for one of this screen's slots. */
  markShown: () => void;
  detail: (slot: number) => string;
}

/**
 * Where passive ads may go on this screen. Never throws; any missing input
 * (no session, gate unread, no consent, offline) is an empty plan, so ads fail closed.
 */
export function useAdPlan(
  surface: AdSurface,
  opts: {
    rowCount?: number;
    listKey?: string;
    surfaceState?: PlanInput['surfaceState'];
  } = {},
): AdPlanHandle {
  const { rowCount = 0, listKey = '', surfaceState = {} } = opts;
  const profileId = useViewerId() ?? null;
  const { isPaid } = useEntitlement();
  const variant = useFlagVariant('ads_native');
  const gate = useQuery({
    ...adGateQuery(profileId),
    enabled: !!profileId && variant !== null && !isPaid,
  });
  const network = Network.useNetworkState();
  const [consented, setConsented] = useState(false);
  // Counters and clock as of the visit start: shown ads must not shrink the list under the reader.
  const [visitBase, setVisitBase] = useState<{ s: number; d: number; now: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const focusedAt = useRef(0);
  const visit = useRef(0);
  const live = useRef<PlanInput | null>(null);
  const status = gate.data;
  const passiveToday = status?.passiveToday ?? 0;
  // Read at call time so a gate refetch does not restart the visit.
  const passiveRef = useRef(0);
  useEffect(() => {
    passiveRef.current = passiveToday;
  });
  const capture = useCallback(() => {
    if (!profileId) return;
    const snap = adBudget.snapshot(profileId, surface, passiveRef.current);
    setVisitBase({ s: snap.impressionsSession, d: snap.impressionsToday, now: Date.now() });
  }, [profileId, surface]);
  useFocusEffect(
    useCallback(() => {
      focusedAt.current = Date.now();
      visit.current = 0;
      capture();
    }, [capture]),
  );
  const eligibleSoFar = !!profileId && variant !== null && !isPaid && status?.enabled === true;
  useEffect(() => {
    if (!profileId || !eligibleSoFar) return;
    wireAppState();
    let alive = true;
    void adBudget.hydrate(profileId).then(() => alive && capture());
    void canRequestAds().then((ok) => alive && setConsented(ok));
    return () => {
      alive = false;
    };
  }, [profileId, eligibleSoFar, capture]);

  let input: PlanInput | null = null;
  let plan = NONE;
  if (profileId && status && visitBase) {
    const config = mergePlacements(status.settings?.placements);
    adBudget.setIdleSeconds(config.session_idle_reset_seconds);
    const snap = adBudget.snapshot(profileId, surface, passiveToday);
    const serverRewarded = status.lastRewardedAt ? Date.parse(status.lastRewardedAt) : 0;
    input = {
      surface,
      rowCount,
      listKey,
      profileId,
      utcDay: new Date(now).toISOString().slice(0, 10),
      now,
      eligibility: {
        gateEnabled: status.enabled,
        bannerEligible: status.bannerEligible === true,
        isPaid,
        online: isOnline(network),
        canRequestAds: consented,
        createdAt: status.createdAt ? Date.parse(status.createdAt) : null,
        variant,
      },
      session: {
        ...snap,
        impressionsSession: visitBase.s,
        impressionsToday: visitBase.d,
        lastRewardedAt: Math.max(adClocks(profileId).lastRewardedAt, serverRewarded || 0),
      },
      surfaceState,
      config,
      rewardedQuietSeconds: status.settings?.rewarded_quiet_seconds ?? 300,
    };
    plan = planAds(input);
  }
  // Same content, same identity: screens key their list memos on it.
  const planKey = JSON.stringify(plan);
  const stable = useMemo(() => JSON.parse(planKey) as Plan, [planKey]);
  useEffect(() => {
    live.current = input;
  });
  useEffect(() => {
    if (!WAITING.has(stable.reason)) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [stable.reason]);

  const canRequest = useCallback(() => {
    const base = live.current;
    if (!base || !profileId) return false;
    const session = {
      ...adBudget.snapshot(profileId, surface, passiveRef.current),
      lastRewardedAt: base.session.lastRewardedAt,
      impressionsVisit: visit.current,
    };
    const next = planAds({ ...base, now: Date.now(), session });
    return next.reason === 'ok' && next.budgetLeft > 0;
  }, [profileId, surface]);
  const markShown = useCallback(() => {
    visit.current++;
  }, []);
  const delaySeconds = Math.round(stable.requestDelayMs / 1000);
  const detail = useCallback(
    (slot: number) =>
      adDetail({
        s: surface,
        i: slot,
        n: rowCount,
        k: adBudget.snapshot(profileId ?? '', surface).impressionsSession,
        t: tenureBucket(live.current?.eligibility.createdAt ?? null, Date.now()),
        d: delaySeconds,
        v: variant,
      }),
    [surface, rowCount, profileId, delaySeconds, variant],
  );
  return {
    surface,
    profileId,
    plan: stable,
    focusedAt,
    nativeCap: nativeDailyCap(status),
    canRequest,
    markShown,
    detail,
  };
}
