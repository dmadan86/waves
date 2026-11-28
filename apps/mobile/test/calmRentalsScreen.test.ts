import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../src/app/rentals/index.tsx'), 'utf8');
const i18n = readFileSync(join(__dirname, '../src/i18n/index.ts'), 'utf8');

describe('calm Rentals list', () => {
  it('leads with the date line, summary, Due now card, done line and lease nudge', () => {
    const order = ['<CalmHeader', '<SummaryLine', '<NeedsYouCard', '<DoneLine', '<NudgeRow'];
    const at = order.map((k) => src.indexOf(k));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('reuses the rent-received write and keeps former couples read-only', () => {
    expect(src).toMatch(/useRentActions\(space, today\)/);
    expect(src).toMatch(/actions\.markReceived\(r\)/);
    expect(src).toMatch(/readOnly\s*\?\s*\[\]/);
    expect(src).toMatch(/readOnly \? null : <CalmIconButton/);
    expect(src).toMatch(/const lease = readOnly \? null/);
  });
  it('keeps couple spaces scoped through the space param', () => {
    expect(src).toMatch(/spaceParams\(space\)/);
    expect(src).toMatch(/usePersonalLedger\(space\)/);
  });
  it('has the strings in all languages', () => {
    expect(i18n.match(/^ {4}leaseEnds: /gm)).toHaveLength(5);
  });
});

describe('Arabic day plurals', () => {
  it('has dual and many forms for the lease-away line', () => {
    const line = i18n.slice(i18n.lastIndexOf('    leaseAway:')).slice(0, 400);
    expect(line).toMatch(/two: /);
    expect(line).toMatch(/many: /);
  });
});

describe('paid status', () => {
  it('uses the month-wide horizon, not the due-now one', () => {
    expect(src).toMatch(/horizonDays: monthHorizon\(today\)/);
    expect(src).toMatch(/paidTenancies\(activeTenancies, unsettled\)/);
  });
});
