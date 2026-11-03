import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/waves', () => ({ supabase: {} }));

import { webHref } from '../src/lib/company/activity';
import { createGate, isSlotRequired } from '../src/lib/company/slots';
import { activityText } from '../src/components/company/Activity';
import { companyEn } from '../src/i18n-company';

describe('webHref', () => {
  it('maps phone routes to web pages', () => {
    expect(webHref('g', 'company-entry-view?entry=e1')).toBe('/c/g/entry/e1');
    expect(webHref('g', 'company-statement?member=m1')).toBe('/c/g/statement/m1');
    expect(webHref('g', 'company-bill?docId=d1')).toBe('/c/g/bills?docId=d1');
    expect(webHref('g', 'company-work')).toBe('/c/g/more');
    expect(webHref('g', 'unknown')).toBe('/c/g/more');
  });
});

describe('slot gate', () => {
  it('trusts the server, else the local count', () => {
    expect(createGate({ needs_slot: true, has_free_slot: false }, 0)).toBe('paywall');
    expect(createGate({ needs_slot: true, has_free_slot: true }, 3)).toBe('create');
    expect(createGate(null, 0)).toBe('create');
    expect(createGate(null, 1)).toBe('paywall');
    expect(isSlotRequired(new Error('COMPANY_SLOT_REQUIRED: x'))).toBe(true);
    expect(isSlotRequired('other')).toBe(false);
  });
});

describe('activityText', () => {
  it('fills the sentence and says an attendance status in words', () => {
    const text = activityText(companyEn.activity, {
      id: '1',
      at: 0,
      group: 'attendance',
      icon: '',
      text: 'attendanceOne',
      vars: { actor: 'You', name: 'Ravi', status: 'half' },
      amount: null,
      href: '',
      byMe: true,
    });
    expect(text).toBe('You marked Ravi half day');
  });
});
