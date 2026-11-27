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

describe('welcome cards stay on screen and off the tagline', () => {
  it('holds the dinner card to the right edge on every width', () => {
    expect(src).not.toMatch(/left: windowWidth \* 0\.727/);
  });
  it('keeps the cards below the tagline with a gap', () => {
    expect(src).toMatch(/Math\.min\(screenHeight \* aboveSheet, stage - 12\)/);
  });
});

describe('welcome picture fills the width', () => {
  it('never shows the friends as a narrow box with hard edges', () => {
    expect(src).toMatch(
      /resizeMode="cover"\s*\n\s*style=\{\{ width: windowWidth, height: friendsH/,
    );
  });
});
