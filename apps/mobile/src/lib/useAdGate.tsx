import { useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';
import { ActivityIndicator, AppState, Image, Pressable, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, IconButton, Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useEntitlement } from '@/lib/useEntitlement';
import {
  gatesBusy,
  readGateStatus,
  watchGate,
  readOwedAd,
  writeOwedAd,
  recordOwedAd,
} from '@/lib/adGates';
import { gateAllows, gateRequired } from '@/lib/adPacingPure';
import { clearAdFailure, lastFailureText, logAdEvent } from '@/lib/adEvents';
import { defaultRewardedAdDeps, probeAdHost } from '@/lib/adsSdk';
import {
  decideGate,
  classifyFailure,
  isNoFill,
  shouldProbeAdHost,
  shouldOfferOwed,
  afterOwedOutcome,
} from '@/lib/adGateEngine';
import { router } from '@/lib/navigation';

const IMG_VIDEO = require('../../assets/images/ad-video.png') as number;
const IMG_FAILED = require('../../assets/images/ad-failed.png') as number;

/** Width / height of the illustration at the top of the sheet. */
const ILL_W = 180;
const ILL_H = 112;

type Placement = 'group_create_rewarded' | 'export_rewarded';

let noFillStreak = 0;
let owedPromptedSession = false;

export function useAdGate(options?: { offerOwed?: boolean }) {
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const { t } = useStrings();
  const theme = useTheme();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [owed, setOwed] = useState(false);
  const activePlacement = useRef<Placement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const resolve = useRef<((allowed: boolean) => void) | null>(null);
  const checking = useRef(false);
  const watching = useRef(false);
  const mounted = useRef(true);
  const paid = useRef(isPaid);
  useEffect(() => {
    paid.current = isPaid;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      resolve.current?.(false);
      resolve.current = null;
    };
  }, []);

  const finish = (allowed: boolean) => {
    resolve.current?.(allowed);
    resolve.current = null;
    checking.current = false;
    watching.current = false;
    if (mounted.current) {
      activePlacement.current = null;
      setPlacement(null);
      setBusy(false);
      setFailed(false);
    }
  };

  const requireAd = async (next: Placement): Promise<boolean> => {
    if (isPaid || !viewerId) return true;
    if (checking.current || activePlacement.current || gatesBusy()) return false;
    checking.current = true;
    const online = await defaultRewardedAdDeps().isOnline();
    const status = online ? await readGateStatus(viewerId).catch(() => null) : null;
    if (!mounted.current) {
      checking.current = false;
      return false;
    }
    const required = status
      ? gateRequired({
          enabled: status.enabled,
          paid: paid.current,
          placement: next,
          createdGroups: status.createdGroups,
        })
      : null;
    const decision = decideGate({ paid: paid.current, online, required });
    if (decision !== 'ask') {
      checking.current = false;
      if (decision === 'allow_owe')
        await recordOwedAd(viewerId, next, online ? 'status' : 'offline');
      return true;
    }
    setOwed(false);
    activePlacement.current = next;
    setPlacement(next);
    return new Promise<boolean>((done) => {
      resolve.current = done;
    });
  };

  useEffect(() => {
    if (isPaid) finish(true);
  }, [isPaid]);

  useEffect(() => {
    return () => {
      resolve.current?.(false);
      resolve.current = null;
      checking.current = false;
    };
  }, [viewerId]);

  const watch = async () => {
    if (watching.current || !placement || !viewerId) return;
    watching.current = true;
    if (paid.current) {
      finish(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    clearAdFailure();
    const outcome = await watchGate(viewerId, placement, () => mounted.current && !paid.current);
    if (outcome === 'failed') {
      const online = await defaultRewardedAdDeps().isOnline();
      const failure = lastFailureText();
      const reachable = shouldProbeAdHost({ online, failure }) ? await probeAdHost() : null;
      noFillStreak = isNoFill(failure) ? noFillStreak + 1 : 0;
      const cls = classifyFailure({ online, failure, adHostReachable: reachable, noFillStreak });
      if (cls === 'offline' || cls === 'nofill_allow') {
        if (!owed)
          await recordOwedAd(viewerId, placement, cls === 'offline' ? 'offline' : 'nofill');
        noFillStreak = 0;
        finish(true);
        return;
      }
      if (cls === 'blocked') logAdEvent(viewerId, placement, 'blocked_adblock');
      watching.current = false;
      if (mounted.current) {
        setBusy(false);
        setBlocked(cls === 'blocked');
        setFailed(true);
      }
      return;
    }
    if (gateAllows(outcome)) noFillStreak = 0;
    if (owed) {
      const debt = await readOwedAd(viewerId);
      if (debt) await writeOwedAd(viewerId, afterOwedOutcome(debt, outcome));
    }
    finish(gateAllows(outcome));
  };

  const close = async () => {
    if (busy) return;
    if (owed && viewerId && placement) {
      const debt = await readOwedAd(viewerId);
      if (debt) await writeOwedAd(viewerId, afterOwedOutcome(debt, 'declined'));
      logAdEvent(viewerId, placement, 'owed_declined');
    }
    finish(false);
  };

  useEffect(() => {
    if (!options?.offerOwed || !viewerId) return;
    let disposed = false;
    let offering = false;
    const maybeOfferOwed = async () => {
      if (disposed || offering || activePlacement.current || checking.current) return;
      offering = true;
      try {
        const debt = await readOwedAd(viewerId);
        const online = await defaultRewardedAdDeps().isOnline();
        if (disposed) return;
        const verdict = shouldOfferOwed(debt, {
          now: Date.now(),
          online,
          paid: paid.current,
          promptedThisSession: owedPromptedSession,
          busy: gatesBusy() || checking.current || activePlacement.current !== null,
        });
        if (verdict === 'clear') {
          await writeOwedAd(viewerId, null);
          return;
        }
        if (verdict !== 'offer' || !debt || !mounted.current) return;
        owedPromptedSession = true;
        logAdEvent(viewerId, debt.placement, 'owed_offered');
        setOwed(true);
        activePlacement.current = debt.placement;
        setPlacement(debt.placement);
        resolve.current = null;
      } finally {
        offering = false;
      }
    };
    const offer = () => void maybeOfferOwed().catch(() => undefined);
    const timer = setTimeout(offer, 1500);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') offer();
    });
    const network = Network.addNetworkStateListener(offer);
    return () => {
      disposed = true;
      clearTimeout(timer);
      app.remove();
      network.remove();
    };
  }, [viewerId, isPaid, options?.offerOwed]);

  const goUpgrade = () => {
    finish(false);
    router.push('/settings/upgrade');
  };

  const g = t.adGates;
  const isGroup = placement === 'group_create_rewarded';

  return {
    requireAd,
    sheet: (
      <Sheet
        visible={placement !== null && !isPaid}
        onClose={() => {
          if (!busy) void close();
        }}
        closeLabel={t.common.close}
        // No Sheet title — we draw our own compact header with an X button.
        handle={false}
      >
        {/* ── Close button row ─────────────────────────────────── */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            marginBottom: theme.spacing.xs,
          }}
        >
          <IconButton
            label={t.common.close}
            onPress={() => {
              if (!busy) void close();
            }}
          >
            <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
          </IconButton>
        </View>

        {/* ── Illustration ──────────────────────────────────────── */}
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Image
            source={failed ? IMG_FAILED : IMG_VIDEO}
            style={{ width: ILL_W, height: ILL_H }}
            resizeMode="contain"
          />
        </View>

        {failed ? (
          /* ── State B: failed / blocked ────────────────────────── */
          <View>
            <Text
              variant="heading"
              accessibilityRole="header"
              style={{ textAlign: 'center', marginBottom: 4 }}
            >
              {blocked ? g.blockedTitle : g.failedTitle}
            </Text>
            <Text variant="body" tone="muted" style={{ textAlign: 'center', marginBottom: 12 }}>
              {blocked ? g.blockedBody : g.failedBody}
            </Text>

            {busy ? (
              <ActivityIndicator color={theme.color.brand} style={{ marginBottom: 8 }} />
            ) : (
              <Button
                label={isGroup ? g.groupRetryBtn : g.exportRetryBtn}
                variant="brand"
                fullWidth
                disabled={busy}
                onPress={() => void watch()}
                icon={<Ionicons name="refresh" size={iconSize.md} color={theme.color.onBrand} />}
              />
            )}

            <Pressable
              accessibilityRole="link"
              onPress={goUpgrade}
              style={{
                alignItems: 'center',
                minHeight: 44,
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
                {g.proLink}
              </Text>
            </Pressable>
          </View>
        ) : (
          /* ── State A: ask ─────────────────────────────────────── */
          <View>
            <Text
              variant="heading"
              accessibilityRole="header"
              style={{ textAlign: 'center', marginBottom: 4 }}
            >
              {g.title}
            </Text>
            <Text variant="body" tone="muted" style={{ textAlign: 'center', marginBottom: 12 }}>
              {owed ? g.owedBody : isGroup ? g.groupBody : g.exportBody}
            </Text>

            {busy ? (
              <ActivityIndicator color={theme.color.brand} style={{ marginBottom: 8 }} />
            ) : (
              <Button
                label={g.watchBtn}
                variant="brand"
                fullWidth
                disabled={busy}
                onPress={() => void watch()}
                icon={
                  <Ionicons name="play-circle" size={iconSize.md} color={theme.color.onBrand} />
                }
              />
            )}

            <Pressable
              accessibilityRole="link"
              onPress={goUpgrade}
              style={{
                alignItems: 'center',
                minHeight: 44,
                justifyContent: 'center',
                marginTop: 8,
              }}
            >
              <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
                {g.proLink}
              </Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    ),
  };
}
