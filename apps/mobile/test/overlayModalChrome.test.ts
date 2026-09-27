import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const overlaySource = () =>
  readFileSync(
    fileURLToPath(new URL('../../../packages/ui/src/components/Overlay.tsx', import.meta.url)),
    'utf8',
  );

const functionBody = (source: string, name: 'Sheet' | 'Popup'): string => {
  const start = source.indexOf(`export function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);

  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
};

describe('overlay modal chrome', () => {
  it('draws both shared modal surfaces through the system bars', () => {
    const source = overlaySource();

    for (const name of ['Sheet', 'Popup'] as const) {
      const body = functionBody(source, name);
      expect(body).toContain('statusBarTranslucent');
      expect(body).toContain('navigationBarTranslucent');
    }
  });
});
