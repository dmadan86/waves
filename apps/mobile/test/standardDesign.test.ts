import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('standard design', () => {
  it.each(['src/app/group/[id]/insights.tsx', 'src/app/group/[id]/month.tsx'])(
    '%s is built from the standard components',
    (path) => {
      const source = read(path);
      expect(source).toContain("from '@/components/standard'");
      expect(source).toContain('ScenicHeader');
      expect(source).toContain('StatCard');
    },
  );

  it('points the components at the design doc, and the doc exists', () => {
    expect(read('src/components/standard/index.ts')).toContain('docs/design-standard.md');
    expect(
      readFileSync(new URL('../../../docs/design-standard.md', import.meta.url), 'utf8'),
    ).toContain('An action is drawn only when it does something');
  });

  it('draws See all only when given an action', () => {
    expect(read('src/components/standard/parts.tsx')).toMatch(/action \? \(/);
  });
});
