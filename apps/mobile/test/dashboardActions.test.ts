import { describe, expect, it } from 'vitest';

import { captureInboxActionState } from '../src/lib/dashboardActions';

// This is the exact function the Review tab's badge reads (`AppTabBar`), so
// what is proven here — no badge at zero, the real count otherwise — is
// proven for the tab, not just for the dashboard circle it used to decide.
describe('captureInboxActionState', () => {
  it('shows no badge when nothing is waiting — never a bare dot for zero', () => {
    expect(captureInboxActionState(0)).toEqual({ badge: undefined });
  });

  it('badges the exact count of waiting drafts', () => {
    expect(captureInboxActionState(3)).toEqual({ badge: 3 });
  });
});
