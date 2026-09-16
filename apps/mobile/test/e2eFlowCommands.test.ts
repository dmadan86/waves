/**
 * The Maestro flows use commands Maestro actually has.
 *
 * Every flow in `e2e/` was dead, and had been from the day they were written.
 * They called `extendedWaitUntilVisible`, which is not a Maestro command — the
 * real one is `extendedWaitUntil` with a `visible:` or `notVisible:` selector —
 * and Maestro answers an unknown command by refusing the whole file:
 *
 *     Invalid Command: extendedWaitUntilVisible at e2e/login.yaml:33:27
 *
 * `login.yaml` is the sign-in preamble every other flow runs first, so not one
 * flow ever reached a single assertion. Nothing said so, because the CI job was
 * gated off; the first run after ungating it refused all twenty in a row.
 *
 * A misspelled command is the cheapest possible bug and it cost the entire
 * suite, so it should not need a three-quarter-hour emulator run to find. This
 * reads the flows as text and checks every command against the vocabulary — in
 * the two minutes the rest of CI takes, on every commit, whether or not the
 * nightly ran.
 *
 * Text rather than a YAML parse on purpose: the only thing in question is the
 * word after the dash, the repo has no YAML parser as a direct dependency, and
 * adding one to check a word would be a strange trade.
 *
 * When Maestro gains a command this does not know, add it to `COMMANDS` — that
 * edit is the point. It is a list somebody has to agree with, which is what
 * makes a typo visible.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const FLOW_DIR = join(__dirname, '..', '..', '..', 'e2e');

/**
 * Maestro's command vocabulary, as of the CLI these flows run against.
 *
 * Not every command Maestro has — only the ones this repo uses plus the near
 * neighbours somebody would reach for next. A command missing from here fails
 * loudly and is added deliberately; that is better than a permissive check that
 * would have waved `extendedWaitUntilVisible` through.
 */
const COMMANDS: ReadonlySet<string> = new Set([
  'addMedia',
  'assertNotVisible',
  'assertTrue',
  'assertVisible',
  'back',
  'clearKeychain',
  'clearState',
  'copyTextFrom',
  'doubleTapOn',
  'eraseText',
  'evalScript',
  'extendedWaitUntil',
  'hideKeyboard',
  'inputRandomEmail',
  'inputRandomNumber',
  'inputRandomPersonName',
  'inputRandomText',
  'inputText',
  'killApp',
  'launchApp',
  'longPressOn',
  'openLink',
  'pasteText',
  'pressKey',
  'repeat',
  'retry',
  'runFlow',
  'runScript',
  'scroll',
  'scrollUntilVisible',
  'setAirplaneMode',
  'setLocation',
  'startRecording',
  'stopApp',
  'stopRecording',
  'swipe',
  'takeScreenshot',
  'tapOn',
  'toggleAirplaneMode',
  'travel',
  'waitForAnimationToEnd',
]);

/** Every command a flow issues, in order, with the line it is on. */
function commandsIn(source: string): { command: string; line: number }[] {
  const found: { command: string; line: number }[] = [];
  source.split('\n').forEach((text, index) => {
    // A command is a top-level list item: `- tapOn: 'x'`, or `- back` with no
    // argument at all. Anything indented is a command's own parameters.
    const match = /^- ([A-Za-z][A-Za-z0-9]*)\s*:?/.exec(text);
    if (match?.[1]) found.push({ command: match[1], line: index + 1 });
  });
  return found;
}

const FLOWS = readdirSync(FLOW_DIR)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => ({ name, source: readFileSync(join(FLOW_DIR, name), 'utf8') }));

describe('the Maestro flows', () => {
  it('are all found — a rename of e2e/ must not quietly test nothing', () => {
    expect(FLOWS.length).toBeGreaterThan(10);
  });

  for (const flow of FLOWS) {
    it(`${flow.name} issues only commands Maestro has`, () => {
      const unknown = commandsIn(flow.source)
        .filter(({ command }) => !COMMANDS.has(command))
        .map(({ command, line }) => `${flow.name}:${line} ${command}`);

      expect(unknown).toEqual([]);
    });
  }

  /**
   * The specific shape that was wrong, kept as its own case because the generic
   * check above would pass the moment somebody added the bad name to the set to
   * make a test go green.
   */
  it('wait for an element with extendedWaitUntil, never a *Visible suffix', () => {
    const offenders = FLOWS.filter((flow) =>
      /extendedWaitUntil(Not)?Visible/.test(flow.source),
    ).map((flow) => flow.name);

    expect(offenders).toEqual([]);
  });

  it('give every extendedWaitUntil a condition it can wait on', () => {
    // `extendedWaitUntil` takes `visible:` or `notVisible:`. With neither it
    // parses as YAML and fails on the device, which is the slowest possible
    // place to find out.
    const bad: string[] = [];
    for (const flow of FLOWS) {
      const lines = flow.source.split('\n');
      lines.forEach((text, index) => {
        if (!/^- extendedWaitUntil:/.test(text)) return;
        const body = lines.slice(index + 1, index + 4).join('\n');
        if (!/^\s+(visible|notVisible):/m.test(body)) bad.push(`${flow.name}:${index + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
