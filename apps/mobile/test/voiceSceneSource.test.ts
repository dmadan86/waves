/** The voice screen wears the app's shared backdrop, not a one-off photograph. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('voice screen background source', () => {
  it('mounts VoiceScene, which is built from the shared FooterWaves', () => {
    expect(read('src/app/voice.tsx')).toContain('<VoiceScene />');
    const scene = read('src/components/voice/VoiceScene.tsx');
    expect(scene).toContain("from '@/components/FooterWaves'");
    expect(scene).toContain('<FooterWaves');
    expect(scene).not.toContain('voice-scene.webp');
  });

  it('shares FooterWaves with the group screen', () => {
    expect(read('src/app/group/[id]/index.tsx')).toContain("from '@/components/FooterWaves'");
  });
});
