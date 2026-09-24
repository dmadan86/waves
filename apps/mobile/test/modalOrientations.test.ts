import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const roots = [
  fileURLToPath(new URL('../src', import.meta.url)),
  fileURLToPath(new URL('../../../packages/ui/src', import.meta.url)),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('modal orientations', () => {
  // RN's Modal allows portrait alone on iOS while the app also allows
  // upside-down, so a Modal without this prop rotates the app for a frame on
  // the way in and out — the flicker behind every sheet on an upside-down iPad.
  it('every Modal allows the orientations the app does', () => {
    const missing: string[] = [];
    for (const file of roots.flatMap(sourceFiles)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<Modal\b[^>]*>/g)) {
        if (!match[0].includes('supportedOrientations={MODAL_ORIENTATIONS}')) {
          missing.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
