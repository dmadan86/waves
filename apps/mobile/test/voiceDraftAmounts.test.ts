import { describe, expect, it } from 'vitest';

import { heardCaptureInput, unclearAmount } from '../src/lib/voiceDraftPure';
import { parseVoiceExpenses } from '../src/lib/voiceExpense';

const draft = (s: string) => heardCaptureInput(s, '2026-11-22', 'INR');

describe('heardCaptureInput amount forms', () => {
  it.each([
    ['paid 30 rupees 50 paise for tea', 3050n, 'tea'],
    ['rs.30 for chai', 3000n, 'chai'],
    ['rs 30 chai', 3000n, 'chai'],
    ['₹ 1,00,000.50 rent', 10000050n, 'rent'],
    ['spent ₹1,00,000 on rent', 10000000n, 'rent'],
    ['dinner 1,250.75', 125075n, 'dinner'],
    ['two hundred for lunch', 20000n, 'lunch'],
    ['lunch 450', 45000n, 'lunch'],
  ])('%s -> %s', (said, amount, note) => {
    const d = draft(said);
    expect(d.amount).toBe(amount);
    expect(d.description).toBe(note);
    expect(d.rawText).toBe(said);
  });

  it('a phone number alone is not an amount: filed amount-less with the words', () => {
    const d = draft('call 9876543210');
    expect(d.amount).toBe(0n);
    expect(d.description).toBe('call 9876543210');
  });

  it('a phone number beside a real amount files only the real one', () => {
    expect(draft('call 9876543210 about the 500 taxi').amount).toBe(50000n);
    expect(draft('my number is 9876543210 and I paid 80 for tea').amount).toBe(8000n);
  });

  it('a year or date in the sentence is not the amount', () => {
    expect(draft('in 2026 I spent 500 on fuel').amount).toBe(50000n);
    expect(draft('june 12 spent 300 on food').amount).toBe(30000n);
  });

  it('several clear amounts in one currency are filed as their total, words kept', () => {
    const d = draft('paid 200 for lunch and 300 for dinner');
    expect(d.amount).toBe(50000n);
    expect(d.description).toBe('lunch 200, dinner 300');
    expect(d.rawText).toBe('paid 200 for lunch and 300 for dinner');
  });

  it.each([
    ['Rs 1000 for food 800 rupees for dress', 'food 1000, dress 800'],
    ['food 1000 and dress 800', 'food 1000, dress 800'],
    ['1000 rupees food, 800 dress', 'food 1000, dress 800'],
  ])('keeps each amount with its own words: %s', (said, note) => {
    const parsed = parseVoiceExpenses(said, []);
    expect(parsed.items.map((item) => item.note)).toEqual([note]);
    expect(parsed.items[0].category).toBe('food');
  });

  it('no digits at all files nothing but the sentence, in the account currency', () => {
    const d = heardCaptureInput('  bought some stuff  ', '2026-11-22', 'USD');
    expect(d).toMatchObject({ amount: 0n, currency: 'USD', description: 'bought some stuff' });
  });

  it('scales by the filed currency exponent', () => {
    expect(heardCaptureInput('paid 500 yen for ramen', '2026-11-22', 'JPY').amount).toBe(500n);
  });
});

describe('unclearAmount', () => {
  it('accepts plain, grouped and decimal answers', () => {
    expect(unclearAmount('450')).toBe('450');
    expect(unclearAmount('1,250.75')).toBe('1250.75');
    expect(unclearAmount(' 1 000 ')).toBe('1000');
  });

  it('rejects words, zero, negatives, 3 decimals and empty', () => {
    for (const bad of ['', 'about 500', '0', '0.00', '-5', '1.234', '5.', 'abc'])
      expect(unclearAmount(bad)).toBeNull();
  });
});
