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
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';

import { type DeviceLimitStatus } from '@waves/core';
import { directionalIcon, Popup, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { registerDevice, signOutOtherDevices } from '@/data/api';
import { deviceIdentity } from '@/lib/device';
import { useAuth } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { DEVICE_LIMIT_ART, DEVICE_LIMIT_ART_RATIO } from '@/lib/deviceLimitArt';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

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
 * The gate itself: an illustration of the devices on the account with one
 * marked off, the title and the reason under it, the count stated plainly in a
 * card of its own, and the two ways out — a full-width primary and an outlined
 * "Not now" of the same width, one decision with two answers.
 *
 * Three things it deliberately does:
 *
 *   - **States the count.** "Too many" is the app's word for it; "4 devices · 2
 *     allowed" is the fact, and the fact is what tells somebody whether they
 *     already know which extra phone this is.
 *   - **Is easy to leave.** This is a soft gate: the ✕, the scrim and "Not now"
 *     all dismiss it, and nothing is lost by dismissing it.
 *   - **Stays calm.** One small red mark on the illustration says what is wrong;
 *     the rest is the app's own violet, not a warning.
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
  // The last attempt to sign the others out failed: said on the gate, so the
  // person knows to try again rather than wondering whether anything happened.
  const [failed, setFailed] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  const soft = dark ? theme.color.brandSoft : '#F3F1FF';

  return (
    <Popup
      visible
      onClose={onDismiss}
      closeLabel={t.devices.gateDismiss}
      // The illustration runs to the card's edges, so the card's own padding
      // moves inside, under it.
      style={{ padding: 0, overflow: 'hidden' }}
    >
      {/* Scrolls when it has to — a short phone, or a large text size — so the
          two ways out are always reachable; at rest it fits and does not. */}
      <ScrollView
        style={{ maxHeight: windowHeight - GATE_MARGIN }}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ backgroundColor: dark ? theme.color.surfaceMuted : '#F7F6FF' }}>
          <DeviceLimitArt />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onDismiss}
            hitSlop={6}
            style={({ pressed }) => ({
              position: 'absolute',
              top: theme.spacing.md,
              end: theme.spacing.md,
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Ionicons name="close" size={28} color={ink} />
          </Pressable>
        </View>

        {/* The white body rises over the illustration's foot in a soft arch. */}
        <View
          style={{
            marginTop: -ARCH,
            borderTopLeftRadius: ARCH * 2,
            borderTopRightRadius: ARCH * 2,
            backgroundColor: theme.color.surface,
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.xl,
            paddingBottom: theme.spacing.xl,
            gap: theme.spacing.lg,
          }}
        >
          <View style={{ gap: theme.spacing.sm }}>
            <Text
              style={{
                fontSize: 22,
                lineHeight: 28,
                fontWeight: '800',
                color: ink,
                textAlign: 'center',
              }}
            >
              {t.devices.gateTitle}
            </Text>
            <Text style={{ fontSize: 15, lineHeight: 22, color: muted, textAlign: 'center' }}>
              {t.devices.gateBody}
            </Text>
          </View>

          {/* The number behind the dialog. Only when the status is actually in
            hand — the gate can be raised from a cached answer, and an invented
            count is worse than none. */}
          {status ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                borderRadius: 20,
                backgroundColor: soft,
              }}
            >
              <DevicesGlyph accent={accent} />
              <View
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  backgroundColor: dark ? theme.color.border : '#DCD6FA',
                }}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ fontSize: 17, lineHeight: 22, color: ink }}>
                  <Text style={{ fontSize: 17, fontWeight: '800', color: accent }}>
                    {fill(t.devices.gateDevices, { active: status.activeCount })}
                  </Text>
                  {`  ·  ${fill(t.devices.gateAllowed, { limit: status.limit })}`}
                </Text>
                <Text style={{ fontSize: 13, lineHeight: 18, color: muted }}>
                  {fill(t.devices.gateDetail, { active: status.activeCount, limit: status.limit })}
                </Text>
              </View>
            </View>
          ) : null}

          {failed ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                fontSize: 14,
                lineHeight: 19,
                color: theme.color.negative,
                textAlign: 'center',
              }}
            >
              {t.devices.couldNotSignOut}
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.devices.gateAction}
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                setFailed(false);
                try {
                  await onSignOutOthers();
                } catch {
                  // Nothing was signed out: the gate stays up, says so, and the
                  // same button is the retry.
                  setFailed(true);
                } finally {
                  setBusy(false);
                }
              }}
              style={({ pressed }) => ({
                height: 56,
                borderRadius: 28,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.sm,
                backgroundColor: accent,
                shadowColor: accent,
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 4,
                opacity: busy ? 0.7 : pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
                {t.devices.gateAction}
              </Text>
              {/* The spinner takes the arrow's place: the button keeps its width
                and its name while the sessions are revoked. */}
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name={directionalIcon('arrow-forward')} size={20} color="#FFFFFF" />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.devices.gateDismiss}
              onPress={onDismiss}
              style={({ pressed }) => ({
                height: 52,
                borderRadius: 26,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: dark ? theme.color.border : '#D9D3F7',
                backgroundColor: dark ? 'transparent' : '#FAF9FF',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: accent }}>
                {t.devices.gateDismiss}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Popup>
  );
}

/** Room kept around the gate on screen: the popup's own margin, top and bottom. */
const GATE_MARGIN = 96;

/** How far the white body arches up over the illustration's foot. */
const ARCH = 22;

/**
 * The picture at the top: a laptop, a phone and a tablet on a soft dome, each
 * showing the same signed-in person, with a red mark on the one too many. Drawn
 * at its own shape across the card (never stretched); its transparent edges
 * fade into the band behind it.
 */

function DeviceLimitArt() {
  // Measured, then drawn at fixed pixels: a percentage width with an aspect
  // ratio is read by Android as the image's own size and zoomed, cropping
  // everything but the plant. Capped in height so the words and the two ways
  // out always fit under it.
  const [width, setWidth] = useState(0);
  const height = Math.min(width / DEVICE_LIMIT_ART_RATIO, 170);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ width: '100%', height: width ? height + 8 : 1, alignItems: 'center', paddingTop: 8 }}
    >
      {width ? (
        <Image
          source={DEVICE_LIMIT_ART}
          resizeMode="contain"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: height * DEVICE_LIMIT_ART_RATIO, height }}
        />
      ) : null}
    </View>
  );
}

/** The count card's glyph: a laptop with a phone in front of it. */
function DevicesGlyph({ accent }: { accent: string }) {
  return (
    <View style={{ width: 64, height: 48, justifyContent: 'center' }}>
      <Ionicons name="laptop-outline" size={46} color={accent} />
      <Ionicons
        name="phone-portrait-outline"
        size={28}
        color={accent}
        style={{ position: 'absolute', end: 0, bottom: 0 }}
      />
    </View>
  );
}
