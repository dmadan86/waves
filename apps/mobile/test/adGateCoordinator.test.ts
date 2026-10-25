import { beforeEach, expect, it } from 'vitest';
import {
  __reset,
  acquire,
  setProfile,
  isBusy,
  markOffered,
  wasOffered,
  bumpNoFill,
  resetNoFill,
} from '@/lib/adGateCoordinator';
beforeEach(__reset);
it('has one owner across every hook and kind, with idempotent release', () => {
  const l = acquire('a', 'gate')!;
  expect(isBusy()).toBe(true);
  expect(acquire('b', 'credit')).toBeNull();
  expect(acquire('a', 'capped')).toBeNull();
  l.release();
  l.release();
  expect(l.valid()).toBe(false);
  const next = acquire('a', 'credit')!;
  l.release();
  expect(next.valid()).toBe(true);
  expect(isBusy()).toBe(true);
});
it('invalidates on switch and sign-out but preserves same-profile lease', () => {
  setProfile('a');
  const l = acquire('a', 'gate')!;
  setProfile('a');
  expect(l.valid()).toBe(true);
  setProfile('b');
  expect(l.valid()).toBe(false);
  expect(isBusy()).toBe(false);
  const next = acquire('b', 'credit')!;
  setProfile(null);
  expect(next.valid()).toBe(false);
});
it('keeps offered flags and no-fill streaks per profile', () => {
  markOffered('a');
  expect(wasOffered('a')).toBe(true);
  expect(wasOffered('b')).toBe(false);
  expect(bumpNoFill('a')).toBe(1);
  expect(bumpNoFill('a')).toBe(2);
  expect(bumpNoFill('b')).toBe(1);
  resetNoFill('a');
  expect(bumpNoFill('a')).toBe(1);
  expect(bumpNoFill('b')).toBe(2);
  setProfile('b');
  expect(wasOffered('a')).toBe(true);
  __reset();
  expect(wasOffered('a')).toBe(false);
  expect(isBusy()).toBe(false);
});

it('preserves an owner when first setting the same profile, and invalidates on sign-out', () => {
  const l = acquire('a', 'gate')!;
  setProfile('a');
  expect(l.valid()).toBe(true);
  setProfile(null);
  expect(l.valid()).toBe(false);
});
