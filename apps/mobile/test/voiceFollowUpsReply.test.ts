/**
 * The follow-up card's mic: a spoken answer takes the same path as a typed one
 * (a chip it names is pressed on the phone, anything else costs one model turn
 * up to the cap), the mic hides offline and at the cap, and a refused mic falls
 * back to typing. Shallow render through the synchronous fake React.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, findAll, flush, renderHook, textOf } from './support/fakeReact';

import { VoiceFollowUps, type VoiceFollowUpsProps } from '@/components/VoiceFollowUps';
import type { SavedState } from '@/lib/followUpApply';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const world = vi.hoisted(() => ({
  online: true,
  handlers: null as null | {
    onText?: (t: string) => void;
    onCaptured: () => void;
    onEnd: (o: { kind: string; text?: string }) => void;
  },
  run: { stop: vi.fn(), cancel: vi.fn() },
  starts: 0,
  send: vi.fn(),
  upsert: vi.fn(),
  prefsUpdate: vi.fn(),
  question: { kind: 'payment', score: 50, places: [], hereNow: false, partners: [] } as unknown,
}));

const WORDS: Record<string, string> = { payCash: 'Cash', payUpi: 'UPI', payCard: 'Card' };
const labelled = (key: string | symbol): unknown =>
  typeof key === 'string' ? (WORDS[key] ?? key) : undefined;
const deep = (): unknown => new Proxy({}, { get: (_t, key) => labelled(key) });

vi.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@waves/ui', () => ({
  Button: 'Button',
  Text: 'Text',
  iconSize: { base: 16 },
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12 },
    radius: { pill: 99, lg: 12 },
    color: new Proxy({}, { get: () => '#000' }),
  }),
}));
vi.mock('@waves/core', async () => ({
  ...(await vi.importActual<object>('@waves/core')),
  materialiseExpenses: () => [],
  materialiseGroups: () => [],
  materialiseMembers: () => [],
  nextFollowUp: () => world.question,
}));
vi.mock('@/components/VoiceTypedAnswer', () => ({ VoiceTypedAnswer: 'VoiceTypedAnswer' }));
vi.mock('@/data/hooks', () => ({
  useOpenReceipts: () => [],
  useDeleteExpense: () => ({ mutateAsync: vi.fn() }),
  useWriteExpense: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/data/personal', () => ({
  usePersonalLedger: () => ({ txns: [], recurrings: [] }),
  useDeletePersonalRecord: () => ({ mutateAsync: vi.fn() }),
  useUpsertPersonalRecord: () => ({
    mutateAsync: (...args: unknown[]) => world.upsert(...args),
  }),
}));
vi.mock('@/data/types', () => ({ isViewer: () => false }));
vi.mock('@/i18n', () => ({
  fill: (template: string, values: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k])),
  useStrings: () => ({ locale: 'en-IN', t: { followUps: deep(), voice: deep(), categories: {} } }),
}));
vi.mock('@/lib/auth', () => ({ useViewerId: () => 'u1' }));
vi.mock('@/lib/followUpHistory', () => ({
  buildFollowUpHistory: () => ({ stats: { recentPlaces: [] }, placeCoords: {} }),
}));
vi.mock('@/lib/followUpPrefs', () => ({
  useFollowUpPrefs: () => ({ prefs: {}, ready: true, update: world.prefsUpdate }),
}));
vi.mock('@/lib/location', () => ({ currentPlaceIfGranted: async () => null }));
vi.mock('@/lib/navigation', () => ({ router: { push: vi.fn() } }));
vi.mock('@/lib/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/voiceStream', () => ({ checkOnline: async () => world.online }));
vi.mock('@/lib/voiceAgent', () => ({
  sendVoiceTranscript: (...args: unknown[]) => world.send(...args),
}));
vi.mock('@/lib/voiceAgentHandoff', () => ({ encodeAgentSplitParams: () => ({}) }));
vi.mock('@/sync', () => ({
  useSync: () => ({ mirror: {}, queue: [] }),
  syncEngine: { saveDraft: vi.fn() },
}));
vi.mock('@/lib/voiceReplyEngine', () => ({
  deviceReplyEngine: {
    supported: () => true,
    start: (_context: unknown, handlers: NonNullable<typeof world.handlers>) => {
      world.starts += 1;
      world.handlers = handlers;
      return world.run;
    },
  },
}));

const initial: SavedState = {
  kind: 'personal',
  id: 'p1',
  groupId: null,
  description: 'shoes',
  amount: 80000n,
  currency: 'INR',
  category: 'shopping',
  categoryStated: false,
  date: '2026-10-19',
  notes: null,
  place: null,
  location: null,
  paymentMethod: null,
  payers: null,
  hasReceipt: false,
  reimbursable: false,
  participants: [],
};

const props = (over: Partial<VoiceFollowUpsProps> = {}): VoiceFollowUpsProps => ({
  initial,
  groupWrite: null,
  local: { groups: [] } as unknown as VoiceFollowUpsProps['local'],
  today: '2026-10-19',
  onClose: vi.fn(),
  ...over,
});

const mount = async (over: Partial<VoiceFollowUpsProps> = {}) => {
  const card = renderHook((p: VoiceFollowUpsProps) => VoiceFollowUps(p), { props: props(over) });
  await flush();
  return card;
};
const named = (tree: unknown, name: string) =>
  findAll(tree, (n) => typeof n.type === 'function' && n.type.name === name);

beforeEach(() => {
  world.online = true;
  world.handlers = null;
  world.starts = 0;
  world.run = { stop: vi.fn(), cancel: vi.fn() };
  world.send.mockReset();
  world.upsert.mockReset();
  world.upsert.mockResolvedValue(undefined);
  world.question = { kind: 'payment', score: 50, places: [], hereNow: false, partners: [] };
});

describe('follow-up card voice reply', () => {
  it('MC-FU-30 shows a mic link with an a11y label; tapping it starts listening', async () => {
    const card = await mount();
    const [mic] = named(card.result.current, 'MicLink');
    expect(mic?.props.label).toBe('voiceAnswer');
    act(() => (mic?.props.onPress as () => void)());
    expect(world.starts).toBe(1);
    const [row] = named(card.result.current, 'ListeningRow');
    expect(row?.props.transcribing).toBe(false);
    expect(named(card.result.current, 'MicLink')).toHaveLength(0);
  });

  it('MC-FU-31 idle -> listening -> transcribing -> answered: a spoken chip name is pressed on the phone, no model turn', async () => {
    const card = await mount();
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => world.handlers?.onText?.('ca'));
    expect(named(card.result.current, 'ListeningRow')[0]?.props.heard).toBe('ca');
    act(() => world.handlers?.onCaptured());
    expect(named(card.result.current, 'ListeningRow')[0]?.props.transcribing).toBe(true);
    act(() => world.handlers?.onEnd({ kind: 'text', text: 'cash' }));
    await flush();
    expect(world.send).not.toHaveBeenCalled();
    expect(world.upsert).toHaveBeenCalledTimes(1);
    expect(named(card.result.current, 'ListeningRow')).toHaveLength(0);
  });

  it('MC-FU-32 a spoken answer no chip names goes to the model once, as the typed one does', async () => {
    world.send.mockResolvedValue({
      kind: 'ok',
      response: { update: { expenseId: 'p1', note: 'with Anu' } },
    });
    const card = await mount();
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => world.handlers?.onEnd({ kind: 'text', text: 'it was a gift for Anu' }));
    await flush();
    expect(world.send).toHaveBeenCalledTimes(1);
    const call = world.send.mock.calls[0]?.[0] as {
      transcript: string;
      savedExpense: { id: string; question: string };
    };
    expect(call.transcript).toBe('it was a gift for Anu');
    expect(call.savedExpense.id).toBe('p1');
    expect(call.savedExpense.question).toBe('paymentAsk');
  });

  it('MC-FU-33 the source is reported for voice and typed answers', async () => {
    const seen: string[] = [];
    const card = await mount({ onAnswerSource: (s, via) => seen.push(`${s}:${via}`) });
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => world.handlers?.onEnd({ kind: 'text', text: 'upi' }));
    await flush();
    // A refused mic opens the typed field; the same words typed take the same path.
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => world.handlers?.onEnd({ kind: 'denied' }));
    await flush();
    const [typed] = findAll(card.result.current, (n) => n.type === 'VoiceTypedAnswer');
    act(() => (typed?.props.onSubmit as (text: string) => void)('cash'));
    await flush();
    expect(seen).toEqual(['voice:chip', 'typed:chip']);
    expect(world.send).not.toHaveBeenCalled();
  });

  it('MC-FU-34 offline hides the mic and Type instead and shows the caption', async () => {
    world.online = false;
    const card = await mount();
    expect(named(card.result.current, 'MicLink')).toHaveLength(0);
    const labels = named(card.result.current, 'SmallLink').map((n) => n.props.label);
    expect(labels).not.toContain('typeInstead');
    expect(textOf(card.result.current)).toContain('typingOffline');
  });

  it('MC-FU-35 a refused microphone opens typing with a hint, no crash', async () => {
    const card = await mount();
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => world.handlers?.onEnd({ kind: 'denied' }));
    await flush();
    expect(findAll(card.result.current, (n) => n.type === 'VoiceTypedAnswer')).toHaveLength(1);
    expect(textOf(card.result.current)).toContain('micDenied');
  });

  it('MC-FU-36 an empty transcript shows the retry hint and the mic stays', async () => {
    const card = await mount();
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => world.handlers?.onEnd({ kind: 'empty' }));
    expect(textOf(card.result.current)).toContain('noSpeech');
    expect(named(card.result.current, 'MicLink')).toHaveLength(1);
    expect(world.send).not.toHaveBeenCalled();
  });

  it('MC-FU-37 unmounting the card stops the recorder', async () => {
    const card = await mount();
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    card.unmount();
    expect(world.run.cancel).toHaveBeenCalledTimes(1);
  });

  it('MC-FU-38 three model turns is the cap: the mic goes, the fourth answer is refused', async () => {
    world.send.mockResolvedValue({ kind: 'ok', response: {} });
    const card = await mount();
    for (let i = 0; i < 3; i++) {
      act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
      act(() => world.handlers?.onEnd({ kind: 'text', text: `something odd ${i}` }));
      await flush();
    }
    expect(world.send).toHaveBeenCalledTimes(3);
    expect(named(card.result.current, 'MicLink')).toHaveLength(0);
    expect(textOf(card.result.current)).toContain('turnsUsed');
    const typed = findAll(card.result.current, (n) => n.type === 'VoiceTypedAnswer');
    expect(typed).toHaveLength(0);
  });

  it('MC-FU-39 Stop ends the clip through the row button', async () => {
    const card = await mount();
    act(() => (named(card.result.current, 'MicLink')[0]?.props.onPress as () => void)());
    act(() => (named(card.result.current, 'ListeningRow')[0]?.props.onStop as () => void)());
    expect(world.run.stop).toHaveBeenCalledTimes(1);
  });
});
