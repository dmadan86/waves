import * as Network from 'expo-network';
import { getLocales } from 'expo-localization';
import { pickInterstitialUnit } from './adPacingPure';
import { emptyLedger, parseLedger, type AdLedger } from '@/lib/adGateEngine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { adTimeout } from '@/lib/adTimeout';
import { adsAreQuiet } from '@/lib/adSensitiveMoment';
import { syncEngine, SyncStatus } from '@/sync/engine';
import { backend } from '@/lib/backend';
import { defaultRewardedAdDeps } from '@/lib/adsSdk';
import { adClocks, flushAdEvents, logAdEvent, type AdPlacement } from '@/lib/adEvents';
import {
  AD_PACING_DEFAULTS,
  initialPacing,
  paceExpense,
  type AdPacingSettings,
  type PacingState,
} from '@/lib/adPacingPure';
import { runGateAd, prepareInterstitial, type PreparedInterstitial } from '@/lib/adGateRunner';

export interface GateStatus {
  enabled: boolean;
  credits?: number;
  walletCap?: number;
  perAd?: number;
  costs?: Record<'voice' | 'scan' | 'export' | 'group', number>;
  createdAt: string;
  createdGroups: number;
  interstitialToday: number;
  lastAdAt: string | null;
  lastRewardedAt: string | null;
  lastInterstitialAt: string | null;
  settings: AdPacingSettings & { interstitial_video_enabled?: boolean };
}
export async function readGateStatus(profileId: string): Promise<GateStatus | null> {
  await adTimeout(flushAdEvents(profileId), 500);
  const result = await adTimeout(backend.rpc('waves_my_ad_gate_status'));
  if (!result) return null;
  const { data, error } = result;
  if (error || !data || typeof data !== 'object') return null;
  const status = data as GateStatus;
  const pendingGroups = syncEngine
    .getState()
    .queue.filter((item) => item.kind === 'group.create' && !item.rejection).length;
  return { ...status, createdGroups: status.createdGroups + pendingGroups };
}
const preparedAds = new Map<string, PreparedInterstitial>();
// The AdMob interstitial unit should be created as Display-only (no video) so ads stay short and closable quickly.
// Shown only if already preloaded (prewarmExpenseAd): never a loading spinner after a save.
function interstitialDeps(videoUnit?: string) {
  return {
    ...defaultRewardedAdDeps(),
    unitId: () => {
      const configured =
        Platform.OS === 'ios'
          ? process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS
          : process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID;
      return (
        (!__DEV__ && (videoUnit || configured?.trim())) ||
        (Platform.OS === 'ios'
          ? 'ca-app-pub-3940256099942544/4411468910'
          : 'ca-app-pub-3940256099942544/1033173712')
      );
    },
  };
}
export async function prewarmExpenseAd(profileId: string) {
  startAdSession();
  const cached = preparedAds.get(profileId);
  if (cached && Date.now() - cached.loadedAt >= 45 * 60000) preparedAds.delete(profileId);
  if (Platform.OS === 'web' || running || preparedAds.has(profileId)) return;
  const status = await readGateStatus(profileId).catch(() => null);
  if (
    !status?.enabled ||
    Date.now() - Date.parse(status.createdAt) < status.settings.grace_days * 86400000 ||
    status.interstitialToday >= status.settings.interstitial_daily_cap
  )
    return;
  const videoUnit =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_VIDEO_IOS
      : process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_VIDEO_ANDROID;
  const network = await Network.getNetworkStateAsync().catch(() => null);
  const unit = pickInterstitialUnit({
    videoUnitConfigured: !!videoUnit?.trim(),
    flagEnabled: status.settings.interstitial_video_enabled === true,
    unmetered:
      network?.type === Network.NetworkStateType.WIFI &&
      (network as { isConnectionExpensive?: boolean }).isConnectionExpensive !== true,
    firstAdOfDay: status.interstitialToday === 0,
    sessionSeconds: (Date.now() - sessionStartedAt) / 1000,
    country: getLocales()[0]?.regionCode ?? null,
  });
  const ad = await prepareInterstitial(
    interstitialDeps(unit === 'video' ? videoUnit?.trim() : undefined),
  );
  if (ad) preparedAds.set(profileId, ad);
  else logAdEvent(profileId, 'expense_interstitial', 'failed');
}
let sessionStartedAt = 0;
const sessions = new Map<string, number>();
let running = false;
export function gatesBusy() {
  return running;
}
export async function watchGate(
  profileId: string,
  placement: AdPlacement,
  canShow: () => boolean = () => true,
) {
  if (running) return 'cancelled' as const;
  running = true;
  try {
    const current = await readGateStatus(profileId).catch(() => null);
    if (!current?.enabled) {
      if (!current) logAdEvent(profileId, placement, 'offline_allowed', 'status');
      return 'bypass' as const;
    }
    if (!canShow()) return 'bypass' as const;
    const deps = defaultRewardedAdDeps();
    const result = await runGateAd(
      true,
      deps,
      () => logAdEvent(profileId, placement, 'shown'),
      undefined,
      () => canShow() && AppState.currentState === 'active',
      (cb) => {
        let prev = AppState.currentState;
        const sub = AppState.addEventListener('change', (state) => {
          if (state === 'active' && prev === 'background') cb();
          prev = state;
        });
        return () => sub.remove();
      },
    );
    logAdEvent(profileId, placement, result === 'cancelled' ? 'skipped' : result);
    return result;
  } catch {
    logAdEvent(profileId, placement, 'failed');
    return 'failed' as const;
  } finally {
    running = false;
  }
}
export function startAdSession() {
  if (!sessionStartedAt) sessionStartedAt = Date.now();
}
// Sync + status RPC can take seconds on Indian mobile data; past this the ad would feel unrelated to the save.
const SHOW_WINDOW_MS = 5000;
export async function afterGroupExpense(
  profileId: string,
  paid: boolean,
  onlineSave: boolean,
  groupId: string,
  expenseId: string,
  edited = false,
) {
  if (paid || !onlineSave || running || Platform.OS === 'web') return;
  running = true;
  const savedAt = Date.now();
  try {
    await syncEngine.flush({ groupIds: [groupId] });
    const synced = syncEngine.getState();
    if (
      synced.status !== SyncStatus.Idle ||
      synced.rejected.some((item) => item.groupId === groupId) ||
      !synced.mirror.tables.expenses?.[expenseId] ||
      synced.queue.some(
        (item) =>
          item.groupId === groupId &&
          (item.payload as { expenseId?: unknown } | null)?.expenseId === expenseId,
      )
    )
      return;
    if (Date.now() - savedAt >= SHOW_WINDOW_MS) return;
    const status = await readGateStatus(profileId);
    if (!status?.enabled) return;
    const deps = defaultRewardedAdDeps();
    if (!(await deps.isOnline())) return;
    const key = `waves.adPacing.${profileId}`;
    const raw = await AsyncStorage.getItem(key);
    const seed = Array.from(profileId).reduce((s, c) => Math.imul(s, 31) + c.charCodeAt(0), 0);
    const state: PacingState = raw
      ? (JSON.parse(raw) as PacingState)
      : initialPacing(seed ^ Date.now());
    state.sessionShown = sessions.get(profileId) ?? 0;
    // The server is authoritative; a local reservation can only reduce delivery.
    if (state.day === new Date().toISOString().slice(0, 10))
      state.today = Math.max(state.today, status.interstitialToday);
    else {
      state.day = new Date().toISOString().slice(0, 10);
      state.today = status.interstitialToday;
    }
    const local = adClocks(profileId);
    const time = (value: string | null) => (value ? Date.parse(value) : 0);
    const decision = paceExpense(
      state,
      {
        now: Date.now(),
        createdAt: Date.parse(status.createdAt),
        sessionStartedAt,
        enabled: true,
        paid,
        personal: false,
        saved: true,
        editOf: edited ? expenseId : undefined,
        online: true,
        sensitiveMoment: adsAreQuiet(Date.now()),
        lastAdAt: Math.max(local.lastAdAt, time(status.lastAdAt)),
        lastRewardedAt: Math.max(local.lastRewardedAt, time(status.lastRewardedAt)),
        lastInterstitialAt: Math.max(local.lastInterstitialAt, time(status.lastInterstitialAt)),
      },
      { ...AD_PACING_DEFAULTS, ...status.settings },
    );
    await AsyncStorage.setItem(key, JSON.stringify(decision.state));
    sessions.set(profileId, decision.state.sessionShown);
    if (decision.reason === 'blocked_grace')
      logAdEvent(profileId, 'expense_interstitial', 'blocked_grace');
    if (!decision.show || AppState.currentState !== 'active') return;
    const prepared = preparedAds.get(profileId);
    preparedAds.delete(profileId);
    if (!prepared || Date.now() - prepared.loadedAt > 45 * 60000) {
      logAdEvent(profileId, 'expense_interstitial', 'failed');
      return;
    }
    const result = await runGateAd(
      false,
      interstitialDeps(),
      () => logAdEvent(profileId, 'expense_interstitial', 'shown'),
      prepared,
      () =>
        AppState.currentState === 'active' &&
        Date.now() - savedAt < SHOW_WINDOW_MS &&
        !adsAreQuiet(Date.now()) &&
        Date.now() - adClocks(profileId).lastAdAt >= 60000,
    );
    logAdEvent(profileId, 'expense_interstitial', result === 'cancelled' ? 'skipped' : result);
  } catch {
    logAdEvent(profileId, 'expense_interstitial', 'failed');
  } finally {
    running = false;
  }
}

const ledgerKey = (id: string) => `waves.adLedger.${id}`;
export function localGroupCount() {
  return Object.keys(syncEngine.getState().mirror.tables.groups ?? {}).length;
}
export async function readLedger(id: string): Promise<AdLedger> {
  try {
    return parseLedger(JSON.parse((await AsyncStorage.getItem(ledgerKey(id))) ?? 'null'));
  } catch {
    return emptyLedger();
  }
}
async function storeLedger(id: string, l: AdLedger) {
  try {
    await AsyncStorage.setItem(ledgerKey(id), JSON.stringify(l));
  } catch {}
}
let ledgerUpdates: Promise<unknown> = Promise.resolve();
export function updateLedger(id: string, fn: (l: AdLedger) => AdLedger): Promise<AdLedger> {
  const next = ledgerUpdates.then(async () => {
    const l = fn(await readLedger(id));
    await storeLedger(id, l);
    return l;
  });
  ledgerUpdates = next.catch(() => undefined);
  return next;
}
export async function writeLedger(id: string, l: AdLedger) {
  await updateLedger(id, () => l);
}
