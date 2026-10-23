import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, Sheet, Text, useTheme } from '@waves/ui';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useEntitlement } from '@/lib/useEntitlement';
import { useFlagEnabled } from '@/lib/flags';
import { gatesBusy, readGateStatus, watchGate } from '@/lib/adGates';
import { gateAllows, gateRequired } from '@/lib/adPacingPure';
import { logAdEvent } from '@/lib/adEvents';

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
        setFailed(true);
      }
      return;
    }
    finish(gateAllows(outcome));
  };
  return {
    requireAd,
    sheet: (
      <Sheet
        visible={placement !== null && !isPaid}
        onClose={() => {
          if (!busy) finish(false);
        }}
        closeLabel={t.common.cancel}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="title">
            {placement === 'group_create_rewarded' ? t.adGates.groupTitle : t.adGates.exportTitle}
          </Text>
          <Text variant="caption" tone="muted">
            {t.adGates.body}
          </Text>
          {failed ? (
            <Text variant="caption" tone="negative">
              {t.adGates.failed}
            </Text>
          ) : null}
          {busy ? <ActivityIndicator color={theme.color.brand} /> : null}
          <Button
            label={failed ? t.rewardedAds.tryAgain : t.adGates.watch}
            variant="brand"
            fullWidth
            disabled={busy}
            onPress={() => void watch()}
          />
          <Button
            label={t.common.cancel}
            variant="ghost"
            fullWidth
            disabled={busy}
            onPress={() => finish(false)}
          />
        </View>
      </Sheet>
    ),
  };
}
