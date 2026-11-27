import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const app = join(__dirname, '../src/app');

function tsxUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxUnder(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

// Settings pages and the settings-like screens that open from them.
const files = [
  ...tsxUnder(join(app, 'settings')),
  join(app, 'profile.tsx'),
  join(app, 'new-company.tsx'),
  ...tsxUnder(join(app, 'dates')),
];

describe('one header for every settings screen', () => {
  it.each(files.map((f) => [f.slice(app.length + 1), readFileSync(f, 'utf8')]))(
    '%s uses PlainHeader only',
    (_name, source) => {
      // A bare re-export (security -> lock) draws nothing of its own.
      if (/^export \{ default \} from/m.test(source)) return;
      expect(source).toContain('<PlainHeader');
      expect(source).not.toMatch(/<ScenicHeader|<PhotoHeader/);
      expect(source).not.toContain("directionalIcon('chevron-back')");
    },
  );
});

describe('opening a screen is quiet', () => {
  it('two-step shows a load failure only after a tap', () => {
    const source = readFileSync(join(app, 'settings/two-step.tsx'), 'utf8');
    expect(source).toContain("(acted || result.status !== 'unavailable')");
    expect(source).not.toContain('autoFocus');
  });
  it.each(['settings/redeem.tsx', 'settings/feedback.tsx', 'new-company.tsx'])(
    '%s does not autofocus',
    (file) => {
      const source = readFileSync(join(app, file), 'utf8');
      expect(source).not.toContain('autoFocus');
      expect(source).toContain('automaticallyAdjustKeyboardInsets');
    },
  );
});
