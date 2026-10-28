import { describe, expect, it, vi } from 'vitest';

import {
  createOnceGate,
  noteExternalLink,
  openDeepLink,
  queueDeepLink,
  stackForPath,
  takeExternalLink,
  takeQueuedDeepLink,
} from '../src/lib/deepLink';

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
  it('resets to Home then pushes each step', () => {
    const r = { dismissTo: vi.fn(), push: vi.fn() };
    openDeepLink(r, '/group/g1/expense/e1');
    expect(r.dismissTo).toHaveBeenCalledWith('/');
    expect(r.push.mock.calls.map((c) => c[0])).toEqual(['/group/g1', '/group/g1/expense/e1']);
  });
  it('still pushes when dismissTo throws', () => {
    const r = {
      dismissTo: vi.fn(() => {
        throw new Error('x');
      }),
      push: vi.fn(),
    };
    openDeepLink(r, '/activity');
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
    const bad = {
      getItem: async () => {
        throw new Error('x');
      },
      setItem: async () => {},
    };
    const once = createOnceGate(bad);
    expect(await once('a')).toBe(true);
    expect(await once('a')).toBe(false);
  });
});

describe('back from a deep-linked expense', () => {
  it('lands on its group, and re-handling the same tap does nothing', async () => {
    const stack: string[] = ['/'];
    const r = {
      dismissTo: () => void stack.splice(1),
      push: (h: string) => void stack.push(h),
    };
    const once = createOnceGate({ getItem: async () => null, setItem: async () => {} });
    for (let i = 0; i < 2; i++) {
      if (await once('n1')) openDeepLink(r, '/group/g1/expense/e1');
    }
    expect(stack).toEqual(['/', '/group/g1', '/group/g1/expense/e1']);
    stack.pop(); // header back arrow
    expect(stack.at(-1)).toBe('/group/g1');
  });
});

describe('entry-point targets', () => {
  it.each<[string, string, string[]]>([
    ['notification expense', '/group/g1/expense/e1', ['/group/g1', '/group/g1/expense/e1']],
    ['watch/widget add-expense', '/group/g1/add-expense', ['/group/g1', '/group/g1/add-expense']],
    ['shortcut scan', '/capture?scan=1', ['/capture?scan=1']],
    ['shortcut voice', '/voice', ['/voice']],
    ['share receipt', '/capture?receipt=k&shared=1', ['/capture?receipt=k&shared=1']],
    ['invite', '/join?token=t', ['/join?token=t']],
  ])('%s', (_n, path, stack) => {
    expect(stackForPath(path)).toEqual(stack);
  });
});

describe('external link note', () => {
  it('re-seats a group link once, only on its own path, and expires', () => {
    noteExternalLink('waves://group/g1/expense/e1', 0);
    expect(takeExternalLink('/group/g1', 1)).toBeNull();
    expect(takeExternalLink('/group/g1/expense/e1', 1)).toBe('/group/g1/expense/e1');
    expect(takeExternalLink('/group/g1/expense/e1', 1)).toBeNull();
    noteExternalLink('waves://group/g1', 0);
    expect(takeExternalLink('/group/g1', 20_000)).toBeNull();
  });
  it('ignores non-group links', () => {
    noteExternalLink('waves://capture?scan=1', 0);
    expect(takeExternalLink('/capture', 1)).toBeNull();
  });
});

describe('queued link', () => {
  it('is taken once', async () => {
    const m = new Map<string, string>();
    const st = {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
      removeItem: async (k: string) => void m.delete(k),
    };
    await queueDeepLink(st, '/group/g1');
    expect(await takeQueuedDeepLink(st)).toBe('/group/g1');
    expect(await takeQueuedDeepLink(st)).toBeNull();
  });
});
