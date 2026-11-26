import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = (p: string): string => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('Your dates lives under Personal → Upcoming, not Settings', () => {
  it('Settings no longer lists Your dates', () => {
    expect(src('app/profile.tsx')).not.toMatch(/route: '\/dates'/);
  });

  it('Upcoming opens Your dates from its header, even when the list is empty', () => {
    const upcoming = src('app/personal/upcoming.tsx');
    expect(upcoming).toMatch(/label=\{t\.dates\.title\}[\s\S]{0,120}router\.push\('\/dates'\)/);
  });
});
