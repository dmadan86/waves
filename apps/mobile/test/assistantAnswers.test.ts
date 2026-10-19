/**
 * On-device money answers: the app half of the assistant's spend questions
 * (`@waves/core` voice/spendQuery owns the parser and the arithmetic; its own
 * tests are SQ-01..SQ-23). Here: my-share extraction from the mirror, the
 * sentence in four languages, the period chips and the "Show in Spending" link,
 * and the card that renders them (SQ-24).
 */

import { describe, expect, it, vi } from 'vitest';

import type { PersonalBudget, PersonalTxn } from '@waves/core';

import { findAll, textOf } from './support/fakeReact';
import type { AnswerContext, AnswerGroupInput } from '../src/lib/assistantAnswers';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View' }));
vi.mock('@waves/ui', () => ({
  Text: 'Text',
  iconSize: { sm: 14 },
  useTheme: () => ({
    spacing: { sm: 8, md: 12 },
    radius: { lg: 16, pill: 999 },
    color: {
      border: '#ddd',
      surface: '#fff',
      bg: '#fafafa',
      brand: '#50f',
      brandSoft: '#eef',
      textMuted: '#666',
    },
  }),
}));
vi.mock('@/lib/navigation', () => ({ router: { push: vi.fn() } }));
vi.mock('@/lib/useAssistantAnswerer', () => ({ useAssistantAnswerer: () => ({}) }));

const { STRINGS_BY_LANGUAGE, LANGUAGES, fill } = await import('../src/i18n');
const {
  answerForPeriod,
  answerMoneyQuestion,
  compactMoney,
  groupExpensesForViewer,
  parseMoneyQuestion,
} = await import('../src/lib/assistantAnswers');
const { AssistantAnswerCard } = await import('../src/components/AssistantAnswerCard');

const TODAY = '2026-10-19';

function txn(
  over: Partial<PersonalTxn> & Pick<PersonalTxn, 'id' | 'amount' | 'date'>,
): PersonalTxn {
  return {
    kind: 'expense',
    currency: 'INR',
    category: 'food',
    note: null,
    loanId: null,
    recurringId: null,
    ...over,
  };
}

const goa: AnswerGroupInput = {
  id: 'g-goa',
  name: 'Goa trip',
  archived: false,
  myMemberIds: ['m-me'],
  expenses: [
    {
      id: 'e1',
      deleted: false,
      description: 'Beach shack dinner',
      notes: null,
      payee: null,
      category: 'food',
      categoryLabel: null,
      date: '2026-10-12',
      currency: 'INR',
      shares: [
        { memberId: 'm-me', amount: '40000' },
        { memberId: 'm-anu', amount: '80000' },
      ],
      memberNames: ['Me', 'Anu'],
    },
    {
      id: 'e2',
      deleted: true,
      description: 'Deleted lunch',
      notes: null,
      payee: null,
      category: 'food',
      categoryLabel: null,
      date: '2026-10-12',
      currency: 'INR',
      shares: [{ memberId: 'm-me', amount: '99900' }],
      memberNames: ['Me'],
    },
    {
      id: 'e3',
      deleted: false,
      description: 'Not my bill',
      notes: null,
      payee: null,
      category: 'food',
      categoryLabel: null,
      date: '2026-10-12',
      currency: 'INR',
      shares: [{ memberId: 'm-anu', amount: '50000' }],
      memberNames: ['Anu'],
    },
  ],
};

const budgets: PersonalBudget[] = [{ id: 'b1', category: 'food', limit: 500000n, currency: 'INR' }];

function ctx(
  language: 'en' | 'hi' | 'ta' | 'ar' = 'en',
  over: Partial<AnswerContext['data']> = {},
) {
  const t = STRINGS_BY_LANGUAGE[language];
  const locale = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN', ar: 'ar' }[language];
  const context: AnswerContext = {
    today: TODAY,
    locale,
    strings: t.voice,
    categoryNames: t.categories,
    data: {
      txns: [
        txn({ id: 't1', amount: 120000n, date: '2026-10-05' }),
        txn({ id: 't2', amount: 80000n, date: '2026-10-19', note: 'Swiggy' }),
        txn({ id: 't3', amount: 30000n, date: '2026-09-30' }),
        txn({
          id: 't4',
          amount: 500000n,
          date: '2026-10-07',
          kind: 'income',
          category: 'inc.salary',
        }),
        txn({ id: 't5', amount: 70000n, date: '2026-10-08', loanId: 'loan-1' }),
      ],
      budgets,
      groups: [goa],
      catalog: [{ key: 'food', label: 'Food & drink', builtinId: 'food' }],
      ...over,
    },
  };
  return context;
}

describe('groupExpensesForViewer', () => {
  it('keeps only my share of live expenses I am in', () => {
    const rows = groupExpensesForViewer([goa]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'e1',
      groupName: 'Goa trip',
      myShareMinor: 40000n,
      participantNames: ['Me', 'Anu'],
    });
  });

  it('skips a group I am not a member of', () => {
    expect(groupExpensesForViewer([{ ...goa, myMemberIds: [] }])).toEqual([]);
  });

  it('survives a malformed share amount', () => {
    const bad: AnswerGroupInput = {
      ...goa,
      expenses: [{ ...goa.expenses[0]!, shares: [{ memberId: 'm-me', amount: 'abc' }] }],
    };
    expect(groupExpensesForViewer([bad])).toEqual([]);
  });
});

describe('answerMoneyQuestion', () => {
  it('adds personal spend and my group share, skipping income and loan repayments', () => {
    const query = parseMoneyQuestion('how much did I spend on food this month', TODAY)!;
    const answer = answerMoneyQuestion(query, ctx());
    // 1,200 + 800 personal + 400 my share of the shack dinner.
    expect(answer.text).toBe('You spent ₹2,400 on Food & drink this month');
    expect(answer.status).toBe('ok');
  });

  it('answers in under 200 ms on a large ledger, offline', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      txn({ id: `x${i}`, amount: 1000n + BigInt(i), date: '2026-10-05' }),
    );
    const query = parseMoneyQuestion('how much did I spend on food this month', TODAY)!;
    const started = Date.now();
    answerMoneyQuestion(query, ctx('en', { txns: many }));
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('says nothing was spent rather than zero', () => {
    const query = parseMoneyQuestion('how much did I spend on shopping this month', TODAY)!;
    expect(answerMoneyQuestion(query, ctx()).text).toBe('Nothing on Shopping this month');
  });

  it('names the biggest expense with its date', () => {
    const query = parseMoneyQuestion('biggest expense this month', TODAY)!;
    expect(answerMoneyQuestion(query, ctx()).text).toBe('Biggest: ₹1,200 on 5 Oct');
  });

  it('reports a food budget left, and offers to set one when there is none', () => {
    const left = answerMoneyQuestion(
      parseMoneyQuestion('how much is left in my food budget', TODAY)!,
      ctx(),
    );
    // 5,000 cap - (1,200 + 800 + 0 loan) = personal only, as the budgets screen counts it.
    expect(left.text).toBe('₹3,000 left of your ₹5,000 Food & drink budget this month');
    expect(left.link).toBeNull();

    const none = answerMoneyQuestion(
      parseMoneyQuestion('how much is left in my food budget', TODAY)!,
      ctx('en', { budgets: [] }),
    );
    expect(none.status).toBe('noBudget');
    expect(none.text).toBe('No Food & drink budget set');
    expect(none.link).toMatchObject({
      kind: 'budget',
      label: 'Set one',
      pathname: '/personal/budgets',
    });
  });

  it('asks which group when the named group does not exist', () => {
    const answer = answerMoneyQuestion(
      parseMoneyQuestion('how much did I spend in Manali', TODAY)!,
      ctx(),
    );
    expect(answer.status).toBe('noGroup');
    expect(answer.text).toBe("Couldn't find a group called manali");
    expect(answer.link).toBeNull();
  });

  it('resolves a group by a part of its name and counts only my share there', () => {
    const answer = answerMoneyQuestion(
      parseMoneyQuestion('how much did I spend in Goa this month', TODAY)!,
      ctx(),
    );
    expect(answer.text).toBe('You spent ₹400 this month in Goa trip');
    // A group answer has nothing in the personal ledger to link to.
    expect(answer.link).toBeNull();
  });

  it('never mixes currencies', () => {
    const answer = answerMoneyQuestion(
      parseMoneyQuestion('how much did I spend this month', TODAY)!,
      ctx('en', {
        txns: [
          txn({ id: 'a', amount: 1240000n, date: '2026-10-02', category: 'travel' }),
          txn({ id: 'b', amount: 3500n, date: '2026-10-03', currency: 'GBP', category: 'travel' }),
        ],
        groups: [],
      }),
    );
    expect(answer.text).toBe('You spent ₹12,400 and £35 this month');
  });

  it('uses the language of the strings, with the amount in the locale', () => {
    const query = parseMoneyQuestion('is mahine khaane pe kitna gaya', TODAY)!;
    const hi = answerMoneyQuestion(query, ctx('hi'));
    expect(hi.text).toContain('इस महीने');
    expect(hi.text).toContain('₹');
    expect(hi.text).not.toContain('{');
    const ar = answerMoneyQuestion(query, ctx('ar'));
    expect(ar.text).not.toContain('{');
    const ta = answerMoneyQuestion(query, ctx('ta'));
    expect(ta.text).toContain('இந்த மாதம்');
  });
});

describe('period chips', () => {
  it('shows this month with last month beside it when no period was named', () => {
    const query = parseMoneyQuestion('how much did I spend on food', TODAY)!;
    expect(query.assumedPeriod).toBe(true);
    const answer = answerMoneyQuestion(query, ctx());
    expect(answer.chips).toEqual([
      { key: 'lastMonth', label: 'Last month', selected: false },
      { key: 'thisMonth', label: 'This month', selected: true },
    ]);
  });

  it('re-answers for the chip that was tapped', () => {
    const query = parseMoneyQuestion('how much did I spend on food', TODAY)!;
    const last = answerForPeriod(query, 'lastMonth', ctx());
    expect(last.text).toBe('You spent ₹300 on Food & drink last month');
    expect(last.chips.find((chip) => chip.selected)?.key).toBe('lastMonth');
  });

  it('gives a month-name question a single chip with the month', () => {
    const query = parseMoneyQuestion('how much did I spend in september', TODAY)!;
    const answer = answerMoneyQuestion(query, ctx());
    expect(answer.chips).toEqual([{ key: 'month', label: 'September', selected: true }]);
    expect(answer.text).toContain('September');
  });
});

describe('Show in Spending link', () => {
  it('carries the category and the inclusive range of the answer', () => {
    const answer = answerMoneyQuestion(
      parseMoneyQuestion('how much did I spend on food this month', TODAY)!,
      ctx(),
    );
    expect(answer.link).toEqual({
      kind: 'spending',
      label: 'Show in Spending',
      pathname: '/personal/transactions',
      params: { kind: 'expense', from: '2026-10-01', to: '2026-10-31', category: 'food' },
    });
  });

  it('omits the category when the question names none', () => {
    const answer = answerMoneyQuestion(
      parseMoneyQuestion('what did I spend yesterday', TODAY)!,
      ctx(),
    );
    expect(answer.link?.params).toEqual({ kind: 'expense', from: '2026-10-18', to: '2026-10-18' });
  });
});

describe('compactMoney', () => {
  it('drops a whole amount’s zero fraction and keeps a real one', () => {
    expect(compactMoney(1240000n, 'INR', 'en-IN')).toBe('₹12,400');
    expect(compactMoney(123456n, 'INR', 'en-IN')).toBe('₹1,234.56');
    expect(compactMoney(3500n, 'GBP', 'en-IN')).toBe('£35');
  });
});

describe('parseMoneyQuestion', () => {
  it('leaves balance questions and expenses to their own paths', () => {
    expect(parseMoneyQuestion('who owes me', TODAY)).toBeNull();
    expect(parseMoneyQuestion('how much does Anu owe me', TODAY)).toBeNull();
    expect(parseMoneyQuestion('add 800 lunch', TODAY)).toBeNull();
    expect(parseMoneyQuestion('spent 500 on lunch', TODAY)).toBeNull();
  });
});

describe('strings in every language', () => {
  const keys = Object.keys(STRINGS_BY_LANGUAGE.en.voice).filter((key) => key.startsWith('sq'));
  const placeholders = (text: string): string[] =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

  it('has every sq string in every language, none empty', () => {
    expect(keys.length).toBeGreaterThan(30);
    for (const language of LANGUAGES) {
      const voice = STRINGS_BY_LANGUAGE[language].voice as unknown as Record<string, string>;
      for (const key of keys) {
        expect(voice[key], `${language}.${key}`).toBeTruthy();
      }
    }
  });

  it('keeps the same placeholders as English in every language', () => {
    const en = STRINGS_BY_LANGUAGE.en.voice as unknown as Record<string, string>;
    for (const language of LANGUAGES) {
      const voice = STRINGS_BY_LANGUAGE[language].voice as unknown as Record<string, string>;
      for (const key of keys) {
        expect(placeholders(voice[key]!), `${language}.${key}`).toEqual(placeholders(en[key]!));
      }
    }
  });

  it('really translates (no non-English language is a copy of English)', () => {
    const en = STRINGS_BY_LANGUAGE.en.voice as unknown as Record<string, string>;
    for (const language of LANGUAGES.filter((l) => l !== 'en')) {
      const voice = STRINGS_BY_LANGUAGE[language].voice as unknown as Record<string, string>;
      expect(voice.sqShow).not.toBe(en.sqShow);
      expect(voice.sqSumAll).not.toBe(en.sqSumAll);
      expect(fill(voice.sqNoGroup!, { group: 'X' })).toContain('X');
    }
  });
});

describe('AssistantAnswerCard', () => {
  const link = {
    kind: 'spending' as const,
    label: 'Show in Spending',
    pathname: '/personal/transactions' as const,
    params: { category: 'food', from: '2026-10-01', to: '2026-10-31' },
  };

  it('SQ-24 renders the sentence and a Show in Spending link with {category, from, to}', () => {
    const onLink = vi.fn();
    const tree = AssistantAnswerCard({
      text: 'You spent ₹2,400 on Food & drink this month',
      chips: [{ key: 'thisMonth', label: 'This month', selected: true }],
      link,
      onChip: vi.fn(),
      onLink,
    });
    expect(textOf(tree)).toContain('You spent ₹2,400 on Food & drink this month');
    const [pressable] = findAll(tree, (n) => n.props.accessibilityRole === 'link');
    expect(pressable?.props.accessibilityLabel).toBe('Show in Spending');
    (pressable!.props.onPress as () => void)();
    expect(onLink).toHaveBeenCalledWith(link);
    expect(onLink.mock.calls[0]![0].params).toEqual({
      category: 'food',
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('SQ-24 shows the period chip selected and the other one tappable', () => {
    const onChip = vi.fn();
    const chips = [
      { key: 'lastMonth' as const, label: 'Last month', selected: false },
      { key: 'thisMonth' as const, label: 'This month', selected: true },
    ];
    const tree = AssistantAnswerCard({ text: 'x', chips, link: null, onChip, onLink: vi.fn() });
    const buttons = findAll(tree, (n) => n.props.accessibilityRole === 'button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(['Last month', 'This month']);
    expect(buttons[1]!.props.disabled).toBe(true);
    (buttons[0]!.props.onPress as () => void)();
    expect(onChip).toHaveBeenCalledWith(chips[0]);
  });

  it('SQ-24 shows no link row when there is nothing to link to', () => {
    const tree = AssistantAnswerCard({
      text: 'Nothing on food this month',
      chips: [],
      link: null,
      onChip: vi.fn(),
      onLink: vi.fn(),
    });
    expect(findAll(tree, (n) => n.props.accessibilityRole === 'link')).toEqual([]);
  });
});
