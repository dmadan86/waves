/**
 * Where Review and Activity have to live for expo-router to resolve them
 * right, pinned so a future move of either screen breaks a test rather than
 * a person's tab bar or dashboard shortcut.
 *
 * A `(tabs)` folder is a route GROUP — its parentheses contribute no path
 * segment — so moving a screen in or out of it changes which navigator owns
 * it (and so whether the bottom bar highlights it) without changing the URL
 * that reaches it at all. That is the whole trick this PR relies on:
 * `/captures` resolves to the same path whether the file sits at
 * `app/captures.tsx` or `app/(tabs)/captures.tsx`, so every existing
 * `router.push`/`navigate` call and every `waves://captures` deep link
 * (`lib/captureNudge/schedule.ts`) keeps working unchanged. `tabBar.test.ts`
 * covers the navigator-level behaviour this file structure produces
 * (`resolveTabBar`, `tabBarRouteForSelection`); this file pins the physical
 * move those tests assume.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const appDir = join(__dirname, '../src/app');

describe('the Review/Activity tab swap', () => {
  it('moves captures.tsx into the tab group — the URL is unchanged, only the navigator', () => {
    expect(existsSync(join(appDir, '(tabs)/captures.tsx'))).toBe(true);
    expect(existsSync(join(appDir, 'captures.tsx'))).toBe(false);
  });

  it('moves activity.tsx out of the tab group and onto the root stack, the mirror move', () => {
    expect(existsSync(join(appDir, 'activity.tsx'))).toBe(true);
    expect(existsSync(join(appDir, '(tabs)/activity.tsx'))).toBe(false);
  });

  it("lists exactly the four bar destinations, Review in Activity's old slot", () => {
    const layout = readFileSync(join(appDir, '(tabs)/_layout.tsx'), 'utf8');
    const names = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toEqual(['index', 'friends', 'captures', 'me']);
  });

  it('registers Activity as a slid-in root stack screen, not a tab', () => {
    const rootLayout = readFileSync(join(appDir, '_layout.tsx'), 'utf8');
    expect(rootLayout).toMatch(/<Stack\.Screen name="activity" options={slide} \/>/);
    expect(rootLayout).not.toMatch(/<Stack\.Screen name="captures"/);
  });
});
