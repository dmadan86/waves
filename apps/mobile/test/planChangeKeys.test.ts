import { describe, expect, it } from 'vitest';

import { PLAN_CHANGE_QUERY_KEYS } from '../src/lib/planChangeKeys';

describe('plan change query keys', () => {
  it.each([
    'adsStatus',
    'bannerGate',
    'credits',
    'voiceAgentEnabled',
    'voiceAccess',
    'receiptCap',
    'myPlan',
    'myPlanVoiceRouting',
    'myProTrial',
    'adChoicesVisible',
    'attachmentCap',
    'photoGate',
    'is-paid-storage',
    'storage-usage',
  ])('refreshes %s when the plan changes', (root) => {
    expect(PLAN_CHANGE_QUERY_KEYS).toContainEqual([root]);
  });

  it('has no duplicate prefixes', () => {
    const keys = PLAN_CHANGE_QUERY_KEYS.map((key) => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
