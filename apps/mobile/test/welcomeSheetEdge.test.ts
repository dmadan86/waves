import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The sign-in sheet must reach the screen's bottom edge on notched iPhones:
// the screen only pads the top, and the sheet pads itself by the bottom inset.
const src = readFileSync(join(__dirname, '../src/app/welcome.tsx'), 'utf8');

describe('welcome sheet reaches the bottom edge', () => {
  it('does not pad the bottom safe area around the whole screen', () => {
    expect(src).not.toMatch(/edges=\{\['top', 'bottom'\]\}/);
    expect(src).toMatch(/edges=\{\['top'\]\}/);
  });
  it('pads the sheet by the bottom inset', () => {
    expect(src).toMatch(/paddingBottom: theme\.spacing\.sm \+ insets\.bottom/);
  });
});
