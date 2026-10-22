/**
 * Balance and Settle up are one tab. The group screen has no Settle tab; the
 * Balances tab opens on the payments to settle, then everyone's balance, and
 * every old way to settle lands there.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { groupTabFromParam, settleHref } from '../src/lib/groupTab';

const read = (path: string): string => readFileSync(join(process.cwd(), 'src', path), 'utf8');

describe('group screen: one Balances tab', () => {
  const screen = read('app/group/[id]/index.tsx');

  it('has no Settle tab', () => {
    expect(screen).not.toMatch(/Settle = 'settle'/);
    expect(screen).not.toMatch(/Tab\.Settle/);
    expect(screen).not.toMatch(/<SettleBody/);
  });

  it("shows the payments section, then everyone's balance, on Balances", () => {
    const payments = screen.indexOf('<SettlePayments');
    const balances = screen.indexOf('title={t.group.everyonesBalance}');
    expect(payments).toBeGreaterThan(-1);
    expect(balances).toBeGreaterThan(payments);
    expect(screen.indexOf('t.group.paymentsToSettle')).toBeLessThan(payments);
  });

  it('keeps the missing-rates card on Balances', () => {
    expect(screen).toMatch(/activeTab === Tab\.Balances[\s\S]{0,400}<MissingRatesCard/);
  });
});

describe('settle deep links map to Balances', () => {
  it('maps tab=settle and tab=balances to the Balances tab', () => {
    expect(groupTabFromParam('settle')).toBe('balances');
    expect(groupTabFromParam('balances')).toBe('balances');
    expect(groupTabFromParam('vendors')).toBe('vendors');
    expect(groupTabFromParam(undefined)).toBe('expenses');
  });

  it('builds the settle door as the Balances tab', () => {
    expect(settleHref('g1')).toBe('/group/g1?tab=balances');
  });

  it('keeps the old /settle route as a redirect, not a screen', () => {
    const route = read('app/group/[id]/settle.tsx');
    expect(route).toMatch(/<Redirect/);
    expect(route).toMatch(/tab: 'balances'/);
    expect(route).not.toMatch(/SettlePayments|SettleBody/);
  });

  it('no caller pushes /group/<id>/settle any more', () => {
    for (const file of [
      'app/personal/loans.tsx',
      'app/group/[id]/settings.tsx',
      'app/group/[id]/member/[memberId].tsx',
      'app/friends/person/[key].tsx',
      'app/friends/person/[key]/settle.tsx',
      'components/home/SettleGroupList.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/\/settle`/);
    }
  });
});

describe('settling keeps you in the group', () => {
  it('passes onRecorded so recording does not router.back() out of the group', () => {
    expect(read('app/group/[id]/index.tsx')).toMatch(
      /useSettleFlow\(\s*groupId,\s*lensLedger,\s*\(\) => setTab\(Tab\.Balances\),/,
    );
  });

  it('keeps Remind on every owed-to-you payment row beside the one Record button', () => {
    const body = read('components/settle/SettleBody.tsx');
    const row = body.slice(body.indexOf('function OwedPersonRow'));
    expect(row).toMatch(/useRemind\(/);
    expect(row).toMatch(/onPress=\{remind\.open\}/);
    expect(row).toMatch(/t\.misc\.settleRecord\b/);
    expect(row).toMatch(/\{remind\.sheet\}/);
  });
});
