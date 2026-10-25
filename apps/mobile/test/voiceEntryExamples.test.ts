import { describe, expect, it } from 'vitest';
import { voiceEntryExamples } from '@/lib/voiceEntryExamples';

const templates = [
  'Coffee {amount} at CCD',
  'Rent {amount} on 1st every month',
  'Petrol {amount} split with Ravi',
];
describe('entry examples', () => {
  it('formats rupees with Indian grouping and preserves the expense instructions', () => {
    expect(voiceEntryExamples(templates, 'INR', 'en-US')).toEqual([
      '“Coffee ₹300 at CCD”',
      '“Rent ₹15,000 on 1st every month”',
      '“Petrol ₹2,000 split with Ravi”',
    ]);
  });
  it('uses the selected currency instead of hard-coded rupees', () => {
    expect(voiceEntryExamples(templates, 'USD', 'en-US')[0]).toBe('“Coffee $300 at CCD”');
    expect(voiceEntryExamples(templates, 'EUR', 'de-DE')[1]).toContain('15.000');
  });
  it.each(['ta-IN', 'hi-IN', 'ar-AE'])(
    'keeps translated templates and local number formatting in %s',
    (locale) => {
      const text = voiceEntryExamples(
        ['காபி {amount}', 'किराया {amount}', 'بنزين {amount}'],
        'INR',
        locale,
      );
      expect(text[0]).toContain('காபி');
      expect(text[1]).toContain('किराया');
      expect(text[2]).toContain('بنزين');
      expect(text.join('')).not.toContain('{amount}');
    },
  );
});
