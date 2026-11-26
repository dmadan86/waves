import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActivityRow, ExpenseComment, Member } from '@waves/api-client';

import { describeActivity } from '../src/lib/activity';
import { parseAmountText } from '../src/lib/amount';
import { commentRows, mergeFeed } from '../src/lib/commentActivity';
import { currentFlash, dismissFlash, showFlash } from '../src/lib/flash';
import { isCurrencyLocked, isCurrencyLockedError } from '../src/lib/groupCurrency';
import { memberLabel } from '../src/lib/memberLabel';
import { goAfterSave } from '../src/lib/navigate';
import { splitHint } from '../src/lib/splitHint';

const actor = (id: string, profile_id: string | null, name: string) => ({
  id,
  profile_id,
  ghost_name: null,
  profile: { display_name: name },
});

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 'a1',
  group_id: 'g1',
  actor_member_id: 'm1',
  actor: actor('m1', 'p1', 'Me'),
  verb: 'added',
  object_type: 'expense',
  object_id: 'e1',
  payload: {},
  created_at: '2026-11-26T10:00:00Z',
  ...over,
});

describe('amount text (bug 2)', () => {
  it('reads decimal commas and thousands separators like the phone', () => {
    expect(parseAmountText('12,50', 'INR')).toBe(1250n);
    expect(parseAmountText('12,5', 'INR')).toBe(1250n);
    expect(parseAmountText('1,250.50', 'INR')).toBe(125050n);
    expect(parseAmountText('1.250,50', 'EUR')).toBe(125050n);
    expect(parseAmountText('12.50', 'INR')).toBe(1250n);
  });
  it('is null for nothing readable', () => {
    expect(parseAmountText('', 'INR')).toBeNull();
    expect(parseAmountText('abc', 'INR')).toBeNull();
  });
});

describe('currency lock (bug 1)', () => {
  it('locks once there are expenses or settlements', () => {
    expect(isCurrencyLocked({ expenses: [], settlements: [] })).toBe(false);
    expect(isCurrencyLocked({ expenses: [{}], settlements: [] })).toBe(true);
    expect(isCurrencyLocked({ expenses: [], settlements: [{}] })).toBe(true);
  });
  it('recognises the server refusal', () => {
    expect(isCurrencyLockedError({ message: 'CURRENCY_LOCKED: a group' })).toBe(true);
    expect(isCurrencyLockedError(new Error('network'))).toBe(false);
  });
});

describe('leaving a form after save (bug 3)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('hard-navigates if the soft navigation never lands', () => {
    vi.useFakeTimers();
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/g/1/add', assign } });
    const replace = vi.fn();
    goAfterSave({ replace }, '/g/1');
    expect(replace).toHaveBeenCalledWith('/g/1');
    vi.advanceTimersByTime(3000);
    expect(assign).toHaveBeenCalledWith('/g/1');
  });
  it('does nothing extra once the page has changed', () => {
    vi.useFakeTimers();
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/g/1', assign } });
    goAfterSave({ replace: vi.fn() }, '/g/1');
    vi.advanceTimersByTime(3000);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('activity wording (bugs 4, 5, 6)', () => {
  it('words group_deleted', () => {
    expect(describeActivity(row({ verb: 'group_deleted', object_type: 'group' }), 'p1')).toBe(
      'You deleted the group',
    );
    expect(
      describeActivity(
        row({ verb: 'group_deleted', object_type: 'group', payload: { name: 'Goa' } }),
        'p1',
      ),
    ).toBe('You deleted Goa');
  });
  it('says removed when somebody else was retired', () => {
    const removed = row({
      verb: 'member_left',
      object_type: 'member',
      object_id: 'm2',
      payload: { name: 'Pal B' },
    });
    expect(describeActivity(removed, 'p1')).toBe('You removed Pal B');
    expect(describeActivity({ ...removed, object_id: 'm1' }, 'p1')).toBe('You left the group');
  });
  it('names a deleted expense from the lookup', () => {
    const deleted = row({ verb: 'deleted' });
    expect(describeActivity(deleted, 'p1')).toBe('You deleted an expense');
    expect(describeActivity(deleted, 'p1', new Map([['e1', 'Dinner']]))).toBe('You deleted Dinner');
  });
  it('turns comments into feed rows, newest first', () => {
    const member = {
      id: 'm1',
      profile_id: 'p1',
      ghost_name: null,
      profile: { display_name: 'Me' },
    } as unknown as Member;
    const comment = {
      id: 'c1',
      group_id: 'g1',
      expense_id: 'e1',
      author_member_id: 'm1',
      body: 'hi',
      created_at: '2026-11-26T11:00:00Z',
    } as ExpenseComment;
    const rows = commentRows([comment], [member], new Map([['e1', 'Dinner']]));
    expect(describeActivity(rows[0]!, 'p1')).toBe('You commented on Dinner');
    expect(mergeFeed([row({})], rows)[0]!.verb).toBe('commented');
  });
});

describe('flash message (bug 7)', () => {
  it('holds a message with an undo until dismissed', () => {
    const run = vi.fn();
    showFlash({ message: 'Expense deleted', undo: { label: 'Undo', run } });
    expect(currentFlash()?.message).toBe('Expense deleted');
    dismissFlash();
    expect(currentFlash()).toBeNull();
  });
});

describe('own name (bug 8)', () => {
  it('says You for my row even when the profile name is Guest', () => {
    const me = { profile_id: 'p1', ghost_name: null, profile: { display_name: 'Guest' } };
    expect(memberLabel(me as unknown as Member, 'p1', 'You')).toBe('You');
    expect(memberLabel(me as unknown as Member, 'p2', 'You')).toBe('Guest');
  });
});

describe('split hint (bug 9)', () => {
  const words = { invalidSplit: 'bad', splitEquallyNote: 'Split equally. use the app' };
  it('only offers the equal note for an equal split', () => {
    expect(splitHint(true, false, words)).toBe(words.splitEquallyNote);
    expect(splitHint(false, false, words)).toBe('');
    expect(splitHint(false, true, words)).toBe('bad');
  });
});
