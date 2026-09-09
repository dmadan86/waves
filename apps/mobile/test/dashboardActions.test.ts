import { describe, expect, it } from 'vitest';

import { captureInboxActionState } from '../src/lib/dashboardActions';

describe('captureInboxActionState', () => {
  it('opens the empty inbox instead of leaving a visible dead control', () => {
    expect(captureInboxActionState(0)).toEqual({ badge: undefined, disabled: false });
  });

  it('badges waiting drafts while keeping the inbox tappable', () => {
    expect(captureInboxActionState(3)).toEqual({ badge: 3, disabled: false });
  });
});
