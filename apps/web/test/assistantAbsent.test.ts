import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The Waves Assistant is mobile only. Nothing under apps/web/src may import its
 * components or call its function, so a component moved into a shared package
 * cannot quietly carry it onto the web.
 */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('the web has no assistant', () => {
  const sources = files(SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

  it('imports no assistant or follow-up component', () => {
    const hits = sources.filter(({ text }) =>
      /from ['"][^'"]*(Assistant\w*|VoiceFollowUps|VoiceAgentPanel|followUp\w*)['"]/.test(text),
    );
    expect(hits.map((h) => h.file)).toEqual([]);
  });

  it('never calls the voice-agent function', () => {
    const hits = sources.filter(({ text }) => /['"`]voice-agent['"`]/.test(text));
    expect(hits.map((h) => h.file)).toEqual([]);
  });
});
