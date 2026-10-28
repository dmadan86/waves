import { describe, expect, it } from 'vitest';
import { createAdBudget } from '../src/lib/adBudget';

const mem = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
  };
};
const T0 = Date.UTC(2026, 9, 29, 23, 0);

describe('adBudget', () => {
  it('reserve/confirm/release: pending counts toward caps, only confirm uses them', () => {
    let now = T0;
    const b = createAdBudget({ now: () => now, storage: mem() });
    const a = b.reserve('p');
    expect(b.snapshot('p', 's').impressionsSession).toBe(1);
    a.release();
    a.confirm(); // already settled: no double count
    expect(b.snapshot('p', 's').impressionsSession).toBe(0);
    const c = b.reserve('p');
    c.confirm();
    c.confirm();
    expect(b.snapshot('p', 's')).toMatchObject({ impressionsSession: 1, impressionsToday: 1 });
    expect(b.todayCount('p')).toBe(1);
  });
  it('uses the larger of local and server day counts', () => {
    const b = createAdBudget({ now: () => T0, storage: mem() });
    expect(b.snapshot('p', 's', 9).impressionsToday).toBe(9);
  });
  it('rolls the day over at UTC midnight and keeps the count across a restart', async () => {
    let now = T0;
    const storage = mem();
    const b = createAdBudget({ now: () => now, storage });
    await b.hydrate('p');
    b.reserve('p').confirm();
    await Promise.resolve();
    const b2 = createAdBudget({ now: () => now, storage });
    await b2.hydrate('p');
    expect(b2.snapshot('p', 's').impressionsToday).toBe(1);
    now += 2 * 3600e3;
    expect(b2.snapshot('p', 's').impressionsToday).toBe(0);
  });
  it('tracks foreground time and starts a new session after the idle threshold', () => {
    let now = T0;
    const b = createAdBudget({ now: () => now, storage: mem() });
    now += 30e3;
    expect(b.foregroundMs()).toBe(30e3);
    b.reserve('p').confirm();
    b.background();
    now += 10 * 60e3;
    b.foreground();
    expect(b.foregroundMs()).toBe(30e3);
    expect(b.snapshot('p', 's').impressionsSession).toBe(1);
    b.background();
    now += 31 * 60e3;
    b.foreground();
    expect(b.foregroundMs()).toBe(0);
    expect(b.snapshot('p', 's').impressionsSession).toBe(0);
    expect(b.snapshot('p', 's').sessionsToday).toBeGreaterThanOrEqual(1);
  });
  it('remembers failures per surface and Remove ads taps per profile', async () => {
    let now = T0;
    const storage = mem();
    const b = createAdBudget({ now: () => now, storage });
    b.noteFailure('friends');
    b.noteRemoveAds('p');
    expect(b.snapshot('p', 'friends').lastFailureAt).toBe(T0);
    expect(b.snapshot('p', 'activity').lastFailureAt).toBe(0);
    expect(b.snapshot('q', 'activity').removeAdsTappedAt).toBe(0);
    const b2 = createAdBudget({ now: () => now, storage });
    await b2.hydrate('p');
    expect(b2.snapshot('p', 'x').removeAdsTappedAt).toBe(T0);
  });
});
