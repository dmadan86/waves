/**
 * Session, day and per-surface counters behind the ad planner. No React Native
 * imports: the clock and storage are injected so it is testable. The app wires
 * one instance (`adBudget`) to AppState in useAdPlan. Only the day count, the
 * sessions-today count and "Remove ads" taps persist; a restart is a new,
 * conservative session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanInput } from './adPlanPure';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createAdBudget(deps: { now: () => number; storage: Storage }) {
  const { now, storage } = deps;
  const utcDay = () => new Date(now()).toISOString().slice(0, 10);
  let startedAt = now();
  let fgMs = 0;
  let fgSince: number | null = now();
  let backgroundAt: number | null = null;
  let idleSeconds = 1800;
  let sessionImpressions = 0;
  let pending = 0;
  const today = new Map<string, number>();
  const sessions = new Map<string, number>();
  const removeTapped = new Map<string, number>();
  const failures = new Map<string, number>();
  const hydrated = new Set<string>();
  const dayKey = (profileId: string) => `waves.passiveImpressions.${profileId}.${utcDay()}`;
  const sessionKey = () => `waves.adSessions.${utcDay()}`;
  const tapKey = (profileId: string) => `waves.adRemoveTapped.${profileId}`;
  const write = (key: string, value: number) =>
    storage.setItem(key, String(value)).catch(() => undefined);

  function newSession() {
    startedAt = now();
    fgMs = 0;
    sessionImpressions = 0;
    const day = sessionKey();
    sessions.set(day, (sessions.get(day) ?? 0) + 1);
    void write(day, sessions.get(day)!);
  }

  return {
    setIdleSeconds(seconds: number) {
      idleSeconds = seconds;
    },
    foreground() {
      if (fgSince != null) return;
      if (backgroundAt != null && now() - backgroundAt >= idleSeconds * 1000) newSession();
      backgroundAt = null;
      fgSince = now();
    },
    background() {
      if (fgSince != null) fgMs += now() - fgSince;
      fgSince = null;
      backgroundAt = now();
    },
    foregroundMs: () => fgMs + (fgSince != null ? now() - fgSince : 0),
    /** Loads the persisted counters once per profile and day (counts this process as a session). */
    async hydrate(profileId: string) {
      const key = `${profileId}|${utcDay()}`;
      if (hydrated.has(key)) return;
      hydrated.add(key);
      const read = async (k: string) => {
        try {
          const n = Number((await storage.getItem(k)) ?? 0);
          return Number.isFinite(n) && n >= 0 ? n : 0;
        } catch {
          return 0;
        }
      };
      today.set(
        dayKey(profileId),
        Math.max(today.get(dayKey(profileId)) ?? 0, await read(dayKey(profileId))),
      );
      removeTapped.set(profileId, await read(tapKey(profileId)));
      if (!sessions.has(sessionKey())) {
        sessions.set(sessionKey(), (await read(sessionKey())) + 1);
        void write(sessionKey(), sessions.get(sessionKey())!);
      }
    },
    /** Pending requests count as impressions so concurrent slots cannot overrun a cap. */
    snapshot(profileId: string, surface: string, serverToday = 0): PlanInput['session'] {
      return {
        startedAt,
        foregroundMs: this.foregroundMs(),
        sessionsToday: sessions.get(sessionKey()) ?? 1,
        sessionCap: null,
        impressionsSession: sessionImpressions + pending,
        impressionsToday: Math.max(today.get(dayKey(profileId)) ?? 0, serverToday) + pending,
        impressionsVisit: 0,
        lastRewardedAt: 0,
        lastFailureAt: failures.get(surface) ?? 0,
        removeAdsTappedAt: removeTapped.get(profileId) ?? 0,
      };
    },
    todayCount: (profileId: string) => today.get(dayKey(profileId)) ?? 0,
    reserve(profileId: string) {
      pending++;
      let done = false;
      return {
        /** The SDK reported an impression. */
        confirm() {
          if (done) return;
          done = true;
          pending = Math.max(0, pending - 1);
          sessionImpressions++;
          const key = dayKey(profileId);
          today.set(key, (today.get(key) ?? 0) + 1);
          void write(key, today.get(key)!);
        },
        /** Failed or left before an impression: no cap is used. */
        release() {
          if (done) return;
          done = true;
          pending = Math.max(0, pending - 1);
        },
      };
    },
    noteFailure(surface: string) {
      failures.set(surface, now());
    },
    noteRemoveAds(profileId: string) {
      removeTapped.set(profileId, now());
      void write(tapKey(profileId), now());
    },
  };
}

export const adBudget = createAdBudget({ now: Date.now, storage: AsyncStorage });
