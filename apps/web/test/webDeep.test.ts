process.env.TZ = 'Asia/Kolkata';

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import type { ActivityRow, ExpenseComment, Member } from '@waves/api-client';

import { describeActivity } from '../src/lib/activity';
import { parseAmountText } from '../src/lib/amount';
import { friendlyError } from '../src/lib/errors';
import { isExpenseGone } from '../src/lib/expenseGone';
import { buildFeed } from '../src/lib/globalFeed';
import { localIsoDate } from '../src/lib/localDate';
import { initialOf, memberLabel } from '../src/lib/memberLabel';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const member = (id: string, profile_id: string | null, name: string): Member =>
  ({
    id,
    group_id: 'g1',
    profile_id,
    ghost_name: null,
    left_at: null,
    profile: { display_name: name },
  }) as unknown as Member;

describe('amount text rejects what it cannot read', () => {
  it('refuses exponents and signs instead of dropping them', () => {
    expect(parseAmountText('1e3', 'INR')).toBeNull();
    expect(parseAmountText('-5', 'INR')).toBeNull();
    expect(parseAmountText('−5', 'INR')).toBeNull();
    expect(parseAmountText('+5', 'INR')).toBeNull();
    expect(parseAmountText('1,250.50', 'INR')).toBe(125050n);
  });
  it('refuses a figure past the limit and keeps the limit itself', () => {
    expect(parseAmountText('99999999999999999999', 'INR')).toBeNull();
    expect(parseAmountText('1000000000', 'INR')).toBe(100_000_000_000n);
    expect(parseAmountText('1000000000.01', 'INR')).toBeNull();
  });
});

describe('the expense date is the local day', () => {
  it('00:30 IST on 1 Dec is 1 Dec, not 30 Nov', () => {
    expect(localIsoDate(new Date(2026, 11, 1, 0, 30))).toBe('2026-12-01');
    expect(new Date(2026, 11, 1, 0, 30).toISOString().slice(0, 10)).toBe('2026-11-30');
  });
});

describe('editing an expense somebody deleted', () => {
  it('is gone when the row is missing or soft-deleted', () => {
    expect(isExpenseGone(null)).toBe(true);
    expect(isExpenseGone({ deleted_at: '2026-11-26T10:00:00Z' })).toBe(true);
    expect(isExpenseGone({ deleted_at: null })).toBe(false);
  });
});

describe('own rows and initials', () => {
  it('says You for your own member, with the left marker only for others', () => {
    const me = member('m1', 'p1', 'Guest');
    expect(memberLabel(me, 'p1', 'You', '(left)')).toBe('You');
    expect(memberLabel(member('m2', 'p2', 'Asha'), 'p1', 'You')).toBe('Asha');
    expect(
      memberLabel({ ...member('m2', 'p2', 'Asha'), left_at: 'x' }, 'p1', 'You', '(left)'),
    ).toBe('Asha (left)');
  });
  it('takes a whole emoji as the initial', () => {
    expect(initialOf('🍕🍕')).toBe('🍕');
    expect(initialOf('👨‍👩‍👧 family')).toBe('👨‍👩‍👧');
    expect(initialOf('  asha')).toBe('A');
    expect(initialOf('   ')).toBe('?');
  });
});

describe('error words', () => {
  const words = { fallback: 'fallback', offline: 'offline', signedOut: 'signed out' };
  it('sends a dead session to sign-in, not "try again"', () => {
    expect(friendlyError({ message: 'Invalid JWT' }, 't', words)).toBe('signed out');
    expect(friendlyError({ status: 401, message: 'x' }, 't', words)).toBe('signed out');
    expect(friendlyError({ message: 'JWT expired' }, 't', { fallback: 'fallback' })).toBe(
      'fallback',
    );
  });
  it('names the supabase transport failure and a known-offline browser', () => {
    expect(
      friendlyError({ message: 'Failed to send a request to the Edge Function' }, 't', words),
    ).toBe('offline');
    vi.stubGlobal('navigator', { onLine: false });
    expect(friendlyError({ message: 'whatever' }, 't', words)).toBe('offline');
    vi.unstubAllGlobals();
  });
});

describe('the cross-group feed', () => {
  it('joins comments and names deleted and restored expenses', () => {
    const group = { id: 'g1', name: 'Trip', cover_emoji: null };
    const activity = [
      {
        id: 'a1',
        group_id: 'g1',
        actor_member_id: 'm1',
        actor: member('m1', 'p1', 'Guest'),
        verb: 'deleted',
        object_type: 'expense',
        object_id: 'e1',
        payload: {},
        created_at: '2026-11-26T10:00:00Z',
        group,
      },
    ] as unknown as (ActivityRow & { group: typeof group })[];
    const comments = [
      {
        id: 'c1',
        group_id: 'g1',
        expense_id: 'e1',
        author_member_id: 'm1',
        body: 'hi',
        created_at: '2026-11-26T11:00:00Z',
      },
    ] as unknown as ExpenseComment[];
    const { rows, names } = buildFeed(
      activity,
      comments,
      [member('m1', 'p1', 'Guest')],
      [{ id: 'e1', currentVersion: { description: 'Tea', amount: '1000', currency: 'INR' } }],
    );
    expect(rows.map((r) => r.verb)).toEqual(['commented', 'deleted']);
    expect(rows[0]!.group?.name).toBe('Trip');
    expect(describeActivity(rows[1]!, 'p1', names)).toBe('You deleted Tea');
    expect(describeActivity(rows[0]!, 'p1', names)).toBe('You commented on Tea');
  });
});

describe('accessibility', () => {
  it('text inputs get a visible focus ring', () => {
    expect(read('../src/app/globals.css')).toMatch(
      /input:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible\s*\{[^}]*outline: 2px solid/,
    );
  });
  it('the itemised amount field is named with its currency filled in', () => {
    expect(read('../src/components/ItemizeForm.tsx')).not.toContain('aria-label={t.add.howMuch}');
  });
  it('negative text is dark enough on white', () => {
    const css = read('../src/app/tokens.css');
    const hex = /--w-negative-text: (#[0-9A-Fa-f]{6})/.exec(css)![1]!;
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
      const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    expect(1.05 / (lum(hex) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
