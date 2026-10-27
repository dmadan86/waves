/**
 * Your stake on an expense row is a bold amount plus the Lent / Borrowed pill
 * (components/standard/StakePill), never the long "you lent ₹X" sentence.
 *
 * The long strings (`youLent` / `youBorrowed`) exist for screen readers. This
 * scans the source so a row cannot slip back to drawing them as visible text:
 * only the files below may reference them, and each says why.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

const ALLOWED: Record<string, string> = {
  'app/group/[id]/departed/[memberId].tsx':
    'the mockup’s "You lent to {name}" summary card label, not a row caption',
  'components/home/HomeBalanceCard.tsx': 'the "You lent" headline summary label, not a row caption',
  'app/group/[id]/index.tsx': 'directionLabel feeds the row accessibilityLabel only',
  'components/timeline/TimelineList.tsx': 'the long form rides the row accessibilityLabel only',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !path.endsWith(join('i18n', 'index.ts')) ? [path] : [];
  });
}

const LONG = /\b(youLent|youBorrowed)\b/;
const files = sources(SRC).map((p) => [relative(SRC, p), readFileSync(p, 'utf8')] as const);

describe('stake rows use the Lent / Borrowed pill', () => {
  it('only allowlisted files reference the long youLent / youBorrowed strings', () => {
    const offenders = files
      .filter(([p, text]) => LONG.test(text) && !(p in ALLOWED))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it('the timeline row never renders the long form as visible text', () => {
    const text = files.find(([p]) => p === 'components/timeline/TimelineList.tsx')![1];
    expect(text).not.toMatch(/^\s*\{share\}\s*$/m);
    expect(text).toMatch(/StakeCaptionPill/);
  });

  it('the group row draws its pill through the shared StakePill', () => {
    const text = files.find(([p]) => p === 'app/group/[id]/index.tsx')![1];
    expect(text).toMatch(/<StakePill\b/);
    expect(text).not.toMatch(/\{directionLabel\}/);
  });
});
