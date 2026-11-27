/** CodeRabbit follow-ups on the rentals screens: rules that can fail quietly. */

import { readFileSync } from 'node:fs';
import { recurringOccurrenceId } from '@waves/core';
import { describe, expect, it } from 'vitest';

import {
  shouldAnimateFlowStep,
  shouldAnimatePostedLayout,
  shouldShowPreviousBalance,
} from '../src/lib/rentalExtrasBehavior';
import { wealthAr, wealthEn, wealthHi, wealthTa } from '../src/i18n/wealth';
import {
  e2eeNoteFor,
  fullPaymentOf,
  outstandingRent,
  rentEntryId,
  writesReady,
} from '../src/lib/rentalScope';

const src = (p: string): string => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const line = (paid: bigint, ruleId = 'old') =>
  ({ date: '2026-11-05', amount: 1000n, ruleId, paid, status: 'due' }) as const;

describe('outstanding rent', () => {
  it('is zero when every due is paid, not the full instalment', () => {
    expect(outstandingRent(undefined)).toBe(0n);
  });
  it('is what is left of the oldest unpaid due', () => {
    expect(outstandingRent(line(400n))).toBe(600n);
  });
});

describe('fixed paid-in-full id', () => {
  it('is keyed by the rule that generated the due, not the current rule', () => {
    const full = fullPaymentOf(line(0n, 'old'), 1000n);
    expect(full).toEqual({ date: '2026-11-05', ruleId: 'old' });
    expect(rentEntryId(true, full!.ruleId, full!.date, () => 'x')).toBe(
      recurringOccurrenceId('old', '2026-11-05'),
    );
  });
  it('is none for a part payment or a part-paid due', () => {
    expect(fullPaymentOf(line(0n), 500n)).toBeNull();
    expect(fullPaymentOf(line(100n), 900n)).toBeNull();
    expect(fullPaymentOf(undefined, 1n)).toBeNull();
  });
});

describe('writes are ready', () => {
  it('waits for the member id in a group, never in Personal', () => {
    expect(writesReady(undefined, null)).toBe(true);
    expect(writesReady('g1', null)).toBe(false);
    expect(writesReady('g1', 'm1')).toBe(true);
  });
});

describe('encryption notice', () => {
  it('names the partner only for a couple; a home says members of the group', () => {
    for (const w of [wealthEn, wealthTa, wealthHi, wealthAr]) {
      expect(e2eeNoteFor(w, 'couple')).toBe(w.e2eeNote);
      expect(e2eeNoteFor(w, 'home')).toBe(w.e2eeNoteHome);
      expect(e2eeNoteFor(w, undefined)).toBe(w.e2eeNoteHome);
      expect(w.e2eeNoteHome).not.toBe(w.e2eeNote);
      expect(w.e2eeNoteHome.length).toBeGreaterThan(10);
    }
    expect(wealthEn.e2eeNoteHome).toBe(
      'End-to-end encrypted. Only members of this group can read this.',
    );
  });
});

describe('wiring', () => {
  it('the group summary memo depends on the month', () => {
    const s = src('app/group/[id]/index.tsx');
    expect(s).toMatch(/const rentalMonth = todayIso\(\)\.slice\(0, 7\)/);
    expect(s).toMatch(/\[rentalRecords, rentalMonth, group\.data\?\.default_currency\]/);
  });
  it('a failed rental save keeps the form', () => {
    const s = src('app/rentals/add.tsx');
    const tail = s.slice(s.indexOf('await writes.createRental'));
    expect(tail.slice(0, tail.indexOf('};'))).toMatch(/router\.back\(\);\s*\} catch/);
    expect(s).toMatch(/setError\(friendlyError\(error, t\.couldNotSave/);
  });
  it('the tenant form waits for the member id and keeps itself on failure', () => {
    const s = src('app/rentals/tenant.tsx');
    expect(s).toMatch(/writesReady\(space, memberId\)/);
    expect(s).not.toMatch(/\.finally\(\(\) => router\.back\(\)\)/);
  });
  it('the deposit row no longer opens the tenant-left sheet', () => {
    const s = src('app/rentals/[id].tsx');
    expect(s).not.toMatch(/refundableDepositHeld[^\n]*setOpen\('left'\)/);
  });
});

describe('animation guards', () => {
  it('posted-row layout animates only while a row is posted, and a filter change clears it', () => {
    expect(shouldAnimatePostedLayout(null)).toBe(false);
    expect(shouldAnimatePostedLayout('k')).toBe(true);
    expect(src('app/personal/upcoming.tsx')).toMatch(/setTab\(value\);\s*setPostedKey\(null\)/);
  });
  it('the previous figure is never rendered next to a masked one', () => {
    expect(shouldShowPreviousBalance('₹5', '₹9', '••••')).toBe(true);
    expect(shouldShowPreviousBalance('••••', '₹9', '••••')).toBe(false);
    expect(shouldShowPreviousBalance('₹5', '••••', '••••')).toBe(false);
  });
  it('the first wizard step does not animate in', () => {
    expect(shouldAnimateFlowStep(0)).toBe(false);
    expect(shouldAnimateFlowStep(2)).toBe(true);
  });
});

describe('document replacement', () => {
  it('reloads even when removing an old file fails', async () => {
    const { attachRentalDocs } = await import('../src/lib/rentalExtrasBehavior');
    let reloads = 0;
    await expect(
      attachRentalDocs(
        ['a'],
        ['old'],
        async () => {},
        async () => {
          throw new Error('x');
        },
        async () => {
          reloads += 1;
        },
      ),
    ).rejects.toThrow('x');
    expect(reloads).toBe(1);
  });
});
