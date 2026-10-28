import { describe, expect, it, vi } from 'vitest';

import { createOnceGate, openDeepLink, stackForPath } from '../src/lib/deepLink';

describe('stackForPath', () => {
  it('puts the group under an expense', () => {
    expect(stackForPath('/group/g1/expense/e1')).toEqual(['/group/g1', '/group/g1/expense/e1']);
  });
  it('puts the group under settle and company entry', () => {
    expect(stackForPath('/group/g1/settle')).toEqual(['/group/g1', '/group/g1/settle']);
    expect(stackForPath('/group/g1/company-entry?x=1')).toEqual([
      '/group/g1',
      '/group/g1/company-entry?x=1',
    ]);
  });
  it('leaves a group, join and plain screens alone', () => {
    expect(stackForPath('/group/g1')).toEqual(['/group/g1']);
    expect(stackForPath('/join?token=a')).toEqual(['/join?token=a']);
    expect(stackForPath('/activity')).toEqual(['/activity']);
  });
});

describe('openDeepLink', () => {
  it('dismisses to Home then pushes each step', () => {
    const r = { canDismiss: () => true, dismissAll: vi.fn(), push: vi.fn() };
    openDeepLink(r, '/group/g1/expense/e1');
    expect(r.dismissAll).toHaveBeenCalledOnce();
    expect(r.push.mock.calls.map((c) => c[0])).toEqual(['/group/g1', '/group/g1/expense/e1']);
  });
  it('skips dismiss when there is nothing to dismiss', () => {
    const r = { canDismiss: () => false, dismissAll: vi.fn(), push: vi.fn() };
    openDeepLink(r, '/activity');
    expect(r.dismissAll).not.toHaveBeenCalled();
    expect(r.push).toHaveBeenCalledWith('/activity');
  });
});

describe('createOnceGate', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    };
  };
  it('admits an id once', async () => {
    const once = createOnceGate(mem());
    expect(await once('a')).toBe(true);
    expect(await once('a')).toBe(false);
    expect(await once('b')).toBe(true);
  });
  it('refuses an id a previous process handled', async () => {
    const store = mem();
    await createOnceGate(store)('a');
    expect(await createOnceGate(store)('a')).toBe(false);
  });
  it('still dedupes in memory when storage throws', async () => {
    const bad = { getItem: async () => { throw new Error('x'); }, setItem: async () => {} };
    const once = createOnceGate(bad);
    expect(await once('a')).toBe(true);
    expect(await once('a')).toBe(false);
  });
});
