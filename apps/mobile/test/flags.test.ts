/**
 * Feature flags on the phone: off is the fallback for everything, and
 * `useFlagVerdict` tells "not rolled out" apart from "not asked yet".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { variantFor } from '@waves/core';

import { useFlagEnabled, useFlagVariant, useFlagVerdict } from '../src/lib/flags';

const env = vi.hoisted(() => ({
  profile: null as null | { id: string },
  query: { data: undefined as unknown, isSuccess: false },
  options: null as null | { queryKey: unknown; queryFn: () => Promise<unknown>; staleTime: number },
  table: { data: null as unknown, error: null as unknown },
  selected: '' as string,
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: env.profile }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: typeof env.options) => {
    env.options = options;
    return env.query;
  },
}));
vi.mock('@/lib/backend', () => ({
  backend: {
    from: (table: string) => ({
      select: async (columns: string) => {
        env.selected = `${table}:${columns}`;
        return env.table;
      },
    }),
  },
}));

const ON = { key: 'split-v2', enabled: true, rolloutPercent: 100, variants: ['a', 'b'] };
const OFF = { key: 'dark', enabled: false, rolloutPercent: 100, variants: ['on'] };

beforeEach(() => {
  env.profile = { id: 'profile-1' };
  env.query = { data: undefined, isSuccess: false };
  env.options = null;
  env.table = { data: null, error: null };
});

describe('reading the flag table', () => {
  it('maps rows to flags, and an unreadable table to no flags at all', async () => {
    useFlagVariant('x');
    const { queryFn, queryKey, staleTime } = env.options!;
    expect(queryKey).toEqual(['feature-flags']);
    expect(staleTime).toBe(60 * 60 * 1000);

    env.table = {
      data: [{ key: 'k', enabled: true, rollout_percent: 25, variants: ['a'] }],
      error: null,
    };
    await expect(queryFn()).resolves.toEqual([
      { key: 'k', enabled: true, rolloutPercent: 25, variants: ['a'] },
    ]);
    expect(env.selected).toBe('feature_flags:key, enabled, rollout_percent, variants');

    env.table = { data: null, error: null };
    await expect(queryFn()).resolves.toEqual([]);

    env.table = { data: null, error: { message: 'denied' } };
    await expect(queryFn()).resolves.toEqual([]);
  });
});

describe('useFlagVariant / useFlagEnabled', () => {
  it('is off with no profile or no data', () => {
    env.query = { data: [ON], isSuccess: true };
    env.profile = null;
    expect(useFlagVariant('split-v2')).toBeNull();

    env.profile = { id: 'profile-1' };
    env.query = { data: undefined, isSuccess: false };
    expect(useFlagEnabled('split-v2')).toBe(false);
  });

  it('computes the arm locally from the profile id, and is off for unknown or disabled flags', () => {
    env.query = { data: [ON, OFF], isSuccess: true };
    expect(useFlagVariant('split-v2')).toBe(variantFor(ON, 'profile-1'));
    expect(useFlagEnabled('split-v2')).toBe(true);
    expect(useFlagVariant('missing')).toBeNull();
    expect(useFlagEnabled('dark')).toBe(false);
  });
});

describe('useFlagVerdict', () => {
  it('is settled with no profile — there is nothing to wait for', () => {
    env.profile = null;
    expect(useFlagVerdict('split-v2')).toEqual({ variant: null, settled: true });
  });

  it('is unsettled until the table has come back', () => {
    expect(useFlagVerdict('split-v2')).toEqual({ variant: null, settled: false });
  });

  it('is settled once read, whether the flag is on, off or absent', () => {
    env.query = { data: [ON, OFF], isSuccess: true };
    expect(useFlagVerdict('split-v2')).toEqual({
      variant: variantFor(ON, 'profile-1'),
      settled: true,
    });
    expect(useFlagVerdict('dark')).toEqual({ variant: null, settled: true });
    expect(useFlagVerdict('missing')).toEqual({ variant: null, settled: true });
  });
});
