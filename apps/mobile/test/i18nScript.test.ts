/**
 * Every locale block holds only its own script. Machine-written strings have
 * twice landed one language off (Tamil in en, Hindi in ta); this catches it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '../src/i18n/index.ts'), 'utf8').split('\n');
const SCRIPTS: Record<string, RegExp> = {
  ta: /[஀-௿]/,
  hi: /[ऀ-ॿ]/,
  ar: /[؀-ۿ]/,
};

function block(lang: string): string[] {
  const start = SOURCE.findIndex((line) => line.startsWith(`const ${lang}: UiStrings = {`));
  const end = SOURCE.findIndex((line, i) => i > start && line === '};');
  expect(start).toBeGreaterThan(-1);
  return SOURCE.slice(start, end);
}

describe('locale blocks', () => {
  for (const lang of ['en', 'ta', 'hi', 'ar']) {
    it(`${lang} has no strings in another locale's script`, () => {
      const foreign = block(lang).filter((line) =>
        Object.entries(SCRIPTS).some(([other, script]) => other !== lang && script.test(line)),
      );
      expect(foreign).toEqual([]);
    });
  }
});
