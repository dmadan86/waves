/**
 * Statement import on the phone: file kinds, the chunked call to the function,
 * the Free preview counter, and the step that turns rows into device-only Review
 * drafts, merging with the bank-message drafts already there.
 */

import { describe, expect, it } from 'vitest';

import {
  applyBalanceCheck,
  parseStatementTable,
  planStatementImport,
  readTable,
  type StatementRow,
} from '@waves/core';

import type { CaptureRow } from '@/data/types';
import { applyStatementPlan, draftDescription, draftPayload } from '@/lib/statementImport/drafts';
import { looksLikePdf, statementFileKind } from '@/lib/statementImport/fileKind';
import { otherOrder, statementRegion } from '@/lib/statementImport/region';
import { PDF_READING_AVAILABLE } from '@/lib/statementImport/pdfReader';
import { previewsLeft } from '@/lib/statementImport/previews';
import {
  chunkPages,
  readStatementPages,
  type ParseCallResult,
  type ParseRequest,
  type StatementPageInput,
} from '@/lib/statementImport/run';
import { createDraftCache, type DraftBackend, type DraftEntry } from '@/lib/smsDraftCache';
import { isSmsDerived } from '@/lib/smsLocalDrafts';
import { tabFor } from '@/lib/reviewFeed';
import { tableToPages, transactionRows } from '@/lib/statementImport/tablePages';

const row = (over: Partial<StatementRow> = {}): StatementRow => ({
  index: 0,
  date: '2026-10-01',
  description: 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER',
  amount: '45000',
  direction: 'debit',
  ref: '627412345678',
  balance: null,
  confidence: 0.95,
  warnings: [],
  ...over,
});

describe('file kinds', () => {
  it.each([
    ['HDFC_Oct.PDF', null, 'pdf'],
    ['stmt.csv', 'application/vnd.ms-excel', 'csv'],
    ['stmt.xls', null, 'xlsx'],
    ['stmt.xlsx', null, 'xlsx'],
    ['Screenshot_1.png', null, 'image'],
    ['download', 'application/pdf', 'pdf'],
    ['download', 'image/jpeg', 'image'],
    ['export.QFX', null, 'ofx'],
    ['export.ofx', 'application/x-ofx', 'ofx'],
    ['notes.docx', 'application/zip', null],
  ])('%s (%s) is %s', (name, mime, kind) => {
    expect(statementFileKind(name, mime)).toBe(kind);
  });

  it('knows a PDF by its first bytes', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7 ...'))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('PK\x03\x04'))).toBe(false);
  });
});

describe('PDF reading', () => {
  it('is offered on the phone (the reader itself is tested in pdfReader.test.ts)', () => {
    expect(PDF_READING_AVAILABLE).toBe(true);
  });
});

describe('Free previews', () => {
  it('allows two a month and starts again in a new month', () => {
    expect(previewsLeft(null, '2026-10')).toBe(2);
    expect(previewsLeft({ month: '2026-10', used: 1 }, '2026-10')).toBe(1);
    expect(previewsLeft({ month: '2026-10', used: 5 }, '2026-10')).toBe(0);
    expect(previewsLeft({ month: '2026-09', used: 2 }, '2026-10')).toBe(2);
  });
});

const text = (page: number, length = 10): StatementPageInput => ({
  kind: 'text',
  page,
  text: 'x'.repeat(length),
});

describe('chunkPages', () => {
  it('sends at most five pages at a time', () => {
    const chunks = chunkPages(Array.from({ length: 12 }, (_, i) => text(i + 1)));
    expect(chunks.map((c) => c.length)).toEqual([5, 5, 2]);
  });

  it('keeps a request under the character cap and the image cap', () => {
    expect(chunkPages([text(1, 40_000), text(2, 40_000)]).map((c) => c.length)).toEqual([1, 1]);
    const image = (page: number): StatementPageInput => ({
      kind: 'image',
      page,
      base64: 'AAAA',
      mimeType: 'image/jpeg',
    });
    expect(chunkPages([1, 2, 3, 4].map(image)).map((c) => c.length)).toEqual([3, 1]);
  });
});

const hints = {
  currency: 'INR',
  today: '2026-10-17',
  locale: 'en-IN',
  country: 'IN',
  bank: null,
  dateOrder: 'dmy' as const,
};
const ok = (rows: StatementRow[], over: Partial<Extract<ParseCallResult, { kind: 'ok' }>> = {}) =>
  ({
    kind: 'ok',
    rows,
    currency: 'INR',
    openingBalance: null,
    warnings: [],
    continuation: 'tok',
    quota: { used: 3, limit: 30 },
    ...over,
  }) as ParseCallResult;

describe('readStatementPages', () => {
  it('sends no continuation on the first request and the token on the rest', async () => {
    const seen: (string | null)[] = [];
    const outcome = await readStatementPages({
      pages: Array.from({ length: 7 }, (_, i) => text(i + 1)),
      importId: 'import-0001',
      hints,
      call: async (request: ParseRequest) => {
        seen.push(request.continuation);
        return ok([row()], { continuation: request.continuation ?? 'tok-1' });
      },
    });
    expect(seen).toEqual([null, 'tok-1']);
    if (!outcome.ok) throw new Error('failed');
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows.map((r) => r.index)).toEqual([0, 1]);
    expect(outcome.quota).toEqual({ used: 3, limit: 30 });
  });

  it('runs one balance check over the whole file, across request boundaries', async () => {
    let call = 0;
    const outcome = await readStatementPages({
      pages: Array.from({ length: 6 }, (_, i) => text(i + 1)),
      importId: 'import-0001',
      hints,
      call: async () => {
        call += 1;
        return call === 1
          ? ok([row({ amount: '100', balance: '900' })], { openingBalance: '1000' })
          : ok([row({ amount: '50', balance: '999', ref: null })]);
      },
    });
    if (!outcome.ok) throw new Error('failed');
    expect(outcome.rows[0]!.warnings).toEqual([]);
    expect(outcome.rows[1]!.warnings).toContain('balance_mismatch');
    expect(applyBalanceCheck(outcome.rows, { openingBalance: '1000' }).failed).toBe(1);
  });

  it('splits a request the reader found too dense, and gives up on a single dense page', async () => {
    const sizes: number[] = [];
    const outcome = await readStatementPages({
      pages: [text(1), text(2), text(3), text(4)],
      importId: 'import-0001',
      hints,
      call: async (request) => {
        sizes.push(request.pages.length);
        return request.pages.length > 2 ? { kind: 'dense' } : ok([row()]);
      },
    });
    expect(sizes).toEqual([4, 2, 2]);
    expect(outcome.ok).toBe(true);

    const stuck = await readStatementPages({
      pages: [text(1)],
      importId: 'import-0001',
      hints,
      call: async () => ({ kind: 'dense' }),
    });
    expect(stuck).toEqual({ ok: false, reason: 'dense' });
  });

  it.each(['paid', 'expired', 'unavailable', 'rate', 'error', 'refused'] as const)(
    'stops at the first %s answer',
    async (kind) => {
      let calls = 0;
      const outcome = await readStatementPages({
        pages: Array.from({ length: 8 }, (_, i) => text(i + 1)),
        importId: 'import-0001',
        hints,
        call: async () => {
          calls += 1;
          return { kind } as ParseCallResult;
        },
      });
      expect(outcome).toEqual({ ok: false, reason: kind });
      expect(calls).toBe(1);
    },
  );

  it('reports the month’s quota being used up', async () => {
    const outcome = await readStatementPages({
      pages: [text(1)],
      importId: 'import-0001',
      hints,
      call: async () => ({ kind: 'quota', used: 30, limit: 30 }),
    });
    expect(outcome).toEqual({ ok: false, reason: 'quota' });
  });
});

function memoryBackend(): DraftBackend {
  const disk = new Map<string, Map<string, DraftEntry | null>>();
  return {
    async load(ownerId) {
      return new Map(disk.get(ownerId) ?? []);
    },
    async write(ownerId, captureId, entry) {
      let map = disk.get(ownerId);
      if (!map) disk.set(ownerId, (map = new Map()));
      map.set(captureId, entry);
    },
    async forgetOwner(ownerId) {
      disk.delete(ownerId);
    },
    async forgetEverything() {
      disk.clear();
    },
  };
}

const OWNER = 'owner-1';
const context = { currency: 'INR', today: '2026-10-17' };

function depsFor(drafts = createDraftCache(memoryBackend())) {
  return {
    drafts,
    deps: {
      ownerId: OWNER,
      drafts,
      idFor: async (key: string) => `id:${key}`,
      now: () => '2026-10-17T10:00:00.000Z',
    },
  };
}

describe('draft descriptions', () => {
  it('prefers the counterparty and trims a long narration', () => {
    expect(draftDescription('UPI/P2M/627412345678/SWIGGY/Payment')).toBe('SWIGGY');
    expect(draftDescription('x'.repeat(200)).length).toBe(80);
  });
});

describe('applyStatementPlan', () => {
  const rows = [
    row(),
    row({
      ref: null,
      description: 'ATW-401234XXXXXX1234-MUMBAI',
      amount: '500000',
      date: '2026-10-04',
    }),
    row({
      ref: 'HDFCN52026100212345',
      description: 'NEFT CR-ACME LTD-SALARY',
      amount: '8500000',
      direction: 'credit',
    }),
  ];

  it('writes only the ticked rows, as device-only statement drafts with no text kept', async () => {
    const { drafts, deps } = depsFor();
    const plan = planStatementImport(rows, { currency: 'INR' });
    const ticked = new Set(plan.items.filter((i) => i.ticked).map((i) => i.key));
    const result = await applyStatementPlan(plan, ticked, context, deps);
    expect(result).toEqual({ added: 2, enriched: 0, alreadyHad: 0 });

    const open = drafts.openDrafts(OWNER);
    expect(open).toHaveLength(2);
    const swiggy = open.find((r) => r.description === 'SWIGGY')!;
    expect(swiggy).toMatchObject({
      amount: '45000',
      currency: 'INR',
      expense_date: '2026-10-01',
      raw_text: null,
      local: true,
    });
    expect(swiggy.parsed).toMatchObject({ source: 'statement', dedupeKey: 'ref:627412345678' });
    expect(isSmsDerived(swiggy.parsed)).toBe(true);
    expect(tabFor(swiggy)).toBe('found');
    expect(JSON.stringify(open)).not.toContain('ICIC0000001');
  });

  it('lets a ticked credit through, marked as money in', async () => {
    const { drafts, deps } = depsFor();
    const plan = planStatementImport(rows, { currency: 'INR' });
    const salary = plan.items[2]!;
    await applyStatementPlan(plan, new Set([salary.key]), context, deps);
    expect(drafts.openDrafts(OWNER)[0]!.parsed).toMatchObject({ direction: 'credit' });
  });

  it('applying the same statement twice writes nothing the second time', async () => {
    const { deps } = depsFor();
    const plan = planStatementImport(rows, { currency: 'INR' });
    const ticked = new Set(plan.items.filter((i) => i.ticked).map((i) => i.key));
    await applyStatementPlan(plan, ticked, context, deps);
    expect(await applyStatementPlan(plan, ticked, context, deps)).toEqual({
      added: 0,
      enriched: 0,
      alreadyHad: 2,
    });
  });

  it('enriches the SMS draft that shares a reference instead of adding a second', async () => {
    const { drafts, deps } = depsFor();
    // The bank message's draft, as the SMS path writes it: keyed by the same ref, no merchant.
    await drafts.put(OWNER, {
      id: 'id:ref:627412345678',
      owner_user_id: OWNER,
      description: '',
      category: null,
      category_meta: null,
      expense_date: '2026-10-01',
      currency: 'INR',
      amount: '45000',
      notes: null,
      photo_path: null,
      raw_text: null,
      parsed: { source: 'sms', channel: 'inbox', dedupeKey: 'ref:627412345678', confidence: 0.9 },
      payment_method: null,
      target_group_id: null,
      location: null,
      status: 'open' as CaptureRow['status'],
      assigned_expense_id: null,
      assigned_group_id: null,
      created_at: '2026-10-01T09:00:00.000Z',
      local: true,
    });
    const plan = planStatementImport(rows, {
      currency: 'INR',
      draftKeys: new Set(['ref:627412345678']),
    });
    const ticked = new Set(plan.items.filter((i) => i.ticked).map((i) => i.key));
    const result = await applyStatementPlan(plan, ticked, context, deps);
    expect(result).toEqual({ added: 1, enriched: 1, alreadyHad: 0 });
    expect(plan.summary).toMatchObject({ merged: 1, duplicatesSkipped: 1 });

    const open = drafts.openDrafts(OWNER);
    expect(open).toHaveLength(2);
    const enriched = open.find((r) => r.id === 'id:ref:627412345678')!;
    expect(enriched.description).toBe('SWIGGY');
    expect(enriched.parsed).toMatchObject({ source: 'sms', statement: { matched: true } });
  });

  it('puts an undated row on today and says the date was inferred', () => {
    const plan = planStatementImport([row({ date: null, warnings: ['bad_date'] })], {
      currency: 'INR',
    });
    const payload = draftPayload(plan.items[0]!, 'INR', '2026-10-17');
    expect(payload.expenseDate).toBe('2026-10-17');
    expect(payload.parsed).toMatchObject({ dateInferred: true });
    expect((payload.parsed as { confidence: number }).confidence).toBeLessThanOrEqual(0.5);
  });
});

describe('end to end on a synthetic export', () => {
  it('a bank CSV becomes seven ticked debits and two credits waiting under money in', () => {
    const csv =
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n' +
      '01/10/26,UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER,0000627412345678,01/10/26,450.00,,49550.00\n' +
      '02/10/26,NEFT CR-ACME LTD-HDFCN52026100212345,HDFCN52026100212345,02/10/26,,85000.00,134550.00\n';
    const parsed = parseStatementTable(readTable(csv), { today: '2026-10-17' });
    if (!parsed.ok) throw new Error(parsed.reason);
    const plan = planStatementImport(parsed.rows, { currency: 'INR' });
    expect(plan.items.map((i) => [i.section, i.ticked])).toEqual([
      ['out', true],
      ['in', false],
    ]);
  });
});

describe('an unrecognised spreadsheet, as pages for the reader', () => {
  const rows = [
    ['Account Holder', 'SAMPLE HOLDER'],
    ['Account No', '50100123456789'],
    ['Posted', 'Details', 'Out', 'In'],
    ['13/10/2026', 'UPI/627412345678/CAFE 9876543210', '120.00', ''],
    ['14/10/2026', 'SALARY', '', '1000.00'],
  ];

  it('drops everything above the column header', () => {
    expect(transactionRows(rows)[0]).toEqual(['Posted', 'Details', 'Out', 'In']);
    expect(transactionRows(rows)).toHaveLength(3);
  });

  it('masks numbers and sends the header with the rows', () => {
    const pages = tableToPages(rows);
    expect(pages).toHaveLength(1);
    const text = pages[0]!.kind === 'text' ? pages[0]!.text : '';
    expect(text.split('\n')[0]).toBe('Posted | Details | Out | In');
    expect(text).toContain('627412345678');
    expect(text).not.toMatch(/9876543210|SAMPLE HOLDER|50100123456789/);
  });

  it('has nothing to send when no row has a date', () => {
    expect(tableToPages([['a', 'b', 'c']])).toEqual([]);
  });
});

describe('statementRegion', () => {
  it.each([
    ['US', 'USD', 'mdy'],
    ['GB', 'GBP', 'dmy'],
    ['UK', 'GBP', 'dmy'],
    ['AU', 'AUD', 'dmy'],
    ['AE', 'AED', 'dmy'],
    ['IN', 'INR', 'dmy'],
    ['us', 'USD', 'mdy'],
  ])('%s is %s, dates %s by default', (country, currency, order) => {
    expect(statementRegion(country)).toMatchObject({ currency, dateOrder: order });
  });

  it('falls back to the phone\u2019s region, then to India, and never invents a country', () => {
    expect(statementRegion(null, 'AU').currency).toBe('AUD');
    expect(statementRegion(null, null)).toEqual({
      country: null,
      currency: 'INR',
      dateOrder: 'dmy',
    });
    expect(statementRegion('', 'x').country).toBeNull();
  });

  it('flips the order for the switch', () => {
    expect(otherOrder('dmy')).toBe('mdy');
    expect(otherOrder('mdy')).toBe('dmy');
  });
});
