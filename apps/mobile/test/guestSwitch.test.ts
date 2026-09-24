/**
 * A guest switching to the account that already owns their Google or Apple
 * login, and the groups they joined as a guest following them there.
 */
import { describe, expect, it, vi } from 'vitest';

import { switchToExistingAccount, type SwitchDeps } from '../src/lib/guestSwitch';

function deps(overrides: Partial<SwitchDeps> = {}) {
  const order: string[] = [];
  const base: SwitchDeps = {
    guestId: 'g1',
    readJoins: vi.fn(async () => {
      order.push('read');
      return ['t1', 't2'];
    }),
    clearJoins: vi.fn(async () => {
      order.push('clear');
    }),
    signInInstead: vi.fn(async () => {
      order.push('signIn');
      return true;
    }),
    accept: vi.fn(async (token: string) => {
      order.push(`accept:${token}`);
      return `group-${token}`;
    }),
    report: vi.fn(),
  };
  return { order, deps: { ...base, ...overrides } };
}

describe('switching a guest to an existing account', () => {
  it('reads the links before the guest is signed out, then rejoins through each', async () => {
    const { order, deps: d } = deps();

    const outcome = await switchToExistingAccount(d);

    expect(order).toEqual(['read', 'signIn', 'accept:t1', 'accept:t2', 'clear']);
    expect(d.readJoins).toHaveBeenCalledWith('g1');
    expect(d.clearJoins).toHaveBeenCalledWith('g1');
    expect(outcome).toEqual({ switched: true, groupId: 'group-t1', failed: 0 });
  });

  it('changes nothing when they back out of the sign-in', async () => {
    const { deps: d } = deps({ signInInstead: vi.fn(async () => false) });

    expect(await switchToExistingAccount(d)).toEqual({ switched: false });
    expect(d.accept).not.toHaveBeenCalled();
    expect(d.clearJoins).not.toHaveBeenCalled();
  });

  it('keeps going past a link that no longer works, and reports it', async () => {
    const broken = new Error('link reset');
    const { deps: d } = deps({
      accept: vi.fn(async (token: string) => {
        if (token === 't1') throw broken;
        return `group-${token}`;
      }),
    });

    const outcome = await switchToExistingAccount(d);

    expect(outcome).toEqual({ switched: true, groupId: 'group-t2', failed: 1 });
    expect(d.report).toHaveBeenCalledWith(broken, 'auth.switchRejoin');
  });

  it('still switches when there is nothing to rejoin, or the links cannot be read', async () => {
    const { deps: none } = deps({ readJoins: vi.fn(async () => []) });
    expect(await switchToExistingAccount(none)).toEqual({
      switched: true,
      groupId: null,
      failed: 0,
    });

    const { deps: unreadable } = deps({
      readJoins: vi.fn(async () => {
        throw new Error('keystore locked');
      }),
    });
    expect(await switchToExistingAccount(unreadable)).toMatchObject({ switched: true });
  });

  it('does not let a failed clear undo a switch that happened', async () => {
    const { deps: d } = deps({
      clearJoins: vi.fn(async () => {
        throw new Error('keystore locked');
      }),
    });
    expect(await switchToExistingAccount(d)).toMatchObject({ switched: true });
  });
});
