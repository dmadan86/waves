import { describe, expect, it } from 'vitest';
import { emptyCopy } from '../src/lib/personalUpcoming';

describe('emptyCopy', () => {
  it('picks per-tab copy keys', () => {
    expect(emptyCopy('reminders')).toEqual({
      title: 'emptyRemindersTitle',
      body: 'emptyRemindersBody',
      canClear: true,
    });
    expect(emptyCopy('bills').title).toBe('emptyBillsTitle');
    expect(emptyCopy('bills').canClear).toBe(true);
  });
  it('hides Clear filters on the all tab', () => {
    expect(emptyCopy('all')).toEqual({
      title: 'emptyAllTitle',
      body: 'emptyAllBody',
      canClear: false,
    });
  });
});
