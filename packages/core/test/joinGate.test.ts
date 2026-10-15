import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_REQUIRED,
  isAccountRequired,
  isRemovedFromGroup,
  REMOVED_FROM_GROUP,
  JoinGate,
  joinGate,
  shouldAutoJoin,
} from '../src/auth/joinGate';

describe('joinGate', () => {
  it('asks a signed-out person to sign up or log in, with no guest option', () => {
    expect(joinGate({ signedIn: false, anonymous: false })).toBe(JoinGate.SignUpOrLogIn);
    // Whatever the anonymous flag says, no session means no join.
    expect(joinGate({ signedIn: false, anonymous: true })).toBe(JoinGate.SignUpOrLogIn);
  });

  it('asks a guest to create an account (upgrade in place) instead of joining', () => {
    expect(joinGate({ signedIn: true, anonymous: true })).toBe(JoinGate.UpgradeGuest);
  });

  it('lets a real account through', () => {
    expect(joinGate({ signedIn: true, anonymous: false })).toBe(JoinGate.Ready);
  });

  it('has no gate value that means "join as a guest"', () => {
    expect(Object.values(JoinGate).sort()).toEqual(['ready', 'sign_up_or_log_in', 'upgrade_guest']);
  });
});

describe('isAccountRequired', () => {
  it('recognises the server code however the client wrapped it', () => {
    expect(isAccountRequired(new Error('ACCOUNT_REQUIRED: Create a free account'))).toBe(true);
    expect(isAccountRequired({ code: ACCOUNT_REQUIRED })).toBe(true);
    expect(isAccountRequired('ACCOUNT_REQUIRED')).toBe(true);
  });
  it('ignores other failures', () => {
    expect(isAccountRequired(new Error('INVITE_INVALID: nope'))).toBe(false);
    expect(isAccountRequired(null)).toBe(false);
    expect(isAccountRequired(undefined)).toBe(false);
  });
});

describe('isRemovedFromGroup', () => {
  it('recognises the server code however the client wrapped it', () => {
    expect(
      isRemovedFromGroup(new Error('REMOVED_FROM_GROUP: You were removed from this group.')),
    ).toBe(true);
    expect(isRemovedFromGroup({ code: REMOVED_FROM_GROUP })).toBe(true);
    expect(isRemovedFromGroup('REMOVED_FROM_GROUP')).toBe(true);
  });
  it('ignores other failures', () => {
    expect(isRemovedFromGroup(new Error('ACCOUNT_REQUIRED: nope'))).toBe(false);
    expect(isRemovedFromGroup(new Error('INVITE_INVALID: nope'))).toBe(false);
    expect(isRemovedFromGroup(null)).toBe(false);
  });
});

describe('shouldAutoJoin (resume after login)', () => {
  const base = { gate: JoinGate.Ready, resume: true, claimableCount: 0, attempted: false };
  it('joins by itself after signing up or logging in', () => {
    expect(shouldAutoJoin(base)).toBe(true);
  });
  it('does not before the person is a real account', () => {
    expect(shouldAutoJoin({ ...base, gate: JoinGate.UpgradeGuest })).toBe(false);
    expect(shouldAutoJoin({ ...base, gate: JoinGate.SignUpOrLogIn })).toBe(false);
  });
  it('does not on a plain open of the link', () => {
    expect(shouldAutoJoin({ ...base, resume: false })).toBe(false);
  });
  it('shows the "is this you?" choice first when there are unclaimed people', () => {
    expect(shouldAutoJoin({ ...base, claimableCount: 2 })).toBe(false);
  });
  it('only once', () => {
    expect(shouldAutoJoin({ ...base, attempted: true })).toBe(false);
  });
});
