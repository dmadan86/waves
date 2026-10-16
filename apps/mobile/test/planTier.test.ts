import { describe, expect, it } from 'vitest';

import { PlanTier } from '@waves/core';

import { higherTier, tierFromServerPlan } from '../src/lib/planTier';

describe('tierFromServerPlan', () => {
  it('reads the plan waves_my_plan returns', () => {
    expect(tierFromServerPlan('pro')).toBe(PlanTier.Pro);
    // The retired 'plus' is Pro.
    expect(tierFromServerPlan('plus')).toBe(PlanTier.Pro);
    expect(tierFromServerPlan('free')).toBe(PlanTier.Free);
  });
  it('is Free for anything it does not know', () => {
    expect(tierFromServerPlan(undefined)).toBe(PlanTier.Free);
    expect(tierFromServerPlan('PRO ')).toBe(PlanTier.Free);
    expect(tierFromServerPlan(2)).toBe(PlanTier.Free);
  });
});

describe('higherTier', () => {
  it('keeps a server grant the store does not know about', () => {
    expect(higherTier(PlanTier.Free, PlanTier.Pro)).toBe(PlanTier.Pro);
  });
  it('keeps a store purchase the server has not caught up with', () => {
    expect(higherTier(PlanTier.Pro, PlanTier.Free)).toBe(PlanTier.Pro);
  });
  it('is Free only when both say Free', () => {
    expect(higherTier(PlanTier.Free, PlanTier.Free)).toBe(PlanTier.Free);
  });
});
