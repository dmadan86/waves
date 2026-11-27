import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pagerFrame } from '../src/lib/introFitPure';

// The iOS pager (react-native-pager-view 8, a SwiftUI paging scroll view) pushes its pages
// down by the top safe area while JS lays them out from y=0. Cards sized to the full box then
// ran a status bar's height past the dots row, so the title, the dots and Next collided.
describe('pagerFrame', () => {
  it('pulls the iOS pager up by the top inset so pages land where JS laid them out', () => {
    expect(pagerFrame('ios', 59)).toEqual({
      position: 'absolute',
      top: -59,
      left: 0,
      right: 0,
      bottom: 0,
    });
    expect(pagerFrame('ios', 20)).toMatchObject({ top: -20 });
  });
  it('leaves other platforms alone', () => {
    expect(pagerFrame('android', 24)).toEqual({ flex: 1 });
  });
  it('is what TourPager actually applies', () => {
    const src = readFileSync(join(__dirname, '../src/components/TourPager.tsx'), 'utf8');
    expect(src).toContain('pagerFrame(');
  });
});
