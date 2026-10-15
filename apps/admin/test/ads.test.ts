import { describe, expect, it } from 'vitest';

import { adsTotals } from '../src/lib/ads';

describe('adsTotals', () => {
  it('adds up the days, reading bigint strings as numbers', () => {
    expect(
      adsTotals([
        { rewards: '4', voice_rewards: '3', scan_rewards: '1', cap_hits: '1' },
        { rewards: 2, voice_rewards: 0, scan_rewards: 2, cap_hits: 0 },
      ]),
    ).toEqual({ rewards: 6, voice: 3, scan: 3, capHits: 1 });
  });

  it('is zero with no days and ignores junk', () => {
    expect(adsTotals([])).toEqual({ rewards: 0, voice: 0, scan: 0, capHits: 0 });
    expect(
      adsTotals([{ rewards: 'x', voice_rewards: null as never, scan_rewards: 1, cap_hits: 0 }]),
    ).toEqual({ rewards: 0, voice: 0, scan: 1, capHits: 0 });
  });
});
