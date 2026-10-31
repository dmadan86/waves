import { describe, expect, it } from 'vitest';
import { emptyMirror } from '../src/sync/mirror';
import { materialiseCompanyCard } from '../src/sync/detailsMirror';
import { SyncTable } from '../src/sync/protocol';
import {
  bankNoticeKey,
  cleanDetails,
  detailsToShareText,
  emptyDetails,
  invalidDetailKeys,
  maskValue,
  showBankNotice,
} from '../src/company/details';

describe('details card', () => {
  it('masks to the last four, or fully when short', () => {
    expect(maskValue('123456785678')).toBe('••••5678');
    expect(maskValue('ravi@okhdfc')).toBe('••••hdfc');
    expect(maskValue('1234')).toBe('••••');
  });

  it('cleans: trims, blanks to null, upper-cases code fields', () => {
    const v = cleanDetails({ ifsc: ' hdfc0001234 ', pan: 'abcde1234f', phone: '  ', note: ' hi ' });
    expect(v.ifsc).toBe('HDFC0001234');
    expect(v.pan).toBe('ABCDE1234F');
    expect(v.phone).toBeNull();
    expect(v.note).toBe('hi');
  });

  it('flags only bad formats and ignores empty fields', () => {
    expect(invalidDetailKeys(emptyDetails())).toEqual([]);
    const bad = cleanDetails({
      ifsc: 'HDFC1001234',
      gstin: '29ABCDE1234F1Z',
      pan: 'ABCD1234EF',
      upi: 'nope',
      email: 'x',
      phone: 'abc',
      bankAccount: '12',
      note: 'x'.repeat(501),
    });
    expect(invalidDetailKeys(bad)).toEqual(
      expect.arrayContaining([
        'ifsc',
        'gstin',
        'pan',
        'upi',
        'email',
        'phone',
        'bankAccount',
        'note',
      ]),
    );
    const ok = cleanDetails({
      ifsc: 'HDFC0001234',
      gstin: '29ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      upi: 'ravi@okhdfc',
      email: 'a@b.co',
      phone: '+91 99999 99999',
      bankAccount: '123456785678',
    });
    expect(invalidDetailKeys(ok)).toEqual([]);
  });

  it('shares full values as plain text, skipping empty fields', () => {
    const t = detailsToShareText(
      'Ravi Traders',
      cleanDetails({ bankAccount: '123456785678', upi: 'ravi@okhdfc' }),
    );
    expect(t).toBe('Ravi Traders\nAccount number: 123456785678\nUPI ID: ravi@okhdfc');
  });

  it('shows the bank notice to the other side until noted', () => {
    const card = { bankChangedAt: '2026-10-28T10:00:00Z', bankChangedBy: 'm1' };
    expect(showBankNotice(card, 'm2', false)).toBe(true);
    expect(showBankNotice(card, 'm1', false)).toBe(false);
    expect(showBankNotice(card, 'm2', true)).toBe(false);
    expect(showBankNotice({ bankChangedAt: null, bankChangedBy: null }, 'm2', false)).toBe(false);
    expect(bankNoticeKey('c', card.bankChangedAt)).toBe('c:2026-10-28T10:00:00Z');
  });
});

describe('details mirror', () => {
  it('never shows a cached bank/PAN row to someone who may not see it', () => {
    const state = emptyMirror() as unknown as { tables: Record<string, Record<string, unknown>> };
    const g = 'g1';
    state.tables[SyncTable.CompanyDetails]!['g1'] = {
      id: g,
      group_id: g,
      phone: '123',
      updated_at: 't',
    };
    state.tables[SyncTable.CompanyDetailsSecure]!['g1'] = {
      id: g,
      group_id: g,
      bank_account: '123456785678',
      pan: 'ABCDE1234F',
    };
    const base = { groupId: g, myMemberId: 'm' };
    const emp = materialiseCompanyCard(state as never, [], { ...base, canSeeBank: false });
    expect(emp?.values.phone).toBe('123');
    expect(emp?.values.bankAccount).toBeNull();
    expect(emp?.values.pan).toBeNull();
    const owner = materialiseCompanyCard(state as never, [], { ...base, canSeeBank: true });
    expect(owner?.values.bankAccount).toBe('123456785678');
  });
});
