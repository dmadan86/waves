/**
 * Where the capture reminder is decided: `useNudgePassInputs`,
 * `useCaptureNudgePass` and the headless `<CaptureNudge />`.
 *
 * The planner decides *what* to do; these decide *when* a pass runs and what it
 * is told. The two rules that matter most: nothing runs until the mirror is off
 * disk (an empty inbox before hydrate is "not looked", and acting on it would
 * cancel tonight's reminder on every launch), and filing the last draft runs a
 * pass at once — the cancel must never wait for the next foreground.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '@/i18n';
import { CaptureNudge } from '@/lib/captureNudge/CaptureNudge';
import { NudgeKind } from '@/lib/captureNudge/plan';
import {
  useCaptureNudgePass,
  useNudgePassInputs,
  type NudgePassInputs,
} from '@/lib/captureNudge/useNudgePass';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const h = vi.hoisted(() => ({
  session: { user: { id: 'me' } } as { user: { id: string } } | null,
  captures: { data: [] as { created_at: string; parsed?: unknown }[], isLoading: false },
  groups: { data: [{ id: 'g1' }] as unknown[] | undefined, isLoading: false },
  sync: vi.fn(async (_input: Record<string, unknown>) => ({ action: 'keep' })),
  reportHandled: vi.fn(),
  appState: [] as ((state: string) => void)[],
  removed: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_e: string, listener: (state: string) => void) => {
      h.appState.push(listener);
      return { remove: h.removed };
    },
  },
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock('@/data/hooks', () => ({
  useCaptures: () => h.captures,
  useGroups: () => h.groups,
}));
vi.mock('@/lib/observability', () => ({ reportHandled: h.reportHandled }));
vi.mock('@/lib/captureNudge/run', () => ({ syncCaptureNudge: h.sync }));
vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n')>();
  return {
    ...actual,
    useStrings: () => ({ t: actual.STRINGS_BY_LANGUAGE.en, locale: 'en-IN', language: 'en' }),
  };
});

const en = STRINGS_BY_LANGUAGE.en;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { user: { id: 'me' } };
  h.captures = { data: [], isLoading: false };
  h.groups = { data: [{ id: 'g1' }], isLoading: false };
  h.appState.length = 0;
});

describe('useNudgePassInputs', () => {
  it('counts the waiting drafts and finds the oldest, skipping unreadable stamps', () => {
    h.captures.data = [
      { created_at: '2026-09-20T10:00:00Z' },
      { created_at: 'garbage' },
      { created_at: '2026-09-18T10:00:00Z' },
    ];
    const { result } = renderHook(() => useNudgePassInputs());
    expect(result.current).toEqual({
      ownerId: 'me',
      waitingCount: 3,
      oldestWaitingAt: Date.parse('2026-09-18T10:00:00Z'),
      locale: 'en-IN',
      hasGroup: true,
      ready: true,
    });
  });

  it('is not ready while either list is still loading, or with nobody signed in', () => {
    h.captures.isLoading = true;
    expect(renderHook(() => useNudgePassInputs()).result.current.ready).toBe(false);
    h.captures.isLoading = false;
    h.groups.isLoading = true;
    expect(renderHook(() => useNudgePassInputs()).result.current.ready).toBe(false);
    h.groups.isLoading = false;
    h.session = null;
    const signedOut = renderHook(() => useNudgePassInputs()).result.current;
    expect(signedOut.ready).toBe(false);
    expect(signedOut.ownerId).toBe('');
  });

  it('knows when there is no group to put anything in', () => {
    h.groups.data = undefined;
    expect(renderHook(() => useNudgePassInputs()).result.current.hasGroup).toBe(false);
  });

  it('has no oldest draft when none is waiting', () => {
    expect(renderHook(() => useNudgePassInputs()).result.current.oldestWaitingAt).toBeNull();
  });
});

describe('useCaptureNudgePass', () => {
  const inputs: NudgePassInputs = {
    ownerId: 'me',
    waitingCount: 2,
    oldestWaitingAt: 100,
    locale: 'en-IN',
    hasGroup: true,
    ready: true,
  };

  it('does nothing until the inputs are ready', () => {
    const { result } = renderHook(() => useCaptureNudgePass({ ...inputs, ready: false }));
    result.current();
    expect(h.sync).not.toHaveBeenCalled();
  });

  it('runs a pass with the inputs, and renders the words in the current language', () => {
    const { result } = renderHook(() => useCaptureNudgePass(inputs));
    result.current();
    expect(h.sync).toHaveBeenCalledTimes(1);
    const input = h.sync.mock.calls[0]![0] as {
      text: (kind: NudgeKind, count: number) => { title: string; body: string };
    } & Record<string, unknown>;
    expect(input).toMatchObject({
      ownerId: 'me',
      waitingCount: 2,
      oldestWaitingAt: 100,
      hasGroup: true,
    });
    expect(typeof input.now).toBe('number');

    expect(input.text(NudgeKind.CheckIn, 0)).toEqual({
      title: en.captures.checkInTitle,
      body: en.captures.checkInBody,
    });
    const captures = input.text(NudgeKind.Captures, 2);
    expect(captures.title).toBe(en.captures.nudgeTitle);
    expect(captures.body).toContain('2');
  });

  it('reports a pass that failed rather than throwing', async () => {
    h.sync.mockRejectedValueOnce(new Error('alarm refused'));
    const { result } = renderHook(() => useCaptureNudgePass(inputs));
    result.current();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'captureNudge.sync');
  });

  it('keeps the same callback while nothing it depends on moved', () => {
    const rendered = renderHook(() => useCaptureNudgePass(inputs));
    const first = rendered.result.current;
    rendered.rerender();
    expect(rendered.result.current).toBe(first);
  });
});

describe('<CaptureNudge />', () => {
  it('renders nothing and runs a pass on mount', () => {
    h.captures.data = [{ created_at: '2026-09-20T10:00:00Z' }];
    const { result } = renderHook(() => CaptureNudge());
    expect(result.current).toBeNull();
    expect(h.sync).toHaveBeenCalledTimes(1);
  });

  it('runs a pass at once when the last draft is filed', () => {
    h.captures.data = [{ created_at: '2026-09-20T10:00:00Z' }];
    const rendered = renderHook(() => CaptureNudge());
    h.captures = { data: [], isLoading: false };
    rendered.rerender();
    expect(h.sync).toHaveBeenCalledTimes(2);
    expect(h.sync.mock.calls[1]![0]).toMatchObject({ waitingCount: 0 });
  });

  it('runs a fresh pass on each foreground, with the latest count', () => {
    const rendered = renderHook(() => CaptureNudge());
    h.captures = { data: [{ created_at: '2026-09-20T10:00:00Z' }], isLoading: false };
    rendered.rerender();
    h.sync.mockClear();

    h.appState[0]!('background');
    expect(h.sync).not.toHaveBeenCalled();
    h.appState[0]!('active');
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.sync.mock.calls[0]![0]).toMatchObject({ waitingCount: 1 });
  });

  it('does not subscribe with nobody signed in, and unsubscribes on unmount', () => {
    h.session = null;
    renderHook(() => CaptureNudge());
    expect(h.appState).toHaveLength(0);

    h.session = { user: { id: 'me' } };
    const rendered = renderHook(() => CaptureNudge());
    expect(h.appState).toHaveLength(1);
    rendered.unmount();
    expect(h.removed).toHaveBeenCalledTimes(1);
  });
});
