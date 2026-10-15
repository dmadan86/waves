/**
 * `lib/purchases.ts` against a faked `react-native-purchases`: which SDK key the
 * build configures with (or none), the RevenueCat user following the signed-in
 * profile, offering and package selection, what a purchase / cancel / failure /
 * restore returns, and the Android in-place upgrade.
 *
 * The module keeps its state at module level and reads the key from the build's
 * env once at import, so every test loads a fresh copy (`load`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanTier, RC_DEFAULT_OFFERING } from '@waves/core';

const sdk = vi.hoisted(() => ({
  configure: vi.fn(),
  addCustomerInfoUpdateListener: vi.fn(),
  getCustomerInfo: vi.fn(),
  getOfferings: vi.fn(),
  logIn: vi.fn(),
  logOut: vi.fn(),
  purchasePackage: vi.fn(),
  restorePurchases: vi.fn(),
  showManageSubscriptions: vi.fn(),
}));
const rn = vi.hoisted(() => ({
  platform: { OS: 'android' as string },
  appStateListeners: [] as ((state: string) => void)[],
  openURL: vi.fn(),
}));
const reportHandled = vi.hoisted(() => vi.fn());

vi.mock('react-native', () => ({
  Platform: rn.platform,
  Linking: { openURL: rn.openURL },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      rn.appStateListeners.push(listener);
      return { remove: vi.fn() };
    },
  },
}));

// Values are RevenueCat's own: PURCHASE_CANCELLED_ERROR '1', PAYMENT_PENDING_ERROR '20'.
vi.mock('react-native-purchases', () => ({
  default: sdk,
  PRORATION_MODE: { IMMEDIATE_WITH_TIME_PRORATION: 1 },
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: '1',
    STORE_PROBLEM_ERROR: '2',
    PAYMENT_PENDING_ERROR: '20',
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  // No renderer here: hand back the store's current value, which is all the hook does.
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

vi.mock('../src/lib/observability', () => ({ reportHandled }));

const ME = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
const OTHER = '0a0a0a0a-1111-4222-8333-444444444444';

type Purchases = typeof import('../src/lib/purchases');

interface BuildEnv {
  os?: string;
  ios?: string;
  android?: string;
  dev?: boolean;
}

async function load(build: BuildEnv = {}): Promise<Purchases> {
  vi.resetModules();
  rn.platform.OS = build.os ?? 'android';
  (globalThis as { __DEV__?: boolean }).__DEV__ = build.dev ?? false;
  if (build.ios === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = build.ios;
  if (build.android === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = build.android;
  return import('../src/lib/purchases');
}

/** A build that has an Android key. */
const withKey = (over: BuildEnv = {}) => load({ android: 'goog_abc', ...over });

function info(active: Record<string, string> = {}, extra: object = {}) {
  return {
    entitlements: {
      active: Object.fromEntries(
        Object.entries(active).map(([id, productIdentifier]) => [
          id,
          { isActive: true, productIdentifier },
        ]),
      ),
    },
    ...extra,
  };
}

function pkg(identifier: string, productId: string, packageType = 'CUSTOM') {
  return {
    identifier,
    packageType,
    product: { identifier: productId, price: 49, priceString: '₹49.00', currencyCode: 'INR' },
  };
}

function offering(identifier: string, packages = [pkg('$rc_monthly', 'waves_plus_monthly')]) {
  return { identifier, availablePackages: packages };
}

beforeEach(() => {
  for (const fn of Object.values(sdk)) fn.mockReset();
  reportHandled.mockReset();
  rn.openURL.mockReset();
  rn.appStateListeners.length = 0;
  sdk.getCustomerInfo.mockResolvedValue(info());
  sdk.logIn.mockResolvedValue({ customerInfo: info(), created: false });
  sdk.logOut.mockResolvedValue(info());
});

describe('which key the build configures with', () => {
  it('uses the Android key on Android and the iOS key on iOS', async () => {
    const android = await load({ os: 'android', android: 'goog_abc', ios: 'appl_xyz' });
    await android.syncPurchasesUser(ME);
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'goog_abc', appUserID: ME });

    sdk.configure.mockClear();
    const ios = await load({ os: 'ios', android: 'goog_abc', ios: 'appl_xyz' });
    await ios.syncPurchasesUser(ME);
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'appl_xyz', appUserID: ME });
  });

  it('never touches the SDK when the build has no key for this platform', async () => {
    const p = await load({ os: 'android', ios: 'appl_xyz' });
    expect(p.purchasesAvailable()).toBe(false);
    await p.syncPurchasesUser(ME);
    expect(await p.loadOffering()).toBeNull();
    expect(sdk.configure).not.toHaveBeenCalled();
    expect(sdk.getCustomerInfo).not.toHaveBeenCalled();
    expect(sdk.addCustomerInfoUpdateListener).not.toHaveBeenCalled();
    expect(p.useCustomerTier()).toMatchObject({ tier: PlanTier.Free, info: null, loading: false });
  });

  it('treats a blank key as no key', async () => {
    const p = await load({ android: '   ' });
    expect(p.purchasesAvailable()).toBe(false);
  });

  it('accepts a Test Store key only in a development build', async () => {
    expect((await load({ android: 'test_abc', dev: true })).purchasesAvailable()).toBe(true);
    expect((await load({ android: 'test_abc', dev: false })).purchasesAvailable()).toBe(false);
  });
});

describe('the RevenueCat user follows the signed-in profile', () => {
  it('configures with the profile id at sign-in and reads CustomerInfo once', async () => {
    sdk.getCustomerInfo.mockResolvedValue(info({ plus: 'waves_plus_monthly:monthly' }));
    const p = await withKey();
    expect(p.purchasesAvailable()).toBe(true);
    await p.syncPurchasesUser(ME);
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.addCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
    expect(p.useCustomerTier()).toMatchObject({ tier: PlanTier.Plus, loading: false });
  });

  it('does nothing for a signed-out launch: purchases need an account', async () => {
    const p = await withKey();
    await p.syncPurchasesUser(null);
    expect(sdk.configure).not.toHaveBeenCalled();
    expect(p.useCustomerTier().tier).toBe(PlanTier.Free);
  });

  it('is loading until the first CustomerInfo arrives', async () => {
    let resolve!: (value: unknown) => void;
    sdk.getCustomerInfo.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = await withKey();
    const pending = p.syncPurchasesUser(ME);
    await vi.waitFor(() => expect(sdk.getCustomerInfo).toHaveBeenCalled());
    expect(p.useCustomerTier()).toMatchObject({ tier: PlanTier.Free, loading: true });
    resolve(info({ pro: 'waves_pro_monthly' }));
    await pending;
    expect(p.useCustomerTier()).toMatchObject({ tier: PlanTier.Pro, loading: false });
  });

  it('asking again for the same account is a no-op', async () => {
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await p.syncPurchasesUser(ME);
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.logIn).not.toHaveBeenCalled();
  });

  it('logs in the next account instead of configuring twice, and takes its tier', async () => {
    sdk.logIn.mockResolvedValue({
      customerInfo: info({ pro: 'waves_pro_yearly' }),
      created: false,
    });
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await p.syncPurchasesUser(OTHER);
    expect(sdk.configure).toHaveBeenCalledTimes(1);
    expect(sdk.logIn).toHaveBeenCalledWith(OTHER);
    expect(p.useCustomerTier()).toMatchObject({ tier: PlanTier.Pro, loading: false });
  });

  it('signing out clears the tier and logs RevenueCat out', async () => {
    sdk.getCustomerInfo.mockResolvedValue(info({ plus: 'waves_plus_monthly' }));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await p.syncPurchasesUser(null);
    expect(sdk.logOut).toHaveBeenCalledTimes(1);
    expect(p.useCustomerTier()).toEqual({ tier: PlanTier.Free, info: null, loading: false });
  });

  it('serialises a fast sign-out then sign-in so logOut cannot interleave with logIn', async () => {
    const order: string[] = [];
    sdk.logOut.mockImplementation(async () => {
      order.push('logOut:start');
      await Promise.resolve();
      order.push('logOut:end');
      return info();
    });
    sdk.logIn.mockImplementation(async () => {
      order.push('logIn');
      return { customerInfo: info(), created: false };
    });
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    void p.syncPurchasesUser(null);
    await p.syncPurchasesUser(OTHER);
    expect(order).toEqual(['logOut:start', 'logOut:end', 'logIn']);
  });

  it('reports a failed setup instead of throwing, and retries when the app returns to the front', async () => {
    sdk.logIn.mockRejectedValueOnce(new Error('offline'));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await expect(p.syncPurchasesUser(OTHER)).resolves.toBeUndefined();
    expect(reportHandled).toHaveBeenCalledWith(expect.any(Error), 'purchases.syncUser');

    // Foregrounding asks again for the account the app last wanted.
    sdk.logIn.mockResolvedValue({
      customerInfo: info({ plus: 'waves_plus_monthly' }),
      created: false,
    });
    for (const listener of rn.appStateListeners) listener('active');
    await vi.waitFor(() => expect(sdk.logIn).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(p.useCustomerTier().tier).toBe(PlanTier.Plus));
  });

  it('does not retry on a background state change', async () => {
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    for (const listener of rn.appStateListeners) listener('background');
    await Promise.resolve();
    expect(sdk.logIn).not.toHaveBeenCalled();
  });

  it('registers one foreground listener however many times it is asked', async () => {
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await p.syncPurchasesUser(OTHER);
    await p.syncPurchasesUser(null);
    expect(rn.appStateListeners).toHaveLength(1);
  });

  it('keeps the signed-in state when CustomerInfo cannot be read, and says so', async () => {
    sdk.getCustomerInfo.mockRejectedValue(new Error('network'));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    expect(p.useCustomerTier()).toMatchObject({ tier: PlanTier.Free, loading: false });
    expect(reportHandled).toHaveBeenCalledWith(expect.any(Error), 'purchases.getCustomerInfo');
  });

  it('follows CustomerInfo pushed by the SDK listener (a purchase on another screen)', async () => {
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    const push = sdk.addCustomerInfoUpdateListener.mock.calls[0]![0] as (i: unknown) => void;
    push(info({ plus: 'waves_plus_monthly', pro: 'waves_pro_monthly' }));
    expect(p.useCustomerTier().tier).toBe(PlanTier.Pro);
    push(info());
    expect(p.useCustomerTier().tier).toBe(PlanTier.Free);
  });

  it('refreshCustomerInfo re-reads once configured, and is inert before that', async () => {
    const p = await withKey();
    await p.refreshCustomerInfo();
    expect(sdk.getCustomerInfo).not.toHaveBeenCalled();
    await p.syncPurchasesUser(ME);
    sdk.getCustomerInfo.mockResolvedValue(info({ pro: 'waves_pro_monthly' }));
    await p.refreshCustomerInfo();
    expect(p.useCustomerTier().tier).toBe(PlanTier.Pro);
  });
});

describe('the tier a store product or entitlement gives', () => {
  const tierFor = async (active: Record<string, string>) => {
    sdk.getCustomerInfo.mockResolvedValue(info(active));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    return p.useCustomerTier().tier;
  };

  it('is Plus for the plus entitlement and Pro for pro, whatever the store id looks like', async () => {
    expect(await tierFor({ plus: 'waves_plus_monthly:monthly' })).toBe(PlanTier.Plus); // Play
    expect(await tierFor({ plus: 'waves_plus_yearly' })).toBe(PlanTier.Plus); // App Store
    expect(await tierFor({ plus: 'monthly' })).toBe(PlanTier.Plus); // Test Store
    expect(await tierFor({ pro: 'waves_pro_yearly:yearly' })).toBe(PlanTier.Pro);
    expect(await tierFor({})).toBe(PlanTier.Free);
  });

  it('is Pro when both entitlements are active', async () => {
    expect(await tierFor({ plus: 'waves_plus_monthly', pro: 'waves_pro_monthly' })).toBe(
      PlanTier.Pro,
    );
  });
});

describe('the offering the paywall gets', () => {
  it('is null before the SDK is configured (no account yet)', async () => {
    const p = await withKey();
    expect(await p.loadOffering()).toBeNull();
    expect(sdk.getOfferings).not.toHaveBeenCalled();
  });

  it("is RevenueCat's current offering, else 'default'", async () => {
    const current = offering('current_one');
    const dflt = offering(RC_DEFAULT_OFFERING);
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    sdk.getOfferings.mockResolvedValue({ current, all: { current_one: current, default: dflt } });
    expect(await p.loadOffering()).toBe(current);
    sdk.getOfferings.mockResolvedValue({ current: null, all: { default: dflt } });
    expect(await p.loadOffering()).toBe(dflt);
    sdk.getOfferings.mockResolvedValue({ current: null, all: {} });
    expect(await p.loadOffering()).toBeNull();
  });

  it('is the plus_price arm for somebody in the test, and falls back when it is missing', async () => {
    const dflt = offering(RC_DEFAULT_OFFERING);
    const arm = offering('plus_p79', [pkg('$rc_monthly', 'waves_plus_monthly_p79')]);
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    sdk.getOfferings.mockResolvedValue({
      current: dflt,
      all: { default: dflt, plus_p79: arm },
    });
    expect(await p.loadOffering('p79')).toBe(arm);
    // An arm whose offering is not set up in RevenueCat never breaks the paywall.
    expect(await p.loadOffering('p49')).toBe(dflt);
    // Not an arm at all.
    expect(await p.loadOffering('control')).toBe(dflt);
    expect(await p.loadOffering(null)).toBe(dflt);
  });

  it('lets a failed fetch reach the caller, which shows the retry state', async () => {
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    sdk.getOfferings.mockRejectedValue(new Error('offline'));
    await expect(p.loadOffering()).rejects.toThrow('offline');
  });
});

describe('buying', () => {
  const plusMonthly = pkg('$rc_monthly', 'waves_plus_monthly:monthly', 'MONTHLY');
  const proMonthly = pkg('pro_monthly', 'waves_pro_monthly:monthly');

  it('purchases the package and puts the new tier in the snapshot', async () => {
    sdk.purchasePackage.mockResolvedValue({
      customerInfo: info({ plus: 'waves_plus_monthly:monthly' }),
    });
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    expect(await p.purchase(plusMonthly as never)).toBe('purchased');
    expect(sdk.purchasePackage).toHaveBeenCalledWith(plusMonthly, null, null);
    expect(p.useCustomerTier().tier).toBe(PlanTier.Plus);
  });

  it('returns cancelled, without throwing, when the person backs out of the store sheet', async () => {
    sdk.purchasePackage.mockRejectedValue({ code: '1', userCancelled: true });
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await expect(p.purchase(plusMonthly as never)).resolves.toBe('cancelled');
    expect(p.useCustomerTier().tier).toBe(PlanTier.Free);
    expect(reportHandled).not.toHaveBeenCalled();
  });

  it('returns pending for a payment the store has not settled', async () => {
    sdk.purchasePackage.mockRejectedValue({ code: '20' });
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await expect(p.purchase(plusMonthly as never)).resolves.toBe('pending');
  });

  it('throws store errors so the paywall can show them', async () => {
    const failure = { code: '2', message: 'store problem' };
    sdk.purchasePackage.mockRejectedValue(failure);
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await expect(p.purchase(plusMonthly as never)).rejects.toBe(failure);
    expect(p.useCustomerTier().tier).toBe(PlanTier.Free);
  });

  it('throws an error with no code, too', async () => {
    sdk.purchasePackage.mockRejectedValue(new Error('boom'));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await expect(p.purchase(plusMonthly as never)).rejects.toThrow('boom');
  });

  it('on Android, upgrading Plus to Pro replaces the subscription in place', async () => {
    sdk.getCustomerInfo.mockResolvedValue(info({ plus: 'waves_plus_monthly:monthly' }));
    sdk.purchasePackage.mockResolvedValue({
      customerInfo: info({ pro: 'waves_pro_monthly:monthly' }),
    });
    const p = await withKey({ os: 'android' });
    await p.syncPurchasesUser(ME);
    await p.purchase(proMonthly as never);
    expect(sdk.purchasePackage).toHaveBeenCalledWith(proMonthly, null, {
      oldProductIdentifier: 'waves_plus_monthly',
      prorationMode: 1,
    });
    expect(p.useCustomerTier().tier).toBe(PlanTier.Pro);
  });

  it('on Android, buying the product already held is not a plan change', async () => {
    sdk.getCustomerInfo.mockResolvedValue(info({ plus: 'waves_plus_monthly:monthly' }));
    sdk.purchasePackage.mockResolvedValue({ customerInfo: info() });
    const p = await withKey({ os: 'android' });
    await p.syncPurchasesUser(ME);
    await p.purchase(plusMonthly as never);
    expect(sdk.purchasePackage).toHaveBeenCalledWith(plusMonthly, null, null);
  });

  it('on Android, a first purchase has no old product to replace', async () => {
    sdk.purchasePackage.mockResolvedValue({ customerInfo: info() });
    const p = await withKey({ os: 'android' });
    await p.syncPurchasesUser(ME);
    await p.purchase(proMonthly as never);
    expect(sdk.purchasePackage).toHaveBeenCalledWith(proMonthly, null, null);
  });

  it('on iOS the subscription group does the switching, so no change is passed', async () => {
    sdk.getCustomerInfo.mockResolvedValue(info({ plus: 'waves_plus_monthly' }));
    sdk.purchasePackage.mockResolvedValue({ customerInfo: info({ pro: 'waves_pro_monthly' }) });
    const p = await load({ os: 'ios', ios: 'appl_xyz' });
    await p.syncPurchasesUser(ME);
    await p.purchase(pkg('pro_monthly', 'waves_pro_monthly') as never);
    expect(sdk.purchasePackage).toHaveBeenCalledWith(expect.anything(), null, null);
  });
});

describe('restoring', () => {
  it('returns the tier it found and updates the snapshot', async () => {
    sdk.restorePurchases.mockResolvedValue(info({ pro: 'waves_pro_yearly' }));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    expect(await p.restore()).toBe(PlanTier.Pro);
    expect(p.useCustomerTier().tier).toBe(PlanTier.Pro);
  });

  it('finds Free when the store account has nothing', async () => {
    sdk.restorePurchases.mockResolvedValue(info());
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    expect(await p.restore()).toBe(PlanTier.Free);
  });

  it('throws when the store cannot be reached, so the paywall shows its error', async () => {
    sdk.restorePurchases.mockRejectedValue(new Error('offline'));
    const p = await withKey();
    await p.syncPurchasesUser(ME);
    await expect(p.restore()).rejects.toThrow('offline');
  });
});

describe('managing the plan', () => {
  it('knows a store subscription from a plan with nothing to manage', async () => {
    const p = await withKey();
    expect(p.hasStoreSubscription(null)).toBe(false);
    expect(p.hasStoreSubscription(info() as never)).toBe(false);
    expect(p.hasStoreSubscription(info({ plus: 'waves_plus_monthly' }) as never)).toBe(true);
  });

  it('opens the App Store sheet on iOS', async () => {
    const p = await load({ os: 'ios', ios: 'appl_xyz' });
    await p.manageSubscription();
    expect(sdk.showManageSubscriptions).toHaveBeenCalledTimes(1);
    expect(rn.openURL).not.toHaveBeenCalled();
  });

  it("opens RevenueCat's management link on Android, else Google Play's page", async () => {
    sdk.getCustomerInfo.mockResolvedValue(
      info({ plus: 'waves_plus_monthly' }, { managementURL: 'https://play.google.com/x' }),
    );
    const p = await withKey({ os: 'android' });
    await p.syncPurchasesUser(ME);
    await p.manageSubscription();
    expect(rn.openURL).toHaveBeenCalledWith('https://play.google.com/x');

    rn.openURL.mockClear();
    sdk.getCustomerInfo.mockResolvedValue(info());
    const fresh = await withKey({ os: 'android' });
    await fresh.syncPurchasesUser(ME);
    await fresh.manageSubscription();
    expect(rn.openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
  });
});
