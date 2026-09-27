import { describe, expect, it } from 'vitest';

import { shortPersonName, shortPersonNames } from '@/lib/shortPersonName';

describe('shortPersonName', () => {
  it('takes the first name', () => {
    expect(shortPersonName('Renny Benita')).toBe('Renny');
  });

  it('drops the punctuation and emoji an address book carries', () => {
    expect(shortPersonName('.Rvs Amirnath')).toBe('Rvs');
    expect(shortPersonName('🌴 priya (college)')).toBe('Priya');
    expect(shortPersonName('  ~Arun_K  ')).toBe('Arun');
  });

  it('keeps letters from any script, marks included', () => {
    expect(shortPersonName('கார்த்திக் ராஜா')).toBe('கார்த்திக்');
    expect(shortPersonName('राहुल शर्मा')).toBe('राहुल');
  });

  it('falls back to the raw name when nothing readable is left', () => {
    expect(shortPersonName('🙂')).toBe('🙂');
  });
});

describe('shortPersonNames', () => {
  it('tells apart people who share a first name', () => {
    expect(shortPersonNames(['.Rvs Amirnath', '.Rvs Kumar', 'Renny Benita'])).toEqual([
      'Rvs A.',
      'Rvs K.',
      'Renny',
    ]);
  });

  it('reads past a shared tag when the initials collide too', () => {
    expect(shortPersonNames(['.Rvs Amirnath', '.Rvs Arun', '.Rvs Anand', 'Renny'])).toEqual([
      'Amirnath',
      'Arun',
      'Anand',
      'Renny',
    ]);
  });

  it('leaves a lone first name as it is', () => {
    expect(shortPersonNames(['Priya', 'Arun Raj'])).toEqual(['Priya', 'Arun']);
  });
});
