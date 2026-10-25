import { readCredits, spendCredits } from './adCredits';
import { watchCreditAd } from './watchCreditAd';
import { useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';
import { ActivityIndicator, AppState, Image, Pressable, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, IconButton, Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useEntitlement } from '@/lib/useEntitlement';
import {
  gatesBusy,
  readGateStatus,
  watchGate,
  readLedger,
  updateLedger,
  localGroupCount,
} from '@/lib/adGates';
import { gateRequired } from '@/lib/adPacingPure';
import { clearAdFailure, lastFailureText, logAdEvent } from '@/lib/adEvents';
import { defaultRewardedAdDeps, probeAdHost } from '@/lib/adsSdk';
import {
  decideGate,
  classifyFailure,
  isNoFill,
  shouldProbeAdHost,
  shouldOfferCredit,
  touch,
  passesUsed,
  grantPass,
  declineOffer,
  type Placement,
} from '@/lib/adGateEngine';
import * as coordinator from '@/lib/adGateCoordinator';
import { useToast } from '@/lib/toast';
import { router } from '@/lib/navigation';

const IMG_VIDEO = require('../../assets/images/ad-video.png') as number;
const IMG_FAILED = require('../../assets/images/ad-failed.png') as number;
const ILL_W = 180;
const ILL_H = 112;

export function useAdGate(options?: { offerCredit?: boolean }) {
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const { t } = useStrings();
  const toast = useToast();
  const theme = useTheme();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [perAd, setPerAd] = useState(6);
  const [credit, setCredit] = useState(false);
  const [capped, setCapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const resolve = useRef<((allowed: boolean) => void) | null>(null);
  const lease = useRef<coordinator.Lease | null>(null);
  const mounted = useRef(true);
  const watching = useRef(false);
  const paid = useRef(isPaid);
  useEffect(() => {
    paid.current = isPaid;
  });
  const finish = (allowed: boolean) => {
    resolve.current?.(allowed);
    resolve.current = null;
    lease.current?.release();
    lease.current = null;
    watching.current = false;
    if (mounted.current) {
      setPlacement(null);
      setBusy(false);
      setFailed(false);
      setBlocked(false);
      setCapped(false);
      setCredit(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    coordinator.setProfile(viewerId);
    finish(false);
    return () => {
      mounted.current = false;
      finish(false);
    };
  }, [viewerId]);
  useEffect(() => {
    if (isPaid && placement !== null) finish(true);
  }, [isPaid, placement]);
  const valid = (l: coordinator.Lease) => {
    if (mounted.current && l.valid()) return true;
    l.release();
    return false;
  };
  const open = (next: Placement, isCapped = false) => {
    setCredit(false);
    setCapped(isCapped);
    setPlacement(next);
    return new Promise<boolean>((done) => {
      resolve.current = done;
    });
  };
  const requireAdInner = async (next: Placement): Promise<boolean> => {
    if (paid.current || !viewerId) return true;
    const l = coordinator.acquire(viewerId, 'gate');
    if (!l) return false;
    lease.current = l;
    const online = await defaultRewardedAdDeps().isOnline();
    if (!valid(l)) return false;
    const status = online ? await readGateStatus(viewerId).catch(() => null) : null;
    if (!valid(l)) return false;
    const now = Date.now();
    const ledger = await updateLedger(viewerId, (value) => (l.valid() ? touch(value, now) : value));
    if (!valid(l)) return false;
    const required = status
      ? gateRequired({
          enabled: status.enabled,
          paid: paid.current,
          placement: next,
          createdGroups: status.createdGroups,
        })
      : null;
    const decision = decideGate({
      paid: paid.current,
      online,
      required,
      placement: next,
      localGroups: localGroupCount(),
      credits:
        typeof status?.credits === 'number' && Number.isFinite(status.credits) ? status.credits : 0,
      cost: status?.costs?.[next === 'export_rewarded' ? 'export' : 'group'] ?? 6,
      passesUsed: passesUsed(ledger, now),
    });
    setBalance(typeof status?.credits === 'number' ? status.credits : null);
    setPerAd(status?.perAd ?? 6);
    if (decision === 'use_credit') {
      const result = await spendCredits(next === 'export_rewarded' ? 'export' : 'group');
      if (!valid(l)) return false;
      if (!result) {
        logAdEvent(viewerId, next, 'offline_allowed', 'status');
        finish(true);
        return true;
      }
      if (!result.ok) return open(next);
      if (result.spent)
        toast.show(
          fill(result.spent === 1 ? t.credits.usedOne : t.credits.used, { n: result.spent }),
        );
      logAdEvent(viewerId, next, 'credit_used');
    }
    if (decision === 'offline_pass') {
      await updateLedger(viewerId, (value) =>
        l.valid() && !paid.current ? grantPass(value, now, next) : value,
      );
      if (!valid(l)) return false;
      logAdEvent(viewerId, next, 'offline_allowed', 'pass');
    }
    if (
      paid.current ||
      decision === 'allow' ||
      decision === 'use_credit' ||
      decision === 'offline_pass'
    ) {
      if (online && !status && !paid.current)
        logAdEvent(viewerId, next, 'offline_allowed', 'status');
      finish(true);
      return true;
    }
    if (decision === 'offline_capped') logAdEvent(viewerId, next, 'offline_capped');
    return open(next, decision === 'offline_capped');
  };
  // Any unexpected throw fails open and never leaks the lease.
  const requireAd = async (next: Placement): Promise<boolean> => {
    try {
      return await requireAdInner(next);
    } catch {
      lease.current?.release();
      lease.current = null;
      return true;
    }
  };
  const watch = async () => {
    const l = lease.current;
    if (watching.current || !placement || !viewerId || !l || !valid(l)) return;
    if (paid.current) {
      finish(true);
      return;
    }
    watching.current = true;
    setBusy(true);
    setFailed(false);
    setBlocked(false);
    clearAdFailure();
    const outcome = credit
      ? await watchCreditAd(viewerId, 'offer', 'credit_offer')
      : await watchGate(viewerId, placement, () => mounted.current && l.valid() && !paid.current);
    if (!valid(l)) return;
    if (paid.current) {
      finish(true);
      return;
    }
    if (credit) {
      if (outcome === 'credited') {
        await updateLedger(viewerId, (value) =>
          l.valid() ? { ...value, offerPlacement: null } : value,
        );
        if (!valid(l)) return;
        coordinator.resetNoFill(viewerId);
      }
      if (outcome !== 'failed') {
        finish(false);
        return;
      }
      watching.current = false;
      setBusy(false);
      setFailed(true);
      return;
    }
    if (outcome === 'failed') {
      const online = await defaultRewardedAdDeps().isOnline();
      if (!valid(l)) return;
      const failure = lastFailureText();
      const reachable = shouldProbeAdHost({ online, backendOk: true, failure })
        ? await probeAdHost()
        : null;
      if (!valid(l)) return;
      const streak = isNoFill(failure)
        ? coordinator.bumpNoFill(viewerId)
        : (coordinator.resetNoFill(viewerId), 0);
      const cls = classifyFailure({
        online,
        backendOk: true,
        failure,
        adHostReachable: reachable,
        noFillStreak: streak,
      });
      if (cls === 'offline') {
        const now = Date.now();
        const ledger = await updateLedger(viewerId, (value) =>
          l.valid() ? touch(value, now) : value,
        );
        if (!valid(l)) return;
        const decision = decideGate({
          paid: paid.current,
          online: false,
          required: true,
          placement,
          localGroups: localGroupCount(),
          credits: 0,
          passesUsed: passesUsed(ledger, now),
        });
        if (decision === 'offline_pass') {
          await updateLedger(viewerId, (value) =>
            l.valid() && !paid.current ? grantPass(value, now, placement) : value,
          );
          if (!valid(l)) return;
          logAdEvent(viewerId, placement, 'offline_allowed', 'pass');
        }
        if (decision !== 'offline_capped') {
          finish(true);
          return;
        }
        logAdEvent(viewerId, placement, 'offline_capped');
        watching.current = false;
        setBusy(false);
        setCapped(true);
        return;
      }
      if (cls === 'nofill_allow') {
        coordinator.resetNoFill(viewerId);
        finish(true);
        return;
      }
      if (cls === 'blocked') logAdEvent(viewerId, placement, 'blocked_adblock');
      watching.current = false;
      setBusy(false);
      setBlocked(cls === 'blocked');
      setFailed(true);
      return;
    }
    coordinator.resetNoFill(viewerId);
    finish(outcome === 'completed' || outcome === 'bypass');
  };
  const close = async () => {
    const l = lease.current;
    if (busy || !l || !valid(l)) return;
    if (credit && viewerId && placement) {
      await updateLedger(viewerId, (value) =>
        l.valid() ? declineOffer(value, Date.now()) : value,
      );
      if (!valid(l)) return;
      logAdEvent(viewerId, placement, 'owed_declined');
    }
    finish(false);
  };
  useEffect(() => {
    if (!options?.offerCredit || !viewerId) return;
    let disposed = false;
    let checking = false;
    const maybeOffer = async () => {
      if (disposed || checking) return;
      checking = true;
      let owner: coordinator.Lease | null = null;
      try {
        const ledger = await readLedger(viewerId);
        if (disposed) return;
        const online = await defaultRewardedAdDeps().isOnline();
        if (
          disposed ||
          shouldOfferCredit(ledger, {
            now: Date.now(),
            online,
            paid: paid.current,
            offeredThisSession: coordinator.wasOffered(viewerId),
            busy: coordinator.isBusy() || gatesBusy(),
          }) !== 'offer'
        )
          return;
        owner = coordinator.acquire(viewerId, 'credit');
        if (!owner) return;
        const status = await readGateStatus(viewerId).catch(() => null);
        const wallet = await readCredits();
        if (!wallet?.canWatch) return;
        setBalance(wallet.credits);
        setPerAd(wallet.perAd);
        if (disposed || !valid(owner) || paid.current || !status?.enabled || !ledger.offerPlacement)
          return;
        lease.current = owner;
        coordinator.markOffered(viewerId);
        logAdEvent(viewerId, ledger.offerPlacement, 'owed_offered');
        setCredit(true);
        setCapped(false);
        setPlacement(ledger.offerPlacement);
        owner = null;
      } finally {
        owner?.release();
        checking = false;
      }
    };
    const offer = () => {
      void maybeOffer().catch(() => undefined);
    };
    const timer = setTimeout(offer, 1500);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') offer();
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) offer();
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      app.remove();
      network.remove();
    };
  }, [viewerId, isPaid, options?.offerCredit]);
  const goUpgrade = () => {
    if (busy) return;
    void close();
    router.push('/settings/upgrade');
  };
  const g = t.adGates;
  const isGroup = placement === 'group_create_rewarded';

  return {
    requireAd,
    sheet: (
      <Sheet
        visible={placement !== null && !isPaid}
        onClose={() => void close()}
        closeLabel={t.common.close}
        handle={false}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            marginBottom: theme.spacing.xs,
          }}
        >
          <IconButton label={t.common.close} onPress={() => void close()}>
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </IconButton>
        </View>
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Image
            source={failed ? IMG_FAILED : IMG_VIDEO}
            style={{ width: ILL_W, height: ILL_H }}
            resizeMode="contain"
          />
        </View>
        <Text
          variant="heading"
          accessibilityRole="header"
          style={{ textAlign: 'center', marginBottom: 4 }}
        >
          {capped
            ? isGroup
              ? g.offlineCappedGroup
              : g.offlineCappedExport
            : failed
              ? blocked
                ? g.blockedTitle
                : g.failedTitle
              : credit
                ? g.creditOfferTitle
                : g.title}
        </Text>
        {!capped && (
          <Text variant="body" tone="muted" style={{ textAlign: 'center', marginBottom: 12 }}>
            {failed
              ? blocked
                ? g.blockedBody
                : g.failedBody
              : credit
                ? fill(t.credits.offer, { n: perAd })
                : isGroup
                  ? g.groupBody
                  : g.exportBody}
          </Text>
        )}
        {balance !== null && (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center', marginBottom: 8 }}>
            {fill(t.credits.balance, { n: balance })}
          </Text>
        )}
        {busy ? (
          <ActivityIndicator color={theme.color.brand} style={{ marginBottom: 8 }} />
        ) : (
          <Button
            label={
              capped
                ? t.common.ok
                : failed
                  ? isGroup
                    ? g.groupRetryBtn
                    : g.exportRetryBtn
                  : g.watchBtn
            }
            variant="brand"
            fullWidth
            onPress={() => (capped ? finish(false) : void watch())}
            icon={
              capped ? undefined : (
                <Ionicons
                  name={failed ? 'refresh' : 'play-circle'}
                  size={iconSize.md}
                  color={theme.color.onBrand}
                />
              )
            }
          />
        )}
        {!capped && (
          <Pressable
            accessibilityRole="link"
            onPress={goUpgrade}
            style={{ alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 8 }}
          >
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {g.proLink}
            </Text>
          </Pressable>
        )}
      </Sheet>
    ),
  };
}
