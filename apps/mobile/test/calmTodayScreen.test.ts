import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
const me = read('../src/app/(tabs)/me.tsx');
const today = read('../src/components/personal/PersonalToday.tsx');
const i18n = read('../src/i18n/index.ts');

describe('Personal Today screen', () => {
  it('is the calm header plus the Today body, with a + and a bell', () => {
    expect(me).toMatch(/<CalmHeader/);
    expect(me).toMatch(/title=\{t\.personal\.today\}/);
    expect(me).toMatch(/<PersonalToday /);
    expect(me).toMatch(/icon="add"/);
    expect(me).toMatch(/icon="notifications-outline"/);
  });
  it('lays out strip, summary, done, one Needs-you card, nudge, later', () => {
    const order = ['<TodayWeek', '<DoneLine', '<NeedsYouCard', '<NudgeRow', '<ComingUpList'];
    const at = order.map((k) => today.indexOf(k));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('uses the locale first weekday, the existing picker, the same writes and a calm empty state', () => {
    expect(today).toMatch(/WEEK_START/);
    expect(today).toMatch(/<CategoryPicker/);
    expect(today).toMatch(/entryRecord\(/);
    expect(today).toMatch(/usePostRecurring/);
    expect(today).toMatch(/c\.allSet/);
    expect(today).toMatch(/visibleNeeds\(items, expanded\)/);
  });
  it('has every calm string in all four languages', () => {
    expect(i18n.match(/^ {2}calm: \{/gm)).toHaveLength(5);
    expect(i18n.match(/^ {4}needsTitle: /gm)).toHaveLength(5);
  });
});
