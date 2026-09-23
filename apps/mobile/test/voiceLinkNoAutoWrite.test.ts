/**
 * Words that arrive on a link never write on their own.
 *
 * `waves://voice?heard=…` hands the voice screen a transcript. Anything can open
 * that link — a web page, a chat message — so a confident command in it
 * ("settle up with Ravi") must wait for a tap, not the four-second Undo timer
 * that the reader's own voice gets.
 *
 * Source-reading, like `screenHeroShape.test.ts`: the voice screen pulls in the
 * mic, Reanimated and the sheets, which this node-environment suite cannot
 * mount, but the gate is legible in the text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const voice = readFileSync(join(__dirname, '../src/app/voice.tsx'), 'utf8');

const between = (start: string, end: string): string => {
  const from = voice.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = voice.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return voice.slice(from, to);
};

describe('a linked-in transcript', () => {
  it('is marked as coming from a link before it is interpreted', () => {
    const effect = between('if (!widgetHeard) return;', 'handleTranscript(widgetHeard);');
    expect(effect).toContain('heardFromLink.current = true;');
  });

  it('holds for Confirm instead of arming the timer', () => {
    const begin = between('const beginAutoCommit = ', 'const runAutoCommit = ');
    const gate = begin.indexOf('if (heardFromLink.current)');
    const timer = begin.indexOf('setTimeout(');
    expect(gate).toBeGreaterThan(-1);
    expect(timer).toBeGreaterThan(gate);
    expect(begin.slice(gate, timer)).toContain('needsConfirm: true');
    expect(begin.slice(gate, timer)).toContain('return;');
  });

  it('is cleared once the reader speaks for themselves', () => {
    const listen = between('onListen={() => {', '}}');
    expect(listen).toContain('heardFromLink.current = false;');
  });

  it('offers a Confirm button while held', () => {
    expect(voice).toMatch(/needsConfirm \? \(\s*<Button\s+label=\{t\.voice\.autoConfirm\}/);
  });
});
