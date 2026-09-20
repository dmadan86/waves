/**
 * The device cap, wired to a running app (free tier: two phones at a time).
 *
 * Three jobs, all quiet until they are not:
 *
 * It **registers** this phone whenever an account is signed in, and refreshes
 * that registration when the app comes back to the foreground — the heartbeat
 * that keeps a phone in daily use counted, and lets one left in a drawer fall
 * out of the count on its own after two weeks.
 *
 * It **reports** where the account stands. The database decides whether the
 * account is over its limit; this holds that answer and hands it to the gate.
 *
 * It **gates**, softly. A free account over the line is shown a sheet asking it
 * to sign the other phones out — never a locked door. Signing in on a phone can
 * always continue; what the person chooses is which two phones keep the session.
 * Guests have no cap (an anonymous account is one device by definition) and are
 * skipped entirely.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, AppState, View } from 'react-native';

import { type DeviceLimitStatus } from '@waves/core';
import { Button, iconSize, Popup, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { registerDevice, signOutOtherDevices } from '@/data/api';
import { deviceIdentity } from '@/lib/device';
import { useAuth } from '@/lib/auth';
import { backend } from '@/lib/backend';

/** The gate's icon medallion — big enough to read as an illustration, not a bullet. */
const MEDALLION = 64;

/** How stale a registration may get before a foreground refreshes it. */
const HEARTBEAT_MS = 60 * 60 * 1000;

interface DeviceSessionValue {
  /** Null until the first registration answers, or for guests. */
  status: DeviceLimitStatus | null;
  /**
   * Sign out every other device — GoTrue sessions and the table both. Resolves
   * to the number of registry rows retired, or null when the sessions were
   * revoked but that count could not be confirmed. Rejects only when the session
   * revocation itself failed (nothing was signed out).
   */
  signOutOthers: () => Promise<number | null>;
  /** Re-ask the server where the account stands. */
  refresh: () => Promise<void>;
}

const DeviceSessionContext = createContext<DeviceSessionValue | null>(null);

export function useDeviceSession(): DeviceSessionValue {
  const value = useContext(DeviceSessionContext);
  if (!value) throw new Error('useDeviceSession must be used inside DeviceSessionProvider');
  return value;
}

export function DeviceSessionProvider({ children }: { children: ReactNode }) {
  const { session, isGuest } = useAuth();
  const userId = session?.user?.id ?? null;
  const eligible = Boolean(userId) && !isGuest;

  const [status, setStatus] = useState<DeviceLimitStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lastBeatAt = useRef(0);

  // Reset in render rather than an effect (the pattern `AuthProvider` uses):
  // the previous account's answer must not flash on the next one, and clearing
  // it here avoids a render that shows it.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  if (userId !== answeredFor) {
    setAnsweredFor(userId);
    setStatus(null);
    setDismissed(false);
  }

  const register = useCallback(async () => {
    if (!eligible) return;
    try {
      const identity = await deviceIdentity();
      const next = await registerDevice(identity);
      lastBeatAt.current = Date.now();
      setStatus(next);
    } catch {
      // Registration is best-effort: a failed call must never keep somebody out
      // of their own app. The next foreground tries again.
    }
  }, [eligible]);

  // Register on sign-in. Sign-out is handled by the render-phase reset above.
  // The work is an async IIFE (the pattern `AuthProvider` uses) so the state
  // update lands after the round trip rather than synchronously in the effect.
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    void (async () => {
      try {
        const identity = await deviceIdentity();
        const next = await registerDevice(identity);
        if (!active) return;
        lastBeatAt.current = Date.now();
        setStatus(next);
      } catch {
        // Best-effort: a failed registration must never keep somebody out of
        // their own app. The next foreground tries again.
      }
    })();
    return () => {
      active = false;
    };
  }, [eligible, userId]);

  // Heartbeat: a foreground, throttled, is enough to keep last-seen fresh.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastBeatAt.current > HEARTBEAT_MS) {
        void register();
      }
    });
    return () => sub.remove();
  }, [register]);

  const signOutOthers = useCallback(async () => {
    const identity = await deviceIdentity();
    // The real session revocation first — this is the part that actually logs
    // the other phones out; the table update below only makes the list say so.
    // If this itself fails, nothing was revoked: surface the error, keep the gate.
    try {
      // signOut resolves with `{ error }` rather than throwing, so a revocation
      // failure has to be read off the result and re-thrown; otherwise the gate
      // below would dismiss on a sign-out that never happened.
      const { error } = await backend.auth.signOut({ scope: 'others' });
      if (error) throw error;
    } catch (caught) {
      await register();
      throw caught;
    }
    // The sessions are gone, so the gate has served its purpose whether or not
    // the registry table catches up. Dismiss before the reconciliation that can
    // still fail on a flaky network.
    setDismissed(true);
    try {
      const revoked = await signOutOtherDevices(identity.deviceId);
      await register();
      return revoked;
    } catch {
      // Only the list update failed; the sessions are already revoked. Refresh
      // what we can and report an unconfirmed count rather than a false zero.
      await register();
      return null;
    }
  }, [register]);

  const refresh = useCallback(async () => {
    await register();
  }, [register]);

  const showGate = eligible && status?.overLimit === true && !dismissed;

  return (
    <DeviceSessionContext.Provider value={{ status, signOutOthers, refresh }}>
      {children}
      {showGate ? (
        <DeviceLimitGate
          status={status}
          onDismiss={() => setDismissed(true)}
          onSignOutOthers={signOutOthers}
        />
      ) : null}
    </DeviceSessionContext.Provider>
  );
}

/**
 * The gate itself, built the way the good blocking dialogs are built (Coffee
 * Meets Bagel, Affirm, Tabby, Wise): a tinted medallion so the dialog is
 * recognisable before a word of it is read, the title and the reason centred
 * under it, the number that provoked it stated plainly, and the two ways out as
 * one full-width button and one quiet one.
 *
 * Three things it deliberately does:
 *
 *   - **States the count.** "Too many" is the app's word for it; "3 devices · 2
 *     allowed" is the fact, and the fact is what tells somebody whether they
 *     already know which third phone this is.
 *   - **Gives the buttons the same width.** They used to take the width of their
 *     own labels, so the choice between them read as two unrelated controls of
 *     different importance rather than one decision with two answers. Full width
 *     for the action, full width and chromeless for the way out — the hierarchy
 *     everybody uses, and the second one still has a 48pt target.
 *   - **Says nothing alarming.** This is a soft gate: the scrim dismisses it,
 *     "Not now" dismisses it, and nothing is lost by dismissing it. So a brand
 *     medallion rather than a red warning triangle.
 */
function DeviceLimitGate({
  status,
  onDismiss,
  onSignOutOthers,
}: {
  status: DeviceLimitStatus | null;
  onDismiss: () => void;
  onSignOutOthers: () => Promise<number | null>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [busy, setBusy] = useState(false);

  return (
    <Popup
      visible
      onClose={onDismiss}
      closeLabel={t.devices.gateDismiss}
      style={{ gap: theme.spacing.lg, alignItems: 'center' }}
    >
      <View
        style={{
          width: MEDALLION,
          height: MEDALLION,
          borderRadius: MEDALLION / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name="phone-portrait-outline" size={iconSize.xxxl} color={theme.color.brand} />
      </View>

      <View style={{ gap: theme.spacing.sm, alignSelf: 'stretch' }}>
        <Text variant="heading" style={{ textAlign: 'center' }}>
          {t.devices.gateTitle}
        </Text>
        <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
          {t.devices.gateBody}
        </Text>
      </View>

      {/* The number behind the dialog. Only when the status is actually in hand —
          the gate can be raised from a cached answer, and an invented count is
          worse than none. */}
      {status ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          <Text variant="caption" tone="muted">
            {fill(t.devices.gateCount, { active: status.activeCount, limit: status.limit })}
          </Text>
        </View>
      ) : null}

      <View style={{ gap: theme.spacing.xs, alignSelf: 'stretch' }}>
        <Button
          label={t.devices.gateAction}
          fullWidth
          disabled={busy}
          // The spinner takes the icon slot rather than replacing the label: the
          // button keeps its width and its name while the sessions are revoked,
          // which is a second or two on a slow connection.
          icon={
            busy ? (
              <ActivityIndicator size="small" color={theme.color.onButtonPrimary} />
            ) : undefined
          }
          onPress={async () => {
            setBusy(true);
            try {
              await onSignOutOthers();
            } catch {
              // The failure is reported on the devices screen; here the gate
              // simply stays up so the person can try again.
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button label={t.devices.gateDismiss} variant="ghost" fullWidth onPress={onDismiss} />
      </View>
    </Popup>
  );
}
