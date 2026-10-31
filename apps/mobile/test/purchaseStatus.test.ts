import { describe, expect, it } from 'vitest';

import {
  purchaseStatus,
  type InfoLike,
  storeKind,
  type EntitlementLike,
  type SubscriptionRow,
} from '../src/lib/purchaseStatus';

const info = (ent: EntitlementLike | null): InfoLike => ({
  entitlements: { active: ent ? { pro: ent } : {} },
});
const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  tier: 'pro',
  period: 'monthly',
  status: 'active',
  current_period_end: null,
  store: 'play_store',
  store_txn_id: 'GPA.1',
  price_minor: 7900,
  currency: 'INR',
  ...over,
});

describe('purchaseStatus', () => {
  it('is null when nothing was ever bought', () => {
    expect(purchaseStatus(null, null)).toBeNull();
    expect(purchaseStatus(info(null), null)).toBeNull();
  });
  it('reads the live entitlement', () => {
    const play = { store: 'PLAY_STORE', willRenew: true, periodType: 'NORMAL' };
    expect(purchaseStatus(info(play), row())).toBe('active');
    expect(purchaseStatus(info({ ...play, willRenew: false }), row())).toBe('renewsOff');
    expect(purchaseStatus(info({ ...play, periodType: 'TRIAL' }), row())).toBe('trial');
    expect(purchaseStatus(info({ ...play, billingIssueDetectedAt: '2027-01-01' }), row())).toBe(
      'billingIssue',
    );
    expect(purchaseStatus(info({ store: 'PROMOTIONAL' }), row({ store: 'promo' }))).toBe('promo');
  });
  it('lets a refund win, and falls back to the row without CustomerInfo', () => {
    expect(purchaseStatus(info({ store: 'APP_STORE' }), row({ status: 'refunded' }))).toBe(
      'refunded',
    );
    expect(purchaseStatus(null, row({ status: 'expired' }))).toBe('expired');
    expect(purchaseStatus(null, row({ status: 'grace' }))).toBe('billingIssue');
    expect(purchaseStatus(null, row())).toBe('active');
  });
  it('classifies stores', () => {
    expect(storeKind('PLAY_STORE')).toBe('play');
    expect(storeKind('app_store')).toBe('apple');
    expect(storeKind('PROMOTIONAL')).toBe('none');
  });
});
