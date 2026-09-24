/**
 * The screen's side of a guest whose Google or Apple login already has an
 * account: ask, then switch and open the group — or hand the error back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthMethod } from '@waves/core';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const world = vi.hoisted(() => ({
  session: { user: { id: 'g1', is_anonymous: true } } as unknown,
  confirm: vi.fn(async (_options: Record<string, unknown>) => true),
  signInInstead: vi.fn(async (_provider: string) => true),
  acceptInvite: vi.fn(async (input: { token: string }) => ({
    group: { id: `group-${input.token}`, name: 'Trip' },
    memberId: 'm1',
  })),
  read: vi.fn(async (_id: string) => ['t1']),
  clear: vi.fn(async (_id: string) => {}),
  replace: vi.fn(),
  invalidate: vi.fn(async () => {}),
  report: vi.fn(),
}));

class FakeIdentityTakenError extends Error {
  constructor(readonly provider: string) {
    super('taken');
  }
}

vi.mock('@/lib/auth', () => ({
  IdentityTakenError: FakeIdentityTakenError,
  useAuth: () => ({ session: world.session, signInInstead: world.signInInstead }),
}));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ confirm: world.confirm }) }));
vi.mock('@/data/api', () => ({ acceptInvite: world.acceptInvite }));
vi.mock('@/data/hooks', () => ({ keys: { groups: ['groups'] } }));
vi.mock('@/lib/guestJoins', () => ({ guestJoins: { read: world.read, clear: world.clear } }));
vi.mock('@/lib/navigation', () => ({ router: { replace: world.replace } }));
vi.mock('@/lib/observability', () => ({ reportHandled: world.report }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: world.invalidate }),
}));
vi.mock('@/i18n', () => ({
  fill: (template: string, values: Record<string, string>) =>
    template.replace('{provider}', values.provider ?? ''),
  useStrings: () => ({
    t: {
      signIn: {
        accountTakenTitle: 'This {provider} account already has Waves',
        accountTakenBody: 'body',
        accountTakenNote: 'note',
        switchAccount: 'Switch account',
        stayGuest: 'Stay as guest',
      },
    },
  }),
}));

const { useIdentityTaken } = await import('../src/lib/useIdentityTaken');

const resolver = () => renderHook(() => useIdentityTaken()).result.current;

beforeEach(() => {
  vi.clearAllMocks();
  world.session = { user: { id: 'g1', is_anonymous: true } };
  world.confirm.mockResolvedValue(true);
  world.signInInstead.mockResolvedValue(true);
});

describe('a login that already has an account', () => {
  it('passes every other error straight back', async () => {
    const other = new Error('network');
    expect(await resolver()(other)).toBe(other);
    expect(world.confirm).not.toHaveBeenCalled();
  });

  it('asks, naming the provider, and offers to stay a guest', async () => {
    await resolver()(new FakeIdentityTakenError(OAuthMethod.Apple));

    expect(world.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'This Apple account already has Waves',
        confirmLabel: 'Switch account',
        cancelLabel: 'Stay as guest',
      }),
    );
  });

  it('switches, rejoins the guest’s group and opens it', async () => {
    const left = await resolver()(new FakeIdentityTakenError(OAuthMethod.Google));

    expect(left).toBeNull();
    expect(world.signInInstead).toHaveBeenCalledWith(OAuthMethod.Google);
    expect(world.acceptInvite).toHaveBeenCalledWith({ token: 't1', claimMemberId: null });
    expect(world.clear).toHaveBeenCalledWith('g1');
    expect(world.invalidate).toHaveBeenCalled();
    expect(world.replace).toHaveBeenCalledWith('/group/group-t1');
  });

  it('goes home rather than into a group still waiting on an admin', async () => {
    world.acceptInvite.mockResolvedValueOnce({
      group: { id: 'group-t1', name: 'Trip' },
      pending: true,
    } as never);

    await resolver()(new FakeIdentityTakenError(OAuthMethod.Google));

    expect(world.replace).toHaveBeenCalledWith('/');
  });

  it('does nothing more when they choose to stay a guest', async () => {
    world.confirm.mockResolvedValueOnce(false);

    expect(await resolver()(new FakeIdentityTakenError(OAuthMethod.Google))).toBeNull();
    expect(world.signInInstead).not.toHaveBeenCalled();
    expect(world.replace).not.toHaveBeenCalled();
  });

  it('hands back what the switch itself ran into', async () => {
    const refused = new Error('token rejected');
    world.signInInstead.mockRejectedValueOnce(refused);

    expect(await resolver()(new FakeIdentityTakenError(OAuthMethod.Google))).toBe(refused);
    expect(world.replace).not.toHaveBeenCalled();
  });
});
