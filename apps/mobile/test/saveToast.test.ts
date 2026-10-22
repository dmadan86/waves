import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { STRINGS_BY_LANGUAGE } from '@/i18n';
import { isQueuedOffline, saveToastText } from '@/lib/saveToast';

vi.mock('react-native', () => ({}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const en = STRINGS_BY_LANGUAGE.en;
const src = (p: string): string => readFileSync(p, 'utf8');

describe('saveToastText', () => {
  it('names the group made', () => {
    expect(saveToastText(en, { kind: 'group', name: ' Goa trip ', offline: false })).toBe(
      '“Goa trip” created',
    );
    expect(saveToastText(en, { kind: 'group', name: '  ', offline: false })).toBe('Group created');
  });
  it('says what was added or updated', () => {
    expect(
      saveToastText(en, {
        kind: 'expense',
        editing: false,
        label: 'Dinner · ₹1,200',
        offline: false,
      }),
    ).toBe('Dinner · ₹1,200 added');
    expect(saveToastText(en, { kind: 'expense', editing: true, label: 'x', offline: false })).toBe(
      'Expense updated',
    );
  });
  it('offline wins for both kinds', () => {
    const off = 'Saved — will sync when online';
    expect(saveToastText(en, { kind: 'group', name: 'A', offline: true })).toBe(off);
    expect(saveToastText(en, { kind: 'expense', editing: false, label: 'A', offline: true })).toBe(
      off,
    );
  });
  it('treats offline and barred-network as queued', () => {
    expect(isQueuedOffline('offline')).toBe(true);
    expect(isQueuedOffline('metered')).toBe(true);
    expect(isQueuedOffline('idle')).toBe(false);
  });
  it('has the strings in every language', () => {
    for (const t of Object.values(STRINGS_BY_LANGUAGE)) {
      expect(t.common.expenseAdded).toContain('{what}');
      expect(t.common.groupCreatedNamed).toContain('{name}');
    }
  });
});

describe('wiring', () => {
  it('new-group and add-expense show the toast on save', () => {
    for (const f of ['src/app/new-group.tsx', 'src/app/group/[id]/add-expense.tsx']) {
      const s = src(f);
      expect(s).toContain("from '@/lib/saveToast'");
      expect(s).toContain('toast.show(');
      expect(s).toContain('saveToastText(');
    }
  });
});
