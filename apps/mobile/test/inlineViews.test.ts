import { beforeEach, it, expect, vi } from 'vitest';
import { renderHook, findAll, textOf, flush, act } from './support/fakeReact';
import { InlineSpendingList } from '../src/components/assistant/inline/InlineSpendingList';
import { InlineLoanShare } from '../src/components/assistant/inline/InlineLoanShare';
import { InlinePeopleSheet } from '../src/components/assistant/inline/InlinePeopleSheet';
import { InlineItemizeSheet } from '../src/components/assistant/inline/InlineItemizeSheet';
import { AssistantMoneyAnswer, AssistantAnswerCard } from '../src/components/AssistantAnswerCard';
import { SmallAction } from '../src/components/assistant/inline/SmallAction';
import { InlineSettle } from '../src/components/assistant/inline/InlineSettle';
import { STRINGS_BY_LANGUAGE } from '../src/i18n';
import { settlementFor, itemizeTotals } from '../src/lib/assistantInline';
vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
}));
vi.mock('@/components/PersonAvatar', () => ({ PersonAvatar: 'PersonAvatar' }));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@waves/ui', () => ({
  Button: 'Button',
  Sheet: 'Sheet',
  Text: 'Text',
  Avatar: 'Avatar',
  iconSize: { sm: 16 },
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12 },
    radius: { lg: 12, pill: 99 },
    color: new Proxy({}, { get: () => '#000' }),
  }),
}));
vi.mock('@/i18n', async () => {
  const a = await vi.importActual<any>('../src/i18n');
  return { ...a, useStrings: () => ({ t: a.STRINGS_BY_LANGUAGE.en, locale: 'en-IN' }) };
});
const w = vi.hoisted(() => ({
  share: vi.fn(),
  push: vi.fn(),
  answer: null as any,
  txns: [] as any[],
  transfers: [] as any[],
  record: vi.fn(),
}));
vi.mock('@/data/syncedLoans', () => ({ useShareLoan: () => ({ mutateAsync: w.share }) }));
vi.mock('@/data/personal', () => ({ usePersonalLedger: () => ({ txns: w.txns }) }));
vi.mock('@/lib/navigation', () => ({ router: { push: w.push } }));
vi.mock('@/lib/useAssistantAnswerer', () => ({
  useAssistantAnswerer: () => ({ answer: () => w.answer, answerFor: () => w.answer }),
}));
vi.mock('@/data/blocked', () => ({ useBlockedUsers: () => ({ blockedIds: new Set() }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'viewer' } }) }));
vi.mock('@/lib/guestGuard', () => ({ useGuestGuard: () => ({ blockWrite: () => false }) }));
vi.mock('@/lib/useRemind', () => ({
  useRemind: () => ({ reminded: false, pending: false, open: vi.fn(), sheet: null }),
}));
vi.mock('@/components/settle/SettleConfirmSheet', () => ({
  SettleConfirmSheet: 'SettleConfirmSheet',
}));
vi.mock('@/data/hooks', () => ({
  useGroup: () => ({
    group: {
      data: { id: 'g', name: 'Trip', default_currency: 'INR', country_code: 'IN' },
      isLoading: false,
    },
    members: { data: [], isLoading: false },
    everyone: { data: [] },
    expenses: { rows: [] },
  }),
  useGroupLedger: () => ({
    transfers: w.transfers,
    myMemberId: 'me',
    convertsToGroupCurrency: true,
  }),
  useRecordSettlement: () => ({ mutateAsync: w.record, isPending: false }),
  memberLookup: () => new Map(),
  toLedgerSnapshots: () => [],
}));
const s = STRINGS_BY_LANGUAGE.en.inline;
const nodes = (r: any, p: (n: any) => boolean) => findAll(r.result.current, p);
const label = (r: any, l: string) =>
  nodes(r, (n) => n.props.label === l || n.props.accessibilityLabel === l)[0]!;
const press = (r: any, l: string) =>
  act(() => {
    (label(r, l).props.onPress as any)();
  });
const button = (r: any) => nodes(r, (n) => n.type === 'Button').at(-1)!;
const people = [
  { id: 'me', name: 'Me', isViewer: true },
  { id: 'r', name: 'Ravi', isViewer: false },
];
const loan = {
  id: 'loan',
  direction: 'lent',
  counterpart: 'Ravi',
  principal: 10000n,
  currency: 'INR',
  note: null,
  startDate: '2026-10-01',
  status: 'active',
} as const;
beforeEach(() => {
  vi.clearAllMocks();
  w.share.mockReset().mockResolvedValue(undefined);
  w.record.mockReset().mockResolvedValue(undefined);
  w.txns = [];
  w.transfers = [];
  w.answer = {
    text: 'Your spend',
    chips: [{ key: 'lastMonth', label: 'Last month', selected: false }],
    link: {
      kind: 'spending',
      label: 'Show in Spending',
      params: { kind: 'expense', category: 'food' },
      pathname: '/spending',
    },
  };
});
it('IN-V-01 spending preview shows five then seven, with Show all/less and informative row labels', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    kind: 'expense',
    note: `Lunch ${i}`,
    date: '2026-10-01',
    amount: 10000n,
    currency: 'INR',
    category: 'food',
  }));
  const r = renderHook(() => InlineSpendingList({ rows: rows as any }));
  const rowsOf = () => nodes(r, (n) => n.props.accessible === true);
  expect(rowsOf()).toHaveLength(5);
  expect(rowsOf()[0]!.props.accessibilityLabel).toMatch(/Lunch 0, .*Oct.*, .*100/);
  const action = label(r, 'Show all (7)');
  const a11y = renderHook(() => SmallAction(action.props as any));
  expect(nodes(a11y, (n) => n.type === 'Pressable')[0]!.props.accessibilityLabel).toBe(
    'Show all (7)',
  );
  a11y.unmount();
  press(r, 'Show all (7)');
  expect(rowsOf()).toHaveLength(7);
  press(r, 'Show less');
  expect(rowsOf()).toHaveLength(5);
  r.unmount();
});
it('IN-V-02 short and empty spending lists have no expansion action', () => {
  for (const count of [0, 5]) {
    const r = renderHook(() =>
      InlineSpendingList({
        rows: Array.from({ length: count }, (_, i) => ({
          id: String(i),
          note: 'Lunch',
          date: '2026-10-01',
          amount: 100n,
          currency: 'INR',
        })) as any,
      }),
    );
    expect(nodes(r, (n) => typeof n.props.label === 'string')).toHaveLength(0);
    if (!count) expect(textOf(r.result.current)).toBe('Nothing to show.');
    r.unmount();
  }
});
it('IN-V-03 spending answer expands matching personal entries, toggles accessibility and collapses on period change', () => {
  w.txns = [
    { id: 'yes', kind: 'expense', category: 'food', date: '2026-10-01' },
    { id: 'no', kind: 'income', category: 'food', date: '2026-10-01' },
  ];
  const r = renderHook(() => AssistantMoneyAnswer({ query: {} as any }));
  expect((r.result.current as any).props.expanded).toBe(false);
  act(() => {
    (r.result.current as any).props.onLink(w.answer.link);
  });
  expect((r.result.current as any).props.expanded).toBe(true);
  const list = nodes(r, (n) => n.type === InlineSpendingList)[0]!;
  expect(list.props.rows).toEqual([w.txns[0]]);
  const card = renderHook(() => AssistantAnswerCard((r.result.current as any).props));
  expect(label(card, 'Show in Spending').props.accessibilityState).toEqual({ expanded: true });
  press(card, 'Show in Spending');
  expect((r.result.current as any).props.expanded).toBe(false);
  act(() => {
    (r.result.current as any).props.onLink(w.answer.link);
    (r.result.current as any).props.onChip(w.answer.chips[0]);
  });
  expect((r.result.current as any).props.expanded).toBe(false);
  expect(w.push).not.toHaveBeenCalled();
  card.unmount();
  r.unmount();
});
it('IN-V-04 budget link navigates and calls onNavigate', () => {
  w.answer.link = {
    kind: 'budget',
    label: 'Set budget',
    pathname: '/budgets',
    params: { category: 'food' },
  };
  const navigate = vi.fn();
  const r = renderHook(() => AssistantMoneyAnswer({ query: {} as any, onNavigate: navigate }));
  (r.result.current as any).props.onLink(w.answer.link);
  expect(w.push).toHaveBeenCalledWith({ pathname: '/budgets', params: { category: 'food' } });
  expect(navigate).toHaveBeenCalledOnce();
  r.unmount();
});
it('IN-V-05 loan shares once on mount and shows shared outcome', async () => {
  const r = renderHook(() => InlineLoanShare({ loan, loans: [loan] }));
  await flush();
  r.rerender();
  expect(w.share).toHaveBeenCalledExactlyOnceWith({ loan, person: { name: 'Ravi' } });
  expect(textOf(r.result.current)).toContain('Shared with Ravi ✓');
  r.unmount();
});
it('IN-V-06 share failure retries once despite a second pending press', async () => {
  w.share.mockRejectedValueOnce(Error());
  const r = renderHook(() => InlineLoanShare({ loan, loans: [loan] }));
  await flush();
  const retry = label(r, 'Try again');
  let resolve!: () => void;
  w.share.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  act(() => {
    (retry.props.onPress as any)();
    (retry.props.onPress as any)();
  });
  expect(w.share).toHaveBeenCalledTimes(2);
  resolve();
  await flush();
  expect(textOf(r.result.current)).toContain('Shared with Ravi ✓');
  r.unmount();
});
function peopleProps(extra = {}) {
  return {
    visible: true,
    title: 'People',
    confirmLabel: 'Split',
    groups: [
      { id: 'g', name: 'Trip' },
      { id: 'h', name: 'Home' },
    ],
    initialGroupId: 'g',
    peopleOf: () => people,
    initialSelected: ['me'],
    minOthers: 1,
    busy: false,
    error: null,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
}
it('IN-V-07 people sheet requires another person, locks self and confirms group with picked ids', () => {
  const props = peopleProps();
  const r = renderHook(() => InlinePeopleSheet(props));
  expect(button(r).props.disabled).toBe(true);
  expect(label(r, s.you).props.disabled).toBe(true);
  press(r, s.you);
  expect(label(r, s.you).props.selected).toBe(true);
  press(r, 'Ravi');
  expect(button(r).props.disabled).toBe(false);
  press(r, 'Split');
  /* Split plans add the locked viewer; the sheet returns the other picks. */ expect(
    props.onConfirm,
  ).toHaveBeenCalledWith('g', ['r']);
  r.unmount();
});
it('IN-V-08 optional self can be removed, group change resets picks and retry is disabled while busy', () => {
  const props = peopleProps({ selfOptional: true });
  const r = renderHook(() => InlinePeopleSheet(props));
  press(r, s.you);
  expect(label(r, s.you).props.selected).toBe(false);
  press(r, 'Ravi');
  press(r, 'Split');
  expect(props.onConfirm).toHaveBeenCalledWith('g', ['r']);
  press(r, 'Home');
  expect(label(r, 'Ravi').props.selected).toBe(false);
  r.unmount();
  const retry = renderHook(() =>
    InlinePeopleSheet(peopleProps({ initialSelected: ['me', 'r'], busy: true, error: 'Failed' })),
  );
  expect(button(retry).props.label).toBe('Try again');
  expect(button(retry).props.disabled).toBe(true);
  retry.unmount();
});
it('IN-V-09 itemize needs every line claimed; Everyone toggles all and totals equal saved amount', () => {
  const draft = { items: [{ label: 'Dinner', total: 9000n }], charges: 1000n };
  const props = {
    visible: true,
    draft,
    people,
    amount: 10000n,
    currency: 'INR',
    seed: 's',
    busy: false,
    error: null,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  };
  const r = renderHook(() => InlineItemizeSheet(props));
  expect(button(r).props.disabled).toBe(true);
  press(r, s.everyone);
  expect(button(r).props.disabled).toBe(false);
  expect(textOf(r.result.current)).toContain('Ravi');
  expect(textOf(r.result.current)).toContain('50.00');
  (button(r).props.onPress as any)();
  const claims = props.onConfirm.mock.calls[0]![0];
  expect(claims).toEqual({ 0: ['me', 'r'] });
  expect(
    [...itemizeTotals(draft, claims, 10000n, 'INR', 's')!.values()].reduce((a, b) => a + b, 0n),
  ).toBe(10000n);
  press(r, s.everyone);
  expect(button(r).props.disabled).toBe(true);
  r.unmount();
  const retry = renderHook(() => InlineItemizeSheet({ ...props, error: 'Failed' }));
  expect(button(retry).props.label).toBe('Try again');
  retry.unmount();
});
const transfers = [
  { from: 'r', to: 'me', amount: 100n, currency: 'INR' },
  { from: 'me', to: 'x', amount: 200n, currency: 'INR' },
  { from: 'r', to: 'me', amount: 300n, currency: 'USD' },
];
const settleRows = (r: any) =>
  nodes(r, (n) => typeof n.type === 'function' && n.type.name === 'SettleRow');
it('IN-V-10 settlement lists owed-to-me and I-owe but omits rateless transfers; confirms through sheet', async () => {
  w.transfers = transfers;
  const r = renderHook(() => InlineSettle({ groupId: 'g' }));
  const rows = settleRows(r);
  expect(rows).toHaveLength(2);
  expect(rows.map((n) => n.props.direction)).toEqual(['receive', 'pay']);
  const row = renderHook(() => (rows[0]!.type as any)(rows[0]!.props));
  press(row, s.recordPayment);
  const confirm = () => nodes(row, (n) => n.type === 'SettleConfirmSheet')[0]!.props as any;
  expect(confirm().visible).toBe(true);
  let resolve!: () => void;
  w.record.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  const c = confirm();
  act(() => {
    c.onConfirm();
    c.onConfirm();
  });
  expect(w.record).toHaveBeenCalledExactlyOnceWith(settlementFor('g', transfers[0]!, [], 'upi'));
  resolve();
  await flush();
  expect(settleRows(r)).toHaveLength(1);
  expect(textOf(r.result.current)).toContain('Payment recorded ✓');
  row.unmount();
  w.record.mockResolvedValue(undefined);
  await (settleRows(r)[0]!.props.onRecord as any)();
  expect(settleRows(r)).toHaveLength(0);
  expect(textOf(r.result.current)).toContain('All settled up ✓');
  r.unmount();
});
it('IN-V-11 settlement failure shows error and retains row for retry', async () => {
  w.transfers = [transfers[0]];
  w.record.mockRejectedValueOnce(Error());
  const r = renderHook(() => InlineSettle({ groupId: 'g' }));
  await (settleRows(r)[0]!.props.onRecord as any)();
  await flush();
  expect(textOf(r.result.current)).toContain(s.settleFailed);
  expect(settleRows(r)).toHaveLength(1);
  await (settleRows(r)[0]!.props.onRecord as any)();
  await flush();
  expect(settleRows(r)).toHaveLength(0);
  r.unmount();
});
