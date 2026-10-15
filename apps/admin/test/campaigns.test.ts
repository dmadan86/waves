import { describe, expect, it } from 'vitest';

import { campaignLabel, ofInstalls } from '../src/lib/campaigns';

describe('campaignLabel', () => {
  it('joins the three tags', () => {
    expect(campaignLabel({ source: 'meta', medium: 'paid', campaign: 'diwali_in' })).toBe(
      'meta / paid / diwali_in',
    );
  });

  it('keeps a missing tag visible', () => {
    expect(campaignLabel({ source: 'google-play', medium: '', campaign: '(none)' })).toBe(
      'google-play / (none) / (none)',
    );
  });
});

describe('ofInstalls', () => {
  it('shows the count with its share of installs', () => {
    expect(ofInstalls(3, 10)).toBe('3 · 30.0%');
    expect(ofInstalls('1', '8')).toBe('1 · 12.5%');
  });

  it('shows only the count when there are no installs to divide by', () => {
    expect(ofInstalls(0, 0)).toBe('0');
  });
});
