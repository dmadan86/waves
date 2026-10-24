import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { Button, IconButton, Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useEntitlement } from '@/lib/useEntitlement';
import { useFlagEnabled } from '@/lib/flags';
import { gatesBusy, readGateStatus, watchGate } from '@/lib/adGates';
import { gateAllows, gateRequired } from '@/lib/adPacingPure';
import { lastFailureWasBlocked, logAdEvent } from '@/lib/adEvents';
import { router } from '@/lib/navigation';

const IMG_VIDEO = require('../../assets/images/ad-video.png') as number;
const IMG_FAILED = require('../../assets/images/ad-failed.png') as number;

/** Width / height of the illustration at the top of the sheet. */
const ILL_W = 180;
const ILL_H = 112;

type Placement = 'group_create_rewarded' | 'export_rewarded';

export function useAdGate() {
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const enabled = useFlagEnabled('ads_gates');
  const { t } = useStrings();
  const theme = useTheme();
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const resolve = useRef<((allowed: boolean) => void) | null>(null);
  const checking = useRef(false);
  const watching = useRef(false);
  const mounted = useRef(true);
  const paid = useRef(isPaid);
  paid.current = isPaid;

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
      setPlacement(null);
      setBusy(false);
      setFailed(false);
    }
  };

  const requireAd = async (next: Placement): Promise<boolean> => {
    if (!enabled || isPaid || !viewerId) return true;
    if (checking.current || gatesBusy()) return false;
    checking.current = true;
    const status = await readGateStatus(viewerId).catch(() => null);
    if (!mounted.current) {
      checking.current = false;
      return false;
    }
    if (!status) {
      logAdEvent(viewerId, next, 'failed');
      checking.current = false;
      return true;
    }
    if (
      !gateRequired({
        enabled: status.enabled,
        paid: paid.current,
        placement: next,
        createdGroups: status.createdGroups,
      })
    ) {
      checking.current = false;
      return true;
    }
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
    const outcome = await watchGate(viewerId, placement, () => mounted.current && !paid.current);
    if (outcome === 'failed') {
      // Keep the sheet open: the action waits until an ad is actually watched.
      watching.current = false;
      if (mounted.current) {
        setBusy(false);
        setBlocked(lastFailureWasBlocked());
        setFailed(true);
      }
      return;
    }
    finish(gateAllows(outcome));
  };

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
          if (!busy) finish(false);
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
              if (!busy) finish(false);
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
            <Text
              variant="body"
              tone="muted"
              style={{ textAlign: 'center', marginBottom: 12 }}
            >
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
                icon={
                  <Ionicons
                    name="refresh"
                    size={iconSize.md}
                    color={theme.color.onBrand}
                  />
                }
              />
            )}

            <Pressable
              accessibilityRole="link"
              onPress={goUpgrade}
              style={{ alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 8 }}
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
            <Text
              variant="body"
              tone="muted"
              style={{ textAlign: 'center', marginBottom: 12 }}
            >
              {isGroup ? g.groupBody : g.exportBody}
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
                  <Ionicons
                    name="play-circle"
                    size={iconSize.md}
                    color={theme.color.onBrand}
                  />
                }
              />
            )}

            <Pressable
              accessibilityRole="link"
              onPress={goUpgrade}
              style={{ alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: 8 }}
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
