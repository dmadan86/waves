/**
 * RevenueCat configuration contract — LIVE.
 *
 * Reads the real RevenueCat project through its v2 REST API and checks that
 * what is configured in the dashboard is what the app and the webhook expect:
 * the "default" offering is current and has all four packages, every package
 * carries a product for every store app in the project, each product sells the
 * tier its package says, and each product unlocks the matching entitlement.
 *
 * It guards the "Plans could not be loaded" bug, where the offering held only
 * RevenueCat's sample products: the app asked for Plus and Pro, found neither,
 * and the paywall stayed empty. No unit test can see that; it is a dashboard
 * mistake.
 *
 * Runs ONLY when REVENUECAT_SECRET_KEY is set (a RevenueCat v2 secret key with
 * read access to the project); otherwise the whole file is skipped. In CI it
 * runs from .github/workflows/revenuecat-contract.yml, weekly and on demand.
 *
 *   REVENUECAT_SECRET_KEY=sk_... pnpm --filter @waves/core exec vitest run test/revenuecat.live.test.ts
 *
 * The key is only ever sent to api.revenuecat.com and never logged.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { PlanTier } from '../src/billing/plans';
import {
  baseProductId,
  periodFromProductId,
  RC_DEFAULT_OFFERING,
  RC_ENTITLEMENT_PLUS,
  RC_ENTITLEMENT_PRO,
  RC_PRODUCT_IDS,
  tierFromProductId,
} from '../src/billing/revenuecat';

// @waves/core has no Node typings; the test only needs the environment.
declare const process: { env: Record<string, string | undefined> };

const SECRET = process.env.REVENUECAT_SECRET_KEY?.trim();
const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID?.trim() || 'proj2094ec43';
const API = 'https://api.revenuecat.com';

/** The packages the paywall needs, and what each must sell. */
const PACKAGES = [
  {
    lookupKey: '$rc_monthly',
    tier: PlanTier.Plus,
    period: 'monthly',
    entitlement: RC_ENTITLEMENT_PLUS,
    productId: RC_PRODUCT_IDS.plusMonthly,
  },
  {
    lookupKey: '$rc_annual',
    tier: PlanTier.Plus,
    period: 'yearly',
    entitlement: RC_ENTITLEMENT_PLUS,
    productId: RC_PRODUCT_IDS.plusYearly,
  },
  {
    lookupKey: 'pro_monthly',
    tier: PlanTier.Pro,
    period: 'monthly',
    entitlement: RC_ENTITLEMENT_PRO,
    productId: RC_PRODUCT_IDS.proMonthly,
  },
  {
    lookupKey: 'pro_annual',
    tier: PlanTier.Pro,
    period: 'yearly',
    entitlement: RC_ENTITLEMENT_PRO,
    productId: RC_PRODUCT_IDS.proYearly,
  },
] as const;

interface RcApp {
  id: string;
  name: string;
  type: string;
}
interface RcProduct {
  id: string;
  app_id: string;
  store_identifier: string;
  state?: string;
}
interface RcPackage {
  id: string;
  lookup_key: string;
}
interface RcOffering {
  id: string;
  lookup_key: string;
  is_current: boolean;
}
interface RcEntitlement {
  id: string;
  lookup_key: string;
}
interface RcList<T> {
  items: T[];
  next_page: string | null;
}

async function get<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${SECRET}` } });
  if (!response.ok) {
    // Status and path only: never the key, never the response headers.
    throw new Error(`RevenueCat ${response.status} for ${path.split('?')[0]}`);
  }
  return (await response.json()) as T;
}

/** Every item of a list endpoint, following `next_page`. */
async function list<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = `${path}${path.includes('?') ? '&' : '?'}limit=100`;
  for (let page = 0; next && page < 20; page += 1) {
    const body: RcList<T> = await get<RcList<T>>(next);
    items.push(...body.items);
    next = body.next_page;
  }
  return items;
}

interface Snapshot {
  apps: RcApp[];
  offering: RcOffering | undefined;
  packages: RcPackage[];
  /** package id -> the products attached to it */
  packageProducts: Map<string, RcProduct[]>;
  entitlements: RcEntitlement[];
  /** entitlement lookup key -> ids of the products it unlocks */
  entitlementProducts: Map<string, Set<string>>;
}

const project = `/v2/projects/${PROJECT_ID}`;
let rc: Snapshot;

describe.skipIf(!SECRET)('RevenueCat dashboard configuration (live)', () => {
  beforeAll(async () => {
    const [apps, offerings, entitlements] = await Promise.all([
      list<RcApp>(`${project}/apps`),
      list<RcOffering>(`${project}/offerings`),
      list<RcEntitlement>(`${project}/entitlements`),
    ]);
    const offering = offerings.find((o) => o.lookup_key === RC_DEFAULT_OFFERING);
    const packages = offering
      ? await list<RcPackage>(`${project}/offerings/${offering.id}/packages`)
      : [];
    const packageProducts = new Map<string, RcProduct[]>();
    for (const pkg of packages) {
      const attached = await list<{ product: RcProduct }>(`${project}/packages/${pkg.id}/products`);
      packageProducts.set(
        pkg.id,
        attached.map((a) => a.product),
      );
    }
    const entitlementProducts = new Map<string, Set<string>>();
    for (const entitlement of entitlements) {
      const products = await list<RcProduct>(`${project}/entitlements/${entitlement.id}/products`);
      entitlementProducts.set(entitlement.lookup_key, new Set(products.map((p) => p.id)));
    }
    rc = { apps, offering, packages, packageProducts, entitlements, entitlementProducts };
  }, 60_000);

  const productsOf = (lookupKey: string): RcProduct[] => {
    const pkg = rc.packages.find((p) => p.lookup_key === lookupKey);
    return (pkg && rc.packageProducts.get(pkg.id)) || [];
  };

  describe('the project', () => {
    it('has a Test Store app and a Google Play app (and an App Store app, once added)', () => {
      const types = rc.apps.map((app) => app.type);
      expect(types).toContain('test_store');
      expect(types).toContain('play_store');
      // An App Store app is optional until iOS ships, but once it exists the
      // per-package checks below hold it to the same standard as the others.
    });

    it('has the plus and pro entitlements the app and webhook read', () => {
      const keys = rc.entitlements.map((e) => e.lookup_key);
      expect(keys).toContain(RC_ENTITLEMENT_PLUS);
      expect(keys).toContain(RC_ENTITLEMENT_PRO);
      expect(RC_ENTITLEMENT_PLUS).toBe('plus');
      expect(RC_ENTITLEMENT_PRO).toBe('pro');
    });
  });

  describe('the default offering', () => {
    it('exists and is the current one', () => {
      expect(rc.offering, `offering "${RC_DEFAULT_OFFERING}" is missing`).toBeDefined();
      expect(rc.offering!.is_current).toBe(true);
    });

    it('has exactly the four packages the paywall reads', () => {
      expect(rc.packages.map((p) => p.lookup_key).sort()).toEqual(
        PACKAGES.map((p) => p.lookupKey).sort(),
      );
    });
  });

  describe.each(PACKAGES)('package $lookupKey ($tier $period)', (expected) => {
    it('has a product for every store app in the project', () => {
      const products = productsOf(expected.lookupKey);
      for (const app of rc.apps) {
        expect(
          products.some((p) => p.app_id === app.id),
          `${expected.lookupKey} has no product on ${app.name} (${app.type})`,
        ).toBe(true);
      }
    });

    it('sells the right tier and period on every store, not a sample product', () => {
      for (const product of productsOf(expected.lookupKey)) {
        const where = `${expected.lookupKey} -> ${product.store_identifier}`;
        expect(product.store_identifier.toLowerCase(), where).toMatch(
          expected.tier === PlanTier.Pro ? /pro/ : /plus/,
        );
        expect(tierFromProductId(product.store_identifier), where).toBe(expected.tier);
        expect(periodFromProductId(product.store_identifier), where).toBe(expected.period);
        // The id the app and webhook know: Play adds ":<base plan>", nothing else may differ.
        expect(baseProductId(product.store_identifier), where).toBe(expected.productId);
      }
    });

    it(`is attached to the "${expected.entitlement}" entitlement and not the other`, () => {
      const unlocks = rc.entitlementProducts.get(expected.entitlement);
      const other = rc.entitlementProducts.get(
        expected.entitlement === RC_ENTITLEMENT_PRO ? RC_ENTITLEMENT_PLUS : RC_ENTITLEMENT_PRO,
      );
      expect(unlocks, `entitlement ${expected.entitlement} is missing`).toBeDefined();
      for (const product of productsOf(expected.lookupKey)) {
        const where = `${product.store_identifier} (${product.app_id})`;
        expect(unlocks!.has(product.id), `${where} does not unlock ${expected.entitlement}`).toBe(
          true,
        );
        expect(other?.has(product.id) ?? false, `${where} also unlocks the other tier`).toBe(false);
      }
    });
  });
});
