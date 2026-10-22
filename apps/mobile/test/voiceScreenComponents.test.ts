import { beforeEach, expect, it, vi } from 'vitest';
import { AccessibilityInfo } from 'react-native';
import { findAll, renderHook, textOf, type FakeElement } from './support/fakeReact';
import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import { FloatingMicrophone } from '@/components/voice/FloatingMicrophone';
import { LiveTranscript } from '@/components/voice/LiveTranscript';
import { VoiceStatus } from '@/components/voice/VoiceStatus';
import {
  VoiceSuggestions,
  suggestionWords,
  type Suggestion,
} from '@/components/voice/VoiceSuggestions';
import { ExpensePreviewCard, type ExpensePreview } from '@/components/voice/ExpensePreviewCard';
import { VoiceErrorState } from '@/components/voice/VoiceErrorState';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Platform: { OS: 'ios' },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'Animated.View' },
  useAnimatedStyle: (f: () => unknown) => f(),
  withTiming: (v: unknown) => v,
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@waves/ui', () => ({
  Text: 'Text',
  Button: 'Button',
  MoneyText: 'MoneyText',
  iconSize: { sm: 16, md: 20, base: 24, lg: 28, xl: 32 },
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
    radius: { md: 8, lg: 12, xl: 20, pill: 99 },
    scheme: 'light',
    tint: new Proxy({}, { get: () => ({ bg: '#eef', ink: '#115', inkMuted: '#447' }) }),
    shadow: { soft: {} },
    color: new Proxy({}, { get: () => '#123456' }),
  }),
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/i18n')>();
  return { ...actual, useStrings: () => ({ locale: 'en-IN', t: actual.STRINGS_BY_LANGUAGE.en }) };
});
vi.mock('@/lib/currency', () => ({ useDefaultCurrency: () => 'INR' }));
vi.mock('@/components/Category', () => ({ CategoryBadge: 'CategoryBadge' }));

const words = STRINGS_BY_LANGUAGE.en.voiceScreen;
const nodes = (tree: unknown, type: string) => findAll(tree, (n) => n.type === type);
const named = (tree: unknown, name: string) =>
  findAll(tree, (n) => typeof n.type === 'function' && n.type.name === name);
const press = (node: FakeElement) => (node.props.onPress as () => void)();
const mic = (mode: 'start' | 'stop' | 'busy' | 'retry', extra = {}) =>
  renderHook(() =>
    FloatingMicrophone({
      mode,
      label: mode === 'stop' ? 'Stop recording' : 'Start recording',
      reduceMotion: false,
      onPress: vi.fn(),
      ...extra,
    }),
  ).result.current;
const suggestions: Suggestion[] = [
  { icon: 'cafe-outline', kind: 'expense', text: '“Coffee 80”' },
  { icon: 'restaurant-outline', kind: 'expense', text: '“Dinner 800”' },
  { icon: 'people-outline', kind: 'question', text: '“Who owes me?”' },
];
const preview: ExpensePreview = {
  description: 'Dinner',
  amountMinor: 80000n,
  amountText: '800',
  currency: 'INR',
  category: 'food',
};
const splitText = 'Split equally with: You, Ravi';
// fakeReact is shallow: render the card's Line and Chip helpers explicitly.
function expand(tree: unknown): unknown {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== 'object' || !('type' in tree)) return tree;
  const node = tree as FakeElement;
  if (typeof node.type === 'function') {
    const component = node.type as (props: Record<string, unknown>) => unknown;
    const rendered = renderHook(() => component(node.props));
    const result = expand(rendered.result.current);
    rendered.unmount();
    return result;
  }
  return { ...node, props: { ...node.props, children: expand(node.props.children) } };
}

beforeEach(() => vi.clearAllMocks());

it('VC-01: microphone stop shows stop icon and label and forwards presses', () => {
  const onPress = vi.fn();
  const tree = mic('stop', { onPress });
  expect(nodes(tree, 'Ionicons')[0].props.name).toBe('stop');
  expect(nodes(tree, 'Pressable')[0].props.accessibilityLabel).toBe('Stop recording');
  press(nodes(tree, 'Pressable')[0]);
  expect(onPress).toHaveBeenCalledTimes(1);
});
it.each(['start', 'retry'] as const)('VC-02: %s shows a microphone', (mode) => {
  expect(nodes(mic(mode), 'Ionicons')[0].props.name).toBe('mic');
});
it('VC-03: busy replaces icon with spinner and disables double taps', () => {
  const tree = mic('busy');
  expect(nodes(tree, 'ActivityIndicator')).toHaveLength(1);
  expect(nodes(tree, 'Ionicons')).toHaveLength(0);
  expect(nodes(tree, 'Pressable')[0].props.disabled).toBe(true);
  expect(nodes(tree, 'Pressable')[0].props.accessibilityState).toEqual({
    busy: true,
    disabled: true,
  });
});
it('VC-04: level ring needs real levels and respects reduced motion', () => {
  expect(named(mic('stop', { level: { value: 0.5 } }), 'LevelRing')).toHaveLength(1);
  expect(
    named(mic('stop', { level: { value: 0.5 }, reduceMotion: true }), 'LevelRing'),
  ).toHaveLength(0);
  expect(named(mic('stop'), 'LevelRing')).toHaveLength(0);
});
it('VC-05: status has text, icon, polite live region and announces once per change', () => {
  const card = renderHook((props: Parameters<typeof VoiceStatus>[0]) => VoiceStatus(props), {
    props: { status: 'listening', text: 'Listening' },
  });
  expect(textOf(card.result.current)).toBe('Listening');
  expect(nodes(card.result.current, 'Ionicons')[0].props.name).toBe('bar-chart');
  expect(nodes(card.result.current, 'View')[0].props.accessibilityLiveRegion).toBe('polite');
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledExactlyOnceWith('Listening');
  card.rerender();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
  card.rerender({ status: 'processing', text: 'Understanding' });
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Understanding');
  card.rerender();
  expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
  card.unmount();
});
it('VC-06: transcript hides empty text unless reserving flexible space', () => {
  expect(renderHook(() => LiveTranscript({ text: '', final: false })).result.current).toBeNull();
  const tree = renderHook(() => LiveTranscript({ text: '', final: false, reserve: true })).result
    .current;
  expect(textOf(tree)).toBe('');
  expect(nodes(tree, 'Pressable')[0].props.style).toMatchObject({ minHeight: 76 });
});
it('VC-07: no caption; the words are the card, and only final editable text can be tapped to edit', () => {
  const onEdit = vi.fn();
  const partial = renderHook(() => LiveTranscript({ text: 'Coffee', final: false, onEdit })).result
    .current;
  expect(textOf(partial)).toBe('“Coffee”');
  expect(nodes(partial, 'Pressable')[0].props.disabled).toBe(true);
  expect(nodes(partial, 'Pressable')[0].props.accessibilityLabel).toContain(words.hearing);
  const final = renderHook(() => LiveTranscript({ text: 'Coffee', final: true, onEdit })).result
    .current;
  expect(textOf(final)).toBe('“Coffee”');
  expect(nodes(final, 'Pressable')[0].props.accessibilityLabel).toContain(words.editHeard);
  press(nodes(final, 'Pressable')[0]);
  expect(onEdit).toHaveBeenCalledTimes(1);
  const readOnly = renderHook(() => LiveTranscript({ text: 'Coffee', final: true })).result.current;
  expect(nodes(readOnly, 'Pressable')[0].props.disabled).toBe(true);
});
it('VC-08: long transcripts are passed whole without truncation', () => {
  const text = 'Coffee with Ravi and Anu after dinner. '.repeat(40).trim();
  const tree = renderHook(() => LiveTranscript({ text, final: true })).result.current;
  expect(textOf(tree)).toContain(text);
  for (const node of nodes(tree, 'Text')) expect(node.props).not.toHaveProperty('numberOfLines');
});
it('VC-09: three suggestion rows are read-only without onPick and all actionable by default with it', () => {
  const tree = renderHook(() => VoiceSuggestions({ suggestions })).result.current;
  expect(nodes(tree, 'Pressable')).toHaveLength(0);
  for (const row of suggestions)
    expect(nodes(tree, 'Text').filter((n) => n.props.children === row.text)).toHaveLength(1);
  const onPick = vi.fn();
  const buttons = nodes(
    renderHook(() => VoiceSuggestions({ suggestions, onPick })).result.current,
    'Pressable',
  );
  expect(buttons).toHaveLength(3);
  buttons.forEach(press);
  expect(onPick.mock.calls).toEqual(suggestions.map((row) => [row]));
});
it('VC-10: canPick restricts rows and tapping returns the original suggestion', () => {
  const onPick = vi.fn();
  const tree = renderHook(() =>
    VoiceSuggestions({ suggestions, onPick, canPick: (row) => row.kind === 'question' }),
  ).result.current;
  const buttons = nodes(tree, 'Pressable');
  expect(buttons).toHaveLength(1);
  press(buttons[0]);
  expect(onPick).toHaveBeenCalledExactlyOnceWith(suggestions[2]);
  const noHandler = renderHook(() => VoiceSuggestions({ suggestions, canPick: () => true })).result
    .current;
  expect(nodes(noHandler, 'Pressable')).toHaveLength(0);
});
it('VC-11: suggestionWords removes surrounding curly quotes and keeps internal words', () => {
  expect(suggestionWords('  “Coffee with Ravi”  ')).toBe('Coffee with Ravi');
  expect(suggestionWords('“Ravi’s coffee”')).toBe('Ravi’s coffee');
  expect(suggestionWords('Coffee')).toBe('Coffee');
});
it('VC-12: preview keeps description, money and one tappable split line, nothing else', () => {
  const onEdit = vi.fn();
  const onSplit = vi.fn();
  const onPaidBy = vi.fn();
  const shallow = renderHook(() =>
    ExpensePreviewCard({
      preview,
      locale: 'en-IN',
      onEdit,
      split: { text: splitText, paidBy: 'Paid by Ravi', onPress: onSplit, onPaidBy },
    }),
  ).result.current;
  expect(nodes(shallow, 'MoneyText')[0].props).toMatchObject({
    amount: 80000n,
    currency: 'INR',
    locale: 'en-IN',
  });
  expect(nodes(shallow, 'CategoryBadge')[0].props.category).toBe('food');
  const tree = expand(shallow);
  for (const label of ['Dinner', splitText, 'Paid by Ravi']) expect(textOf(tree)).toContain(label);
  // No category line, participant chips or split-type line to repeat the split.
  for (const label of [words.category, 'Equally', 'Change split', 'Food'])
    expect(textOf(tree)).not.toContain(label);
  const buttons = nodes(tree, 'Pressable');
  expect(buttons).toHaveLength(3);
  buttons.forEach(press);
  expect([onEdit, onSplit, onPaidBy].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
});
it('VC-13: no split line without a split; the split line is read-only without a handler', () => {
  const none = expand(
    renderHook(() => ExpensePreviewCard({ preview, locale: 'en-IN', split: null })).result.current,
  );
  expect(textOf(none)).not.toContain('Split');
  const plain = expand(
    renderHook(() => ExpensePreviewCard({ preview, locale: 'en-IN', split: { text: splitText } }))
      .result.current,
  );
  expect(textOf(plain)).toContain(splitText);
  expect(nodes(plain, 'Pressable').every((n) => n.props.disabled === true)).toBe(true);
});
it.each([
  { kind: 'permission', message: 'Denied', settings: true },
  { kind: 'permission', message: 'Denied', settings: false },
  { kind: 'error', message: 'Failed' },
] as const)('VC-14: one recovery action for %j opens settings or retries', (problem) => {
  const onRetry = vi.fn();
  const onOpenSettings = vi.fn();
  const settings = problem.kind === 'permission' && problem.settings;
  const tree = renderHook(() => VoiceErrorState({ problem, onRetry, onOpenSettings })).result
    .current;
  // One explanation and one primary action: typing is the header's keypad, not a second button here.
  const buttons = nodes(tree, 'Button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].props.label).toBe(settings ? words.openSettings : words.retry);
  press(buttons[0]);
  expect(settings ? onOpenSettings : onRetry).toHaveBeenCalledTimes(1);
  expect(settings ? onRetry : onOpenSettings).not.toHaveBeenCalled();
});
it('VC-15: text containers grow on small screens without fixed heights', () => {
  const trees = [
    mic('stop', { level: { value: 0.5 } }),
    renderHook(() =>
      LiveTranscript({
        text: 'Long words '.repeat(80),
        final: true,
        reserve: true,
        onEdit: vi.fn(),
      }),
    ).result.current,
    renderHook(() => VoiceStatus({ status: 'ready', text: 'Ready' })).result.current,
    renderHook(() => VoiceSuggestions({ suggestions, onPick: vi.fn() })).result.current,
    expand(renderHook(() => ExpensePreviewCard({ preview, locale: 'en-IN' })).result.current),
    renderHook(() =>
      VoiceErrorState({
        problem: { kind: 'error', message: 'Failed' },
        onRetry: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    ).result.current,
  ];
  for (const tree of trees) {
    // Fixed icon squares and the microphone are intentional; check Text and
    // every ancestor that actually contains text instead of decorative boxes.
    for (const node of findAll(tree, (n) => n.type === 'Text' || textOf(n).length > 0)) {
      const style =
        typeof node.props.style === 'function'
          ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false })
          : node.props.style;
      for (const part of [style].flat(Infinity)) {
        if (part && typeof part === 'object') expect(part).not.toHaveProperty('height');
      }
    }
  }
});
