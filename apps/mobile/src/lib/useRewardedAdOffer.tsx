import { readCredits } from './adCredits';
import { watchCreditAd } from './watchCreditAd';
import { watchBlocked, type CreditsStatus } from './adCreditsPure';
import { logAdEvent } from '@/lib/adEvents';
import { adSheetTaken, claimAdSheet, releaseAdSheet } from './adSheetLock';
/**
 * Offering a rewarded ad at a natural moment: `offer('voice')` when the AI voice
 * monthly limit is hit, `offer('scan')` when the receipt-scan limit is hit.
 *
 * The server decides whether to offer at all (`waves_my_ads_status`: flag, Free
 * tier, not the Pro trial, not a guest, account age, the daily cap), so a person
 * who is not eligible sees nothing and never loads ad code. If eligible, a small
 * sheet opens; the ad starts only on "Watch", and the reward is whatever the
 * server says afterwards — the app grants nothing locally.
 *
 * Render `sheet` once in the screen that calls `offer`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { RewardedAdSheet, type AdSheetState } from '@/components/RewardedAdSheet';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { defaultRewardedAdDeps, readAdsStatus } from '@/lib/adsSdk';
import { router } from '@/lib/navigation';
import { runRewardedAd } from '@/lib/rewardedAd';
import { rewardAmount, type AdKind, type AdOutcome, type AdsStatus } from '@/lib/rewardedAdsPure';
import { useEntitlement } from '@/lib/useEntitlement';
import { useToast } from '@/lib/toast';
import { createOfferGuard } from './rewardedAdOfferGuard';

/**
 * After "Not now" the same offer stays quiet for a while: someone at their limit
 * who speaks three more commands should be asked once, not three times.
 */
export const DECLINE_QUIET_MS = 10 * 60_000;
const declinedAt: Record<AdKind, number> = { voice: 0, scan: 0 };

interface OfferOptions {
  /** Explicit taps bypass the quiet period after declining an automatic offer. */
  userInitiated?: boolean;
}

export interface RewardedAdOffer {
  /** Open the sheet if the server says this person may be offered an ad now. */
  offer(kind: AdKind, options?: OfferOptions): Promise<void>;
  /** Render once, anywhere in the screen. */
  sheet: React.JSX.Element;
  canOffer(kind: AdKind, options?: OfferOptions): boolean;
  amount(kind: AdKind): number;
  creditsKnown: boolean;
}

export function useRewardedAdOffer(): RewardedAdOffer {
  const { t } = useStrings();
  const navigation = useNavigation();
  const [focused, setFocused] = useState(() => navigation.isFocused());
  const guard = useRef(createOfferGuard()).current;
  guard.setFocused(focused);
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const queryClient = useQueryClient();
  const toast = useToast();
  const eligibility = useQuery({
    queryKey: ['adsStatus', viewerId],
    queryFn: readAdsStatus,
    enabled: !!viewerId,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const wallet = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: readCredits,
    enabled: !!viewerId,
    refetchInterval: 30000,
  });
  const [creditStatus, setCreditStatus] = useState<CreditsStatus | null>(null);
  const [, setQuietTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setQuietTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [kind, setKind] = useState<AdKind>('voice');
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [state, setState] = useState<AdSheetState>({ step: 'ready' });
  const mounted = useRef(true);
  const running = useRef(false);
  const lock = useRef(Symbol('adSheet'));
  const sheetHeld = useRef(false);
  const canOffer = (next: AdKind, options?: OfferOptions): boolean =>
    focused &&
    !!viewerId &&
    !isPaid &&
    (wallet.data
      ? wallet.data.canWatch || (next === 'voice' && watchBlocked(wallet.data) === 'daily')
      : eligibility.data?.eligible === true) &&
    !visible &&
    !sheetHeld.current &&
    !adSheetTaken(lock.current) &&
    !running.current &&
    (options?.userInitiated === true || Date.now() - declinedAt[next] >= DECLINE_QUIET_MS);

  useEffect(() => {
    const sheetLock = lock.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      guard.setFocused(false);
      releaseAdSheet(sheetLock);
    };
  }, [guard]);

  useEffect(() => {
    const blur = () => {
      guard.setFocused(false);
      setFocused(false);
      setVisible(false);
    };
    const focus = () => {
      guard.setFocused(true);
      setFocused(true);
    };
    const unsubscribeBlur = navigation.addListener('blur', blur);
    const unsubscribeFocus = navigation.addListener('focus', focus);
    if (navigation.isFocused()) focus();
    else blur();
    return () => {
      unsubscribeBlur();
      unsubscribeFocus();
    };
  }, [guard, navigation]);

  const onClosed = useCallback(() => {
    sheetHeld.current = false;
    releaseAdSheet(lock.current);
  }, []);

  const offer = useCallback(
    async (next: AdKind, options?: OfferOptions): Promise<void> => {
      if (!viewerId || isPaid || running.current || sheetHeld.current || !navigation.isFocused())
        return;
      if (!options?.userInitiated && Date.now() - declinedAt[next] < DECLINE_QUIET_MS) return;
      const request = guard.begin();
      const valid = () => mounted.current && navigation.isFocused() && guard.isCurrent(request);
      const credits = await readCredits();
      if (!valid()) return;
      const current = credits ? null : await readAdsStatus().catch(() => null);
      if (!valid()) return;
      setCreditStatus(credits);
      if (
        !mounted.current ||
        (credits
          ? !credits.canWatch && !(next === 'voice' && watchBlocked(credits) === 'daily')
          : !current?.eligible)
      )
        return;
      if (!claimAdSheet(lock.current)) return;
      sheetHeld.current = true;
      setKind(next);
      setOutOfCredits(options?.userInitiated !== true);
      setStatus(current);
      setState({ step: 'ready' });
      setVisible(true);
    },
    [viewerId, isPaid, guard, navigation],
  );

  const close = useCallback(() => {
    if (running.current) return;
    // Closing without a reward (Not now, the backdrop, back) quiets this offer for a while.
    if (!(state.step === 'result' && state.done)) declinedAt[kind] = Date.now();
    setVisible(false);
  }, [kind, state]);

  const message = useCallback(
    (
      outcome: AdOutcome,
    ): { text: string; tone: 'positive' | 'info' | 'warning'; done: boolean } => {
      const a = t.rewardedAds;
      switch (outcome) {
        case 'credited':
          return {
            text: fill(kind === 'voice' ? a.creditedVoice : a.creditedScan, {
              count: creditStatus
                ? Math.floor(creditStatus.perAd / creditStatus.costs[kind])
                : status
                  ? rewardAmount(status, kind)
                  : 2,
            }),
            tone: 'positive',
            done: true,
          };
        case 'pending':
          return { text: a.pending, tone: 'info', done: true };
        case 'closed-early':
          return { text: a.closedEarly, tone: 'info', done: false };
        case 'no-fill':
          return { text: a.noFill, tone: 'info', done: false };
        case 'offline':
          return { text: a.offline, tone: 'warning', done: false };
        case 'consent':
          return { text: a.consent, tone: 'info', done: false };
        case 'unavailable':
          return { text: a.unavailable, tone: 'info', done: false };
        default:
          return { text: a.error, tone: 'warning', done: false };
      }
    },
    [kind, status, creditStatus, t.rewardedAds],
  );

  const watch = useCallback(async (): Promise<void> => {
    if (!viewerId || isPaid || running.current || !navigation.isFocused()) return;
    const request = guard.begin();
    const valid = () => mounted.current && navigation.isFocused() && guard.isCurrent(request);
    running.current = true;
    setState({ step: 'busy', confirming: false });
    try {
      const credits = await readCredits();
      if (!valid()) return;
      const before = credits ? null : await readAdsStatus().catch(() => null);
      if (!valid()) return;
      if (credits ? !credits.canWatch : !before?.eligible) {
        setVisible(false);
        void eligibility.refetch();
        return;
      }
      const outcome = credits
        ? await watchCreditAd(viewerId, kind === 'voice' ? 'voice' : 'gate', 'quota_rewarded')
        : await runRewardedAd(
            { profileId: viewerId, kind, baselineUsedToday: before?.usedToday ?? 0 },
            {
              ...defaultRewardedAdDeps(),
              onShown: () => logAdEvent(viewerId, 'quota_rewarded', 'shown'),
              onPhase: (phase) => {
                if (valid()) setState({ step: 'busy', confirming: phase === 'confirming' });
              },
            },
          );
      if (!valid()) return;
      logAdEvent(
        viewerId,
        'quota_rewarded',
        outcome === 'credited' || outcome === 'pending'
          ? 'completed'
          : outcome === 'closed-early'
            ? 'skipped'
            : 'failed',
      );
      if (outcome === 'credited' || outcome === 'pending') {
        // Whatever the screens cached about the allowance is stale now.
        void queryClient.invalidateQueries({ queryKey: ['voiceAgentEnabled'] });
        void queryClient.invalidateQueries({ queryKey: ['voiceAccess'] });
        void queryClient.invalidateQueries({ queryKey: ['adsStatus'] });
        void queryClient.invalidateQueries({ queryKey: ['credits'] });
        void queryClient.invalidateQueries({ queryKey: ['receiptCap'] });
      }
      if (!valid()) return;
      const shown = message(outcome);
      if (outcome === 'credited') toast.show(shown.text);
      setState({ step: 'result', message: shown.text, tone: shown.tone, done: shown.done });
    } catch {
      if (mounted.current) {
        setState({ step: 'result', message: t.rewardedAds.error, tone: 'warning', done: false });
      }
    } finally {
      running.current = false;
    }
  }, [
    kind,
    message,
    queryClient,
    toast,
    viewerId,
    eligibility,
    isPaid,
    guard,
    navigation,
    t.rewardedAds.error,
  ]);

  const upgrade = useCallback(() => {
    setVisible(false);
    router.push('/paywall');
  }, []);

  const sheet = useMemo(
    () => (
      <RewardedAdSheet
        visible={visible && !isPaid}
        kind={kind}
        outOfCredits={outOfCredits}
        credits={creditStatus?.credits}
        capReached={kind === 'voice' && watchBlocked(creditStatus) === 'daily'}
        amount={
          creditStatus
            ? Math.floor(creditStatus.perAd / creditStatus.costs[kind])
            : status
              ? rewardAmount(status, kind)
              : 2
        }
        state={state}
        onWatch={() => void watch()}
        onUpgrade={upgrade}
        onClose={close}
        onClosed={onClosed}
      />
    ),
    [
      close,
      onClosed,
      kind,
      outOfCredits,
      state,
      status,
      creditStatus,
      upgrade,
      visible,
      watch,
      isPaid,
    ],
  );

  return {
    offer,
    sheet,
    canOffer,
    creditsKnown: !!wallet.data,
    amount: (next) =>
      wallet.data
        ? Math.floor(wallet.data.perAd / wallet.data.costs[next])
        : eligibility.data
          ? rewardAmount(eligibility.data, next)
          : 2,
  };
}
