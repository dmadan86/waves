/**
 * The soft ask for push, before the hard one — and again, while it is off.
 *
 * iOS gives an app exactly one shot at the system permission dialog — a "no"
 * there is close to permanent — so the kind thing is to ask in our own words
 * first, and only raise the real dialog for somebody who already said yes to
 * this. Android 13+ has the same one-shot shape. So a small centred card:
 * why we would notify, and Turn on / Not now.
 *
 * A person without push is missing what their friends do and never learns it,
 * so the card comes back on Home while permission is not granted: two days
 * after the last "Not now" for the first three, weekly after that
 * (`pushPromptPolicy`). Joining a group by invite asks too, in that group's
 * words. Once the system will not show its dialog any more, the button opens
 * the app's system settings instead of doing nothing. Coming back to the app
 * with permission newly granted registers the token at once.
 *
 * A simulator reports its permission as denied, so this never appears there.
 */

import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSegments } from 'expo-router';
import { AppState, Linking, View } from 'react-native';

import { Button, Popup, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import {
  enablePush,
  PushPermission,
  pushPermissionDetail,
  pushSupported,
  refreshPushToken,
} from '@/lib/push';
import { pushCtaAction, shouldShowPushPrompt, type PushPromptState } from '@/lib/pushPromptPolicy';
import {
  loadPushPromptState,
  onJoinPushPrompt,
  resetPushPromptState,
  savePushPromptState,
} from '@/lib/pushPromptStore';
import { usePromptSlot } from '@/lib/promptQueue';

export function NotificationPrompt() {
  const theme = useTheme();
  const { t } = useStrings();
  const { session } = useAuth();
  // Home only: not over sign-in, onboarding or the join screen itself.
  const onHome = useSegments()[0] === '(tabs)';
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinedGroup, setJoinedGroup] = useState<string | null>(null);
  const [cta, setCta] = useState<'request' | 'settings'>('request');
  const stateRef = useRef<PushPromptState>({ lastShownAt: null, dismissCount: 0 });
  const permissionRef = useRef<PushPermission | null>(null);

  // Whether to put the card up now; also loads what it needs to render.
  const evaluate = async (afterJoin: boolean): Promise<'request' | 'settings' | null> => {
    const [state, detail] = await Promise.all([loadPushPromptState(), pushPermissionDetail()]);
    permissionRef.current = detail.permission;
    if (detail.permission === PushPermission.Granted) {
      if (state.lastShownAt !== null) void resetPushPromptState();
      return null;
    }
    if (
      !shouldShowPushPrompt({ now: Date.now(), state, permission: detail.permission, afterJoin })
    ) {
      return null;
    }
    stateRef.current = state;
    return pushCtaAction(detail);
  };

  useEffect(() => {
    if (!session || !pushSupported || !onHome) return;
    let cancelled = false;
    void evaluate(false).then((action) => {
      if (cancelled || !action) return;
      setCta(action);
      setVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session, onHome]);

  // Just joined a group: worth asking ahead of the timer.
  useEffect(() => {
    if (!session || !pushSupported) return;
    return onJoinPushPrompt((groupName) => {
      void evaluate(true).then((action) => {
        if (!action) return;
        setCta(action);
        setJoinedGroup(groupName);
        setVisible(true);
      });
    });
  }, [session]);

  // Back from the system settings with notifications switched on: register this
  // phone now rather than at the next sign-in, or the server has no token for it.
  useEffect(() => {
    if (!session || !pushSupported) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void pushPermissionDetail()
        .then(({ permission }) => {
          const was = permissionRef.current;
          permissionRef.current = permission;
          if (permission !== PushPermission.Granted || was === PushPermission.Granted) return;
          void refreshPushToken();
          void resetPushPromptState();
          setVisible(false);
        })
        .catch(() => {});
    });
    return () => subscription.remove();
  }, [session]);

  // Sits in the shared prompt queue so the soft ask never lands on top of the
  // tour or the 3-card intro — it waits its turn and shows only when it is the
  // live winner. It outranks the campaign and guest asks (a permission the OS
  // will only offer once is worth more than an announcement).
  const granted = usePromptSlot({ id: 'notifPrompt', priority: 80, active: visible, delayMs: 300 });
  const showing = visible && granted;

  // Counted as shown only once it is actually on screen, and the moment it is,
  // so a write that fails costs one repeat, not a loop.
  useEffect(() => {
    if (!showing) return;
    stateRef.current = { ...stateRef.current, lastShownAt: Date.now() };
    void savePushPromptState(stateRef.current);
  }, [showing]);

  const close = (dismissed: boolean): void => {
    if (dismissed) {
      stateRef.current = {
        lastShownAt: Date.now(),
        dismissCount: stateRef.current.dismissCount + 1,
      };
      void savePushPromptState(stateRef.current);
    }
    setVisible(false);
    setJoinedGroup(null);
  };

  const dismiss = (): void => close(true);

  const onEnable = async (): Promise<void> => {
    setBusy(true);
    let allowed = false;
    try {
      if (cta === 'settings') {
        // The system will not show its dialog again, so the only way is the
        // app's own page in Settings. Coming back is handled above.
        await Linking.openSettings();
      } else {
        // Raises the real dialog and, on a yes, registers and stores the token.
        allowed =
          (await enablePush()).ok || (await pushPermissionDetail()).permission === 'granted';
      }
    } catch {
      // A failure to register is not worth surfacing on a soft ask — swallow it
      // so the onPress promise cannot reject unhandled.
    } finally {
      setBusy(false);
    }
    if (allowed) {
      void resetPushPromptState();
      setVisible(false);
      setJoinedGroup(null);
    } else {
      close(true);
    }
  };

  if (!showing) return null;

  return (
    <Popup
      visible
      onClose={dismiss}
      closeLabel={t.entry.notifyNotNow}
      style={{ maxWidth: 360, alignItems: 'center', gap: theme.spacing.lg }}
    >
      {/* The brand tile with a notification badge — the reference's own way
              of saying, wordlessly, what the ask is about. */}
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          backgroundColor: theme.color.brand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="notifications" size={38} color={theme.color.onBrand} />
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: theme.color.negative,
            borderWidth: 2,
            borderColor: theme.color.surface,
          }}
        />
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="heading" align="center">
          {t.entry.notifyTitle}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {joinedGroup ? fill(t.entry.notifyJoinBody, { group: joinedGroup }) : t.entry.notifyBody}
        </Text>
      </View>

      <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
        <Button
          label={cta === 'settings' ? t.location.openSettings : t.notifications.turnOn}
          size="lg"
          fullWidth
          disabled={busy}
          onPress={() => void onEnable()}
        />
        <Button
          label={t.entry.notifyNotNow}
          variant="ghost"
          size="lg"
          fullWidth
          onPress={dismiss}
        />
      </View>
    </Popup>
  );
}
