/**
 * RevenueCat (`react-native-purchases`), the native half of billing.
 *
 * Configured with a public SDK key from the build's env
 * (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`). A
 * build with no key never touches the SDK: `purchasesAvailable()` is false,
 * the paywall stays hidden and nothing can be bought — the same as before
 * billing existed.
 *
 * The RevenueCat app user id is the Waves profile id (`session.user.id`), so
 * the webhook can write `subscriptions` for the right person: the SDK is
 * configured with it at sign-in, `Purchases.logIn` switches it when another
 * account signs in, and `Purchases.logOut` on sign-out.
 *
 * What the SDK says about the person (CustomerInfo) is for display only. The
 * server's answer comes from `subscriptions`, written by the webhook.
 */

import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import Purchases, {
  PRORATION_MODE,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

import { PlanTier, RC_DEFAULT_OFFERING } from '@waves/core';

import { reportHandled } from './observability';
import { activeProductId, revenueCatApiKey, tierFromCustomerInfo } from './pricing';

const API_KEY = revenueCatApiKey(Platform.OS, {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
});

/** True when this build can sell anything at all. */
export function purchasesAvailable(): boolean {
  return API_KEY !== null;
}

// --- Who RevenueCat thinks is signed in ------------------------------------

let configured = false;
let currentUser: string | null = null;
let queue: Promise<void> = Promise.resolve();

interface EntitlementSnapshot {
  readonly tier: PlanTier;
  readonly info: CustomerInfo | null;
  /** True until CustomerInfo has been read once for the signed-in account. */
  readonly loading: boolean;
}

const SIGNED_OUT: EntitlementSnapshot = { tier: PlanTier.Free, info: null, loading: false };
let snapshot: EntitlementSnapshot = SIGNED_OUT;
const listeners = new Set<() => void>();

function publish(next: EntitlementSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function accept(info: CustomerInfo): void {
  publish({ tier: tierFromCustomerInfo(info), info, loading: false });
}

async function readCustomerInfo(): Promise<void> {
  try {
    accept(await Purchases.getCustomerInfo());
  } catch (error) {
    publish({ ...snapshot, loading: false });
    reportHandled(error, 'purchases.getCustomerInfo');
  }
}

/**
 * Point RevenueCat at the signed-in profile (or at nobody). Serialised, so a
 * fast sign-out/sign-in cannot interleave a logOut with the next logIn.
 */
export function syncPurchasesUser(profileId: string | null): Promise<void> {
  if (!API_KEY) return Promise.resolve();
  const key = API_KEY;
  queue = queue.then(async () => {
    try {
      if (!configured) {
        // Nothing to set up for a signed-out launch: purchases need an account.
        if (!profileId) return;
        Purchases.configure({ apiKey: key, appUserID: profileId });
        Purchases.addCustomerInfoUpdateListener(accept);
        configured = true;
        currentUser = profileId;
        publish({ tier: PlanTier.Free, info: null, loading: true });
        await readCustomerInfo();
        return;
      }
      if (profileId === currentUser) return;
      if (profileId) {
        publish({ tier: PlanTier.Free, info: null, loading: true });
        const { customerInfo } = await Purchases.logIn(profileId);
        currentUser = profileId;
        accept(customerInfo);
      } else {
        currentUser = null;
        publish(SIGNED_OUT);
        await Purchases.logOut();
      }
    } catch (error) {
      reportHandled(error, 'purchases.syncUser');
    }
  });
  return queue;
}

// --- Reading it from React ---------------------------------------------------

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The tier RevenueCat reports for this account, live. Display only. */
export function useCustomerTier(): EntitlementSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Re-read CustomerInfo, e.g. on pull-to-refresh. */
export async function refreshCustomerInfo(): Promise<void> {
  if (!configured) return;
  await readCustomerInfo();
}

// --- Buying ------------------------------------------------------------------

/** The offering the paywall shows: RevenueCat's current one, else 'default'. */
export async function loadOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? offerings.all[RC_DEFAULT_OFFERING] ?? null;
}

export type PurchaseOutcome = 'purchased' | 'cancelled' | 'pending';

/**
 * Buy one package. On Android, an existing Plus/Pro subscription is replaced
 * (upgrade/downgrade in place) rather than stacked; on iOS the subscription
 * group does that by itself.
 */
export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  const current = activeProductId(snapshot.info);
  const target = pkg.product.identifier.split(':')[0];
  const change =
    Platform.OS === 'android' && current && current !== target
      ? {
          oldProductIdentifier: current,
          prorationMode: PRORATION_MODE.IMMEDIATE_WITH_TIME_PRORATION,
        }
      : null;
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg, null, change);
    accept(customerInfo);
    return 'purchased';
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
    if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'pending';
    throw error;
  }
}

/** Restore: re-reads the store account's purchases. Returns the tier it found. */
export async function restore(): Promise<PlanTier> {
  const info = await Purchases.restorePurchases();
  accept(info);
  return tierFromCustomerInfo(info);
}
