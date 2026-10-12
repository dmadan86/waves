import { describe, expect, it } from 'vitest';

import { detectLayout, fieldForHeader, squashHeader } from '../../src/import/layout.js';
import { readTable } from '../../src/import/table.js';

describe('header synonyms', () => {
  it.each([
    ['Date', 'date'],
    ['TRANSACTION DATE', 'date'],
    ['txn_date', 'date'],
    ['तारीख', 'date'],
    ['தேதி', 'date'],
    ['تاريخ', 'date'],
    ['Narration', 'description'],
    ['विवरण', 'description'],
    ['விவரம்', 'description'],
    ['وصف', 'description'],
    ['Amt', 'amount'],
    ['राशि', 'amount'],
    ['தொகை', 'amount'],
    ['المبلغ', 'amount'],
    ['Paid By', 'paid_by'],
    ['who-paid', 'paid_by'],
    ['भुगतानकर्ता', 'paid_by'],
    ['Impacted to', 'split'],
    ['For whom', 'split'],
    ['amount_minor', 'amount_minor'],
    ['Ccy', 'currency'],
  ])('%s is %s', (header, field) => {
    expect(fieldForHeader(header)).toBe(field);
  });

  it('ignores case, accents, spacing and punctuation', () => {
    expect(squashHeader(' ﻿Paid  By: ')).toBe('paidby');
    expect(squashHeader('Dépense')).toBe('depense');
    expect(fieldForHeader('Mystery column')).toBeNull();
  });
});

describe('detectLayout', () => {
  it('finds a generic sheet’s columns and file-wide settings', () => {
    const layout = detectLayout(
      readTable(
        'Date,Item,Amount,Paid by,Split between\n13/10/2026,Cab,"1.234,50",Asha,\n14/10/2026,Tea,10,Bharath,',
      ),
      { country: 'US' },
    );
    expect(layout).toMatchObject({
      kind: 'generic',
      headerRow: 0,
      columns: { date: 0, description: 1, amount: 2, paid_by: 3, split: 4 },
      dateOrder: 'dmy',
      dateBasis: 'forced',
      decimalStyle: 'comma',
    });
  });

  it('finds the header below a title block', () => {
    const layout = detectLayout(
      readTable('My trip expenses\nexported today\nDate,Description,Amount\n2026-01-01,Tea,10'),
    );
    expect(layout.headerRow).toBe(2);
    expect(layout.columns).toMatchObject({ date: 0, description: 1, amount: 2 });
  });

  it('recognises a Splitwise export and its person columns', () => {
    const layout = detectLayout(
      readTable(
        'Date,Description,Category,Cost,Currency,Asha,,Bharath\n2026-01-01,Tea,Food,10,INR,5,,-5',
      ),
    );
    expect(layout.kind).toBe('splitwise');
    expect(layout.personColumns).toEqual([
      { name: 'Asha', column: 5 },
      { name: 'Bharath', column: 7 },
    ]);
  });

  it('recognises a Waves CSV export', () => {
    const layout = detectLayout(
      readTable(
        'group,type,date,description,currency,amount_minor,paid_by,owed_by,owed_amount_minor,status,version\nG,expense,2026-01-01,Tea,INR,1000,A,A,1000,active,v1',
      ),
    );
    expect(layout.kind).toBe('waves_csv');
  });

  it('treats columns headed with member names as person columns', () => {
    const layout = detectLayout(readTable('Date,Item,Amount,Asha,Bharath\n2026-01-01,Tea,10,5,5'), {
      members: ['Asha', 'Bharath', 'Chitra'],
    });
    expect(layout.personColumns).toEqual([
      { name: 'Asha', column: 3 },
      { name: 'Bharath', column: 4 },
    ]);
  });

  it('says so when nothing looks like a header', () => {
    expect(detectLayout(readTable('foo,bar\n1,2')).headerRow).toBe(-1);
  });
});
